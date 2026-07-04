// 敵AI 迂回型・暴発型 軌道計画改善の受け入れテスト（修正仕様書 §17）。
// 「AI の clean 判定と本番の削り解決が一致する」「clean があれば壁を削らない」
// 「unbreakable を横切らない」「暴発型は対象付近で確実に暴発する」を固定する。
import { describe, it, expect } from 'vitest'
import { planEnemyShot, planRuptorShot, enemyFlight } from '../enemyAI'
import { evaluateEnemyShot } from './evaluate'
import { buildPlanningEnv } from './planningEnv'
import { findRoute } from './routeSearch'
import { fitRouteToFamilies } from './routeFit'
import { firstHit } from '../collision'
import { isSolidAt } from '../obstacle'
import { densifyGeom, OBSTACLE_STEP } from '../carve'
import { attributeOf, zfieldAt } from '../attribute'
import { buildRing, attachRingSpeeds, ringAverageAttr } from '../orbit'
import { constZField } from '../zfields'
import { dist } from '../coords'
import { varianceOf } from '../misfireInstability'
import { STAGES } from '../../data/stages'
import { FIELD, GAME } from '../../data/constants'
import type { Ally, Enemy, Obstacle, Rect, Trajectory } from '../types'

const ally = (id: string, pos: { x: number; y: number }, element: Ally['element'] = 'light', hp = 500): Ally => ({
  id, name: id, pos, hp, maxHp: hp, element, statuses: [],
})

const attacker = (over: Partial<Enemy> = {}): Enemy => ({
  id: 'e', name: '迂回型', pos: { x: 0, y: 20 }, hp: 300, maxHp: 300, element: 'dark',
  hitboxRadius: 1.8, statuses: [], family: 'arc', families: ['arc', 'abs', 'poly34'],
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 }, castInitialSpeed: 8, castZ: -2.5,
  ...over,
})

const ruptor = (over: Partial<Enemy> = {}): Enemy =>
  attacker({ id: 'r', name: '崩し手', family: 'abs', families: undefined, role: 'ruptor', ...over })

const rectWall = (rect: Rect, kind: Obstacle['kind'] = 'normal'): Obstacle => ({
  id: `ob-${rect.x}-${rect.y}`, element: 'neutral', solids: [], rects: [rect], carves: [], kind,
})

/** 命中前の経路が素材に触れた回数（本番と同じ密度・OBSTACLE_STEP）。 */
function materialContactsBeforeHit(traj: Trajectory, speed: number, aim: { x: number; y: number }, obstacles: Obstacle[]): number {
  const { flight } = enemyFlight(traj, speed)
  const hit = firstHit(flight.samples, aim, GAME.allyHitbox)
  const dense = densifyGeom(flight.samples, OBSTACLE_STEP)
  let n = 0
  for (const s of dense) {
    if (hit && s.arcLen >= hit.arcLen) break
    if (obstacles.some((ob) => isSolidAt(ob, s.pos))) n++
  }
  return n
}

describe('迂回型の経路計画（§17.1）', () => {
  it('迂回できる壁がある場合、素材に触れない clean 経路を選ぶ（本番密度で0接触）', () => {
    // 中央だけ塞ぐ壁：左右に十分な隙間があるので clean 経路が存在する
    const wall = rectWall({ x: -10, y: -1, w: 20, h: 2 })
    const t = ally('t', { x: 0, y: -15 })
    const e = attacker()
    const plan = planEnemyShot(e, [t], [wall])
    expect(plan).not.toBeNull()
    expect(plan!.expectedDamage).toBeGreaterThan(0)
    expect(materialContactsBeforeHit(plan!.trajectory, e.castInitialSpeed, t.pos, [wall])).toBe(0)
  })

  it('AI の clean 判定と本番 carveAlong 相当の解決が一致する（判定統一・§13.2）', () => {
    const wall = rectWall({ x: -10, y: -1, w: 20, h: 2 })
    const t = ally('t', { x: 0, y: -15 })
    const e = attacker()
    const plan = planEnemyShot(e, [t], [wall])
    // 本番と同一の評価器（carveAlong・OBSTACLE_STEP 密化）を通しても素材ヒットは0
    const ev = evaluateEnemyShot(plan!.trajectory, e.castInitialSpeed, [wall], [])
    expect(ev.materialArcs).toHaveLength(0)
    expect(ev.stalled).toBe(false)
  })

  it('削れる壁しかない場合は直線的に掘り、壁内部の折れ点を持たない', () => {
    // フィールド幅の大部分を塞ぐ薄い normal 壁（隙間なし・rField=30 の円がほぼ覆われる）
    const wall = rectWall({ x: -30, y: -1, w: 60, h: 2 })
    const t = ally('t', { x: 0, y: -15 })
    const e = attacker({ castInitialSpeed: 12 })
    const plan = planEnemyShot(e, [t], [wall])
    expect(plan).not.toBeNull()
    const ev = evaluateEnemyShot(plan!.trajectory, e.castInitialSpeed, [wall], [])
    // 壁内部で曲がらない（§9.3）。unbreakable でもないので横断は掘削として成立する
    expect(ev.turnInMaterialArcs).toHaveLength(0)
    expect(ev.unbreakableArc).toBeNull()
  })

  it('unbreakable を横切る候補は採用しない（隙間があれば必ずそちら・§17.1）', () => {
    const wallU = rectWall({ x: -30, y: -1, w: 42, h: 2 }, 'unbreakable') // x≤12 を塞ぐ・右に隙間
    const t = ally('t', { x: 0, y: -15 })
    const e = attacker()
    const plan = planEnemyShot(e, [t], [wallU])
    expect(plan).not.toBeNull()
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    const dense = densifyGeom(flight.samples, OBSTACLE_STEP)
    expect(dense.some((s) => isSolidAt(wallU, s.pos))).toBe(false)
  })
})

