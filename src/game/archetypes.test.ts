// 攻撃パターンの拡張（05b）：迂回型高難度の同極すり抜け・守護型の交互張り/回復/配置のテスト。
import { describe, it, expect } from 'vitest'
import { planEnemyShot, enemyFlight } from './enemyAI'
import { prepareTurn, createBattleState } from './battle'
import { resolveTurn } from './turn'
import { buildRing, attachRingSpeeds, ringRadius, ringCentroid } from './orbit'
import { firstHit } from './collision'
import { constZField } from './zfields'
import { zfieldAt } from './attribute'
import { FIELD, GAME } from '../data/constants'
import type { ActiveOrbit, Ally, Enemy, Obstacle, Stage, Trajectory } from './types'

const ally = (id: string, pos: { x: number; y: number }, element: Ally['element'] = 'neutral', hp = 500): Ally => ({
  id, name: id, pos, hp, maxHp: hp, element, statuses: [],
})

const enemy = (over: Partial<Enemy> = {}): Enemy => ({
  id: 'e0', name: '敵', pos: { x: 0, y: 15 }, hp: 100, maxHp: 100, element: 'dark',
  hitboxRadius: 1.8, statuses: [], family: 'arc',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 }, castInitialSpeed: 8, castZ: -3,
  ...over,
})

/** center を囲む円リング（半径4・一定 z）を持続結界として作る（点ごとの速度つき・#60）。 */
function ringOrbit(center: { x: number; y: number }, z: number, ownerId = 't', speed = 10): ActiveOrbit {
  const traj: Trajectory = { mode: 'polar', f: () => 4, origin: center, z: constZField(z) }
  return { id: 'orb', ownerId, owner: 'player', ring: attachRingSpeeds(buildRing(traj), speed), ringSpeed: speed }
}

describe('迂回型高難度：同極すり抜け（05b §5.2）', () => {
  it('狙う味方が光の結界内なら、自分の z を光（同極）に合わせる', () => {
    const t = ally('t', { x: 0, y: -8 }, 'light')
    const guard = ringOrbit(t.pos, FIELD.zRef) // 光の結界
    const rings = [guard.ring]
    // 通常個体：反対極（闇）で弱点を突く
    const normal = planEnemyShot(enemy({ family: 'line' }), [t], [], rings)
    expect(normal).not.toBeNull()
    expect(zfieldAt(normal!.trajectory, t.pos)).toBeLessThan(0)
    // 高難度個体：結界と同極（光）に合わせてすり抜けを狙う
    const slippy = planEnemyShot(enemy({ family: 'line', slipThrough: true }), [t], [], rings)
    expect(slippy).not.toBeNull()
    expect(zfieldAt(slippy!.trajectory, t.pos)).toBeGreaterThan(0)
  })

  it('隠蔽された対象は、見かけ位置でなく結界そのもの（リング中心）を同極 z で狙う（#47）', () => {
    // 闇の結界で隠蔽（concealed=1）された光の味方。見かけ位置は真位置からずれる（#35）。
    const t = { ...ally('t', { x: 0, y: -8 }, 'light'), concealed: 1, concealRmse: 2 }
    const guard = ringOrbit(t.pos, FIELD.zRef) // 光の結界（位置は確実）
    const ring = guard.ring
    const c = ringCentroid(ring)
    const slippy = planEnemyShot(enemy({ family: 'line', slipThrough: true }), [t], [], [ring])
    expect(slippy).not.toBeNull()
    // 結界と同極（光）に合わせる＝すり抜け狙い
    expect(zfieldAt(slippy!.trajectory, t.pos)).toBeGreaterThan(0)
    // ジッターのかかった見かけ位置ではなく、位置が確実なリング中心付近を通る
    const { flight } = enemyFlight(slippy!.trajectory, 8)
    expect(firstHit(flight.samples, c, GAME.allyHitbox)).not.toBeNull()
  })

  it('同極に合わせた弾は結界を素通りして命中する（結界は無傷のまま）', () => {
    const t = ally('t', { x: 0, y: -8 }, 'light')
    const guard = ringOrbit(t.pos, FIELD.zRef) // 光の結界
    const res = resolveTurn({
      allies: [t],
      casts: [],
      enemies: [enemy({ family: 'line', slipThrough: true })],
      castingEnemyIds: ['e0'],
      obstacles: [],
      mechanics: { obstacles: true, enemyFire: true },
      activeOrbits: [guard],
    })
    // 同極なので結界は削らず（透過）、弾は届いてダメージが入る。結界も生き残る
    expect(res.allies[0].hp).toBeLessThan(t.hp)
    expect(res.orbits.some((o) => o.id === 'orb')).toBe(true)
  })
})

describe('守護型の拡張（05b §5.4）', () => {
  const stage = (enemies: Enemy[]): Stage => ({
    id: 's', name: 'テスト', enemies, obstacles: [],
    introText: [], clearText: [], mechanics: { obstacles: true, enemyFire: true },
  })

  it('交互張り：奇数ターンは光・偶数ターンは闇のオーラを張る', () => {
    const g = enemy({ id: 'g', role: 'guardian', alternatingAura: true })
    const st = createBattleState(stage([g]), 0, [ally('a', { x: 0, y: -14 })])
    const p1 = prepareTurn(st) // turn=1（奇数）
    const g1 = p1.state.enemies[0]
    expect(g1.guardZSign).toBe(1)
    const plan1 = planEnemyShot(g1, p1.state.allies)
    expect(zfieldAt(plan1!.trajectory, { x: g1.pos.x + 7, y: g1.pos.y })).toBeCloseTo(FIELD.zRef, 5)
    const p2 = prepareTurn({ ...p1.state, turn: 2 }) // 偶数
    expect(p2.state.enemies[0].guardZSign).toBe(-1)
    const plan2 = planEnemyShot(p2.state.enemies[0], p2.state.allies)
    expect(zfieldAt(plan2!.trajectory, { x: g1.pos.x + 7, y: g1.pos.y })).toBeCloseTo(-FIELD.zRef, 5)
  })

  it('方向づけられた場：全周で |z|≤zRef を保ち、脅威（味方）方向で強度が最大（#47）', () => {
    // 敵(0,12) の下方(0,-14)に味方。directedAura は脅威方向（真下）で |z| 最大、全周 |z|≤zRef。
    const g = enemy({ id: 'g', role: 'guardian', pos: { x: 0, y: 12 }, directedAura: true })
    const threat = ally('a', { x: 0, y: -14 }, 'light')
    const plan = planEnemyShot(g, [threat])
    const ring = buildRing(plan!.trajectory)
    expect(ring.length).toBeGreaterThan(3)
    let maxAbs = 0
    let strongest = ring[0]
    for (const rp of ring) {
      maxAbs = Math.max(maxAbs, Math.abs(rp.z))
      if (Math.abs(rp.z) > Math.abs(strongest.z)) strongest = rp
    }
    // 全周で |z|≤zRef（失速自滅しない）
    expect(maxAbs).toBeLessThanOrEqual(FIELD.zRef + 1e-6)
    // 強度最大点は敵から見て脅威方向（下方＝味方側）にある
    expect(strongest.pos.y).toBeLessThan(g.pos.y)
  })

  it('方向づけ×交互張りの併用：ターン極性を振幅に掛けても振幅≤zRef を維持（#47・最上位）', () => {
    // alternatingAura（ターン偶奇で符号切替）と directedAura を同時に持つ最上位個体。
    const g = enemy({ id: 'g', role: 'guardian', alternatingAura: true, directedAura: true })
    const st = createBattleState(stage([g]), 0, [ally('a', { x: 0, y: -14 }, 'light')])
    for (const turn of [1, 2]) {
      const p = prepareTurn({ ...st, turn })
      const gi = p.state.enemies[0]
      const plan = planEnemyShot(gi, p.state.allies)
      const ring = buildRing(plan!.trajectory)
      const maxAbs = ring.reduce((m, rp) => Math.max(m, Math.abs(rp.z)), 0)
      expect(maxAbs).toBeLessThanOrEqual(FIELD.zRef + 1e-6)
      // ターンごとに符号が反転する（奇数=光/偶数=闇）
      const strongest = ring.reduce((s, rp) => (Math.abs(rp.z) > Math.abs(s.z) ? rp : s), ring[0])
      expect(Math.sign(strongest.z)).toBe(turn % 2 === 1 ? 1 : -1)
    }
  })

  it('結界は障害物の素材に触れない半径を選ぶ（05b §5.4 配置ロジック）', () => {
    const g = enemy({ id: 'g', role: 'guardian' })
    // 既定半径（7）のリング上に壁を置く
    const wall: Obstacle = {
      id: 'w', element: 'neutral', carves: [],
      solids: [{ x: g.pos.x + GAME.enemyGuardRadius, y: g.pos.y, r: 1.5 }],
    }
    const plan = planEnemyShot(g, [ally('a', { x: 0, y: -14 })], [wall])
    const ring = buildRing(plan!.trajectory)
    expect(ringRadius(ring)).toBeLessThan(GAME.enemyGuardRadius - 0.5)
  })

  it('光の結界は囲んだ敵陣を毎ターン回復する', () => {
    const g = enemy({ id: 'g', role: 'guardian', element: 'light', hp: 60, maxHp: 100 })
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: -14 })],
      casts: [],
      enemies: [g],
      castingEnemyIds: ['g'],
      obstacles: [],
      mechanics: { obstacles: true, enemyFire: true },
    })
    expect(res.enemies[0].hp).toBeGreaterThan(60)
  })
})