describe('経路探索と family フィット（§8/§10）', () => {
  it('clean 経路探索は素材に触れない折れ線を返す（clearance は計画余白・最終保証は物理検証層）', () => {
    const wall = rectWall({ x: -10, y: -1, w: 20, h: 2 })
    const env = buildPlanningEnv([wall])
    const route = findRoute(env, { x: 0, y: 20 }, { x: 0, y: -15 }, 'clean')
    expect(route).not.toBeNull()
    for (let i = 1; i < route!.points.length; i++) {
      const a = route!.points[i - 1]
      const b = route!.points[i]
      const n = Math.ceil(dist(a, b) / 0.3)
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }
        expect(env.isMaterial(p)).toBe(false)
      }
    }
  })

  it('wallTunnel 経路のトンネルは直線（平滑化済みセグメント内）で本数・長さ制限内', () => {
    const wall = rectWall({ x: -30, y: -1, w: 60, h: 2 })
    const env = buildPlanningEnv([wall])
    const route = findRoute(env, { x: 0, y: 20 }, { x: 0, y: -15 }, 'wallTunnel')
    expect(route).not.toBeNull()
    expect(route!.tunnels.length).toBeLessThanOrEqual(1)
    for (const tn of route!.tunnels) expect(tn.length).toBeLessThanOrEqual(8.0)
  })

  it('フィットは経路のゴールを通る軌道を返す（局所単調・family 制約内）', () => {
    const wall = rectWall({ x: -10, y: -1, w: 20, h: 2 })
    const env = buildPlanningEnv([wall])
    const origin = { x: 0, y: 20 }
    const goal = { x: 0, y: -15 }
    const route = findRoute(env, origin, goal, 'clean')!
    const fits = fitRouteToFamilies(route.points, origin, ['arc', 'abs', 'poly34'])
    expect(fits.length).toBeGreaterThan(0)
    for (const fit of fits) {
      const traj: Trajectory = { mode: 'rotate', g: fit.g, angle: fit.angle, origin, z: constZField(-2.5) }
      const { path } = enemyFlight(traj, 8)
      // 経路の終点（ゴール）近傍を通る＝狙いを外さないフィット
      const nearest = Math.min(...path.map((p) => dist(p, goal)))
      expect(nearest).toBeLessThan(1.5)
    }
  })
})

describe('結界の扱い（§7/§17.2）', () => {
  const orbitAround = (center: { x: number; y: number }, z: number, ringSpeed = 10) => {
    const traj: Trajectory = { mode: 'polar', f: () => 5, origin: center, z: constZField(z) }
    return attachRingSpeeds(buildRing(traj), ringSpeed)
  }

  it('通常迂回型は反対極結界で速度0になる候補を命中扱いしない（牽制へ落ちる）', () => {
    const t = ally('t', { x: 0, y: -10 }, 'light')
    // 高速の光結界 vs 闇弾（castZField 固定）＝相殺の減速（30×2.5×0.25≒18.75）が弾速を必ず上回る
    const ring = orbitAround(t.pos, FIELD.zRef, 30)
    const e = attacker({ castZField: constZField(-FIELD.zRef), castZ: -FIELD.zRef })
    const plan = planEnemyShot(e, [t], [], [ring])
    expect(plan).not.toBeNull()
    // 結界に阻まれて届かない＝命中候補なし（期待ダメージ0の牽制＝結界削り）
    expect(plan!.expectedDamage).toBe(0)
  })

  it('slipThrough 迂回型は結界と同極に合わせて透過し、命中候補を維持する', () => {
    const t = ally('t', { x: 0, y: -10 }, 'light')
    const ring = orbitAround(t.pos, FIELD.zRef) // 光の結界
    const e = attacker({ slipThrough: true })
    const plan = planEnemyShot(e, [t], [], [ring])
    expect(plan).not.toBeNull()
    expect(plan!.expectedDamage).toBeGreaterThan(0)
    // 選ばれた弾の属性は結界と同極（光）＝透過（04-magic §4.6）
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    const hit = firstHit(flight.samples, t.pos, GAME.allyHitbox)!
    expect(attributeOf(zfieldAt(plan!.trajectory, hit.pos))).toBe(ringAverageAttr(ring))
  })
})