describe('結界の回避と「当てる」フォールバック（05b §1）', () => {
  it('迂回型：反対極の結界に阻まれる相手を避け、開けた相手を狙う', () => {
    // 光の相手2人（弾は反対極＝闇）。片方は強い光の結界（闇弾を止め切る速度24）に守られている
    const guarded = ally('guarded', { x: -6, y: -8 }, 'light')
    const open = ally('open', { x: 6, y: -8 }, 'light')
    const guard = ringOrbit(guarded.pos, FIELD.zRef, 'guarded', 24) // 光・高速の結界
    const plan = planEnemyShot(enemy({ family: 'line' }), [guarded, open], [], [guard.ring])
    expect(plan).not.toBeNull()
    expect(plan!.targetId).toBe('open') // 阻まれる候補は捨てられ、開けた相手を選ぶ
    expect(plan!.expectedDamage).toBeGreaterThan(0)
  })

  it('突破不能なら結界そのものに反対極を当てて削る（line 不可個体は曲線で）', () => {
    // 闇の相手が光の結界の中・家系は arc のみ（届く候補なし）→ 結界の反対極（闇）を当てるフォールバック。
    // 通常の牽制なら z は対象（闇）の反対極＝光(+) になるところ、結界（光）の反対極＝闇(−) を選ぶ
    const guarded = ally('guarded', { x: 6, y: -8 }, 'dark')
    const guard = ringOrbit(guarded.pos, FIELD.zRef, 'guarded')
    const plan = planEnemyShot(enemy({ family: 'arc' }), [guarded], [], [guard.ring])
    expect(plan).not.toBeNull()
    expect(plan!.expectedDamage).toBe(0) // 命中見込みなし＝結界に当てる牽制
    expect(zfieldAt(plan!.trajectory, guarded.pos)).toBeLessThan(0) // 結界（光）の反対極＝闇
    // 実際に解決すると結界と相殺（クラッシュ）が起きて結界が削られる
    const res = resolveTurn({
      allies: [guarded],
      casts: [],
      enemies: [enemy({ family: 'arc' })],
      castingEnemyIds: ['e0'],
      obstacles: [],
      mechanics: { obstacles: true, enemyFire: true },
      activeOrbits: [guard],
    })
    expect(res.clashes.length).toBeGreaterThan(0)
  })

  it('暴発型の高難度（slipThrough）は結界と同極に極性を合わせてすり抜ける', () => {
    const guarded = ally('t', { x: 0, y: -8 }, 'dark')
    const guard = ringOrbit(guarded.pos, FIELD.zRef, 't') // 光の結界
    const mid = { x: 0, y: 3 } // 敵(0,15)→相手(0,-8) の中間（飛行区間）
    // 通常個体（闇属性）：極性は自陣の闇（z<0）
    const normal = planEnemyShot(enemy({ family: 'arc', role: 'ruptor' }), [guarded], [], [guard.ring])
    expect(zfieldAt(normal!.trajectory, mid)).toBeLessThan(0)
    // 高難度個体：結界（光）と同極＝光（z>0）に合わせてすり抜ける
    const slippy = planEnemyShot(
      enemy({ family: 'arc', role: 'ruptor', slipThrough: true }),
      [guarded],
      [],
      [guard.ring],
    )
    expect(zfieldAt(slippy!.trajectory, mid)).toBeGreaterThan(0)
  })
})

describe('守護型は味方も囲む（05b §5.4）', () => {
  it('近くの味方を囲める拡大半径を選ぶ', () => {
    const g = enemy({ id: 'g', role: 'guardian', pos: { x: 0, y: 15 } })
    const mate = enemy({ id: 'm', pos: { x: 8, y: 15 } }) // 既定半径7の外・拡大半径9.1の内
    const plan = planEnemyShot(g, [ally('a', { x: 0, y: -14 })], [], [], [g, mate])
    const ring = buildRing(plan!.trajectory)
    expect(ringRadius(ring)).toBeGreaterThan(8) // 味方も囲む拡大半径（×1.3）
  })

  it('囲える味方がいなければ従来どおり既定半径で張る', () => {
    const g = enemy({ id: 'g', role: 'guardian', pos: { x: 0, y: 15 } })
    const far = enemy({ id: 'm', pos: { x: 20, y: 15 } }) // どの候補半径でも囲えない
    const plan = planEnemyShot(g, [ally('a', { x: 0, y: -14 })], [], [], [g, far])
    const ring = buildRing(plan!.trajectory)
    expect(ringRadius(ring)).toBeCloseTo(GAME.enemyGuardRadius, 0)
  })
})