describe('暴発型の finalize（§12/§17.3）', () => {
  it('対象のヒットボックスへ通常接触せず、AoE 圏内（ヒットボックス外）で暴発する', () => {
    const t = ally('t', { x: 0, y: -10 }, 'light', 100)
    const e = ruptor()
    const plan = planRuptorShot(e, [t], [])
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    const d = dist(plan!.misfirePos!, t.pos)
    expect(d).toBeLessThan(FIELD.aoeRadius)
    expect(d).toBeGreaterThan(GAME.allyHitbox * 0.9) // 対象を素通りせず手前・横で暴発
  })

  it('instability 下振れ（guaranteedRadius）でも巻き込める極を優先する（§12.6）', () => {
    const t = ally('t', { x: 0, y: -10 }, 'light', 100)
    const e = ruptor()
    const count = 8 // variance 0.3 → guaranteed = 5×0.7 = 3.5
    const plan = planRuptorShot(e, [t], [], undefined, [], undefined, count)
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    const guaranteed = FIELD.aoeRadius * (1 - varianceOf(count))
    expect(dist(plan!.misfirePos!, t.pos)).toBeLessThanOrEqual(guaranteed)
  })

  it('壁狙い ruptor は壁の素材内ではなく手前に極を置く（§12.2.2）', () => {
    const wall: Obstacle = { id: 'w', element: 'dark', solids: [{ x: 5, y: 2, r: 2.4 }], carves: [] }
    const e = ruptor({ ruptorTarget: 'obstacles', pos: { x: 0, y: 14 } })
    const t = ally('t', { x: -10, y: -12 })
    const plan = planRuptorShot(e, [t], [wall])
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    expect(isSolidAt(wall, plan!.misfirePos!)).toBe(false) // 素材内で不発にならない
    expect(dist(plan!.misfirePos!, { x: 5, y: 2 })).toBeLessThan(FIELD.aoeRadius) // AoE が壁を崩す
  })

  it('unbreakable の壁越しでは横切る暴発計画を採用しない', () => {
    const wallU = rectWall({ x: -30, y: -1, w: 60, h: 2 }, 'unbreakable')
    const t = ally('t', { x: 0, y: -15 })
    const e = ruptor()
    const plan = planRuptorShot(e, [t], [wallU])
    expect(plan).not.toBeNull()
    if (plan!.misfirePos) {
      // 暴発を予告するなら、その経路は unbreakable を横切らない（壁手前で成立している）
      const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
      const dense = densifyGeom(flight.samples, OBSTACLE_STEP)
      expect(dense.some((s) => isSolidAt(wallU, s.pos))).toBe(false)
    }
  })
})

describe('ステージ回帰（§17.4）', () => {
  it('第4面の壁狙い ruptor は最初の1発で壁付近の暴発を計画する', () => {
    const st = STAGES[3]
    const demo = st.enemies.find((e) => e.role === 'ruptor' && e.ruptorTarget === 'obstacles')
    expect(demo).toBeDefined()
    const party: Ally[] = [
      ally('a', { x: -8, y: -18 }), ally('b', { x: 0, y: -20 }), ally('c', { x: 8, y: -18 }),
    ]
    const plan = planRuptorShot(demo!, party, st.obstacles, undefined, [], st.rField)
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    // 暴発点はいずれかの壁の素材の近傍（AoE 半径内）＝壁を削るデモが成立する
    const nearWall = st.obstacles.some((ob) =>
      ob.solids.some((s) => dist(plan!.misfirePos!, { x: s.x, y: s.y }) <= FIELD.aoeRadius + s.r),
    )
    expect(nearWall).toBe(true)
  })

  it('第2〜7面の全敵が初期盤面で計画を返し、unbreakable を横切らない', () => {
    for (let s = 1; s < STAGES.length; s++) {
      const st = STAGES[s]
      const unb = st.obstacles.filter((ob) => (ob.kind ?? 'normal') === 'unbreakable')
      const party: Ally[] = [
        ally('a', { x: -8, y: -18 }), ally('b', { x: 0, y: -20 }), ally('c', { x: 8, y: -18 }),
      ]
      for (const e of st.enemies) {
        const plan = planEnemyShot(e, party, st.obstacles, [], st.enemies, st.rField)
        expect(plan).not.toBeNull()
        if (plan!.trajectory.mode === 'polar') continue // guardian の周回結界は対象外
        if (plan!.expectedDamage > 0 || plan!.misfirePos) {
          const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
          const dense = densifyGeom(flight.samples, OBSTACLE_STEP)
          expect(dense.some((p) => unb.some((ob) => isSolidAt(ob, p.pos)))).toBe(false)
        }
      }
    }
  })
})
