// 守護型（guardian）の結界最適化（#71・05b §5.4）の回帰テスト。
// ①素材に絶対触れない ②近くの味方を覆う ③同じ結界を重ね張りしない ④LVL で式の複雑さが上がる
import { describe, it, expect } from 'vitest'
import { planEnemyShot } from '../enemyAI'
import { resolveTurn } from '../turn'
import { attachRingSpeeds, buildRing, ringEncloses, ringRadius } from '../orbit'
import { isSolidAt } from '../obstacle'
import { simulateFlight } from '../physics'
import { strengthOf } from '../attribute'
import { constZField } from '../zfields'
import { predictAllyShots, type PredictedShot } from './foresight'
import { predictedBlock } from './guardianThreat'
import { FIELD, GAME } from '../../data/constants'
import type { Ally, AllyCast, Enemy, Obstacle, Trajectory, Vec2 } from '../types'

const ally = (id: string, pos: { x: number; y: number }): Ally => ({
  id, name: id, pos, hp: 100, maxHp: 100, element: 'light', statuses: [],
})

const guardian = (over: Partial<Enemy> = {}): Enemy => ({
  id: 'g', name: '番人', pos: { x: 0, y: 0 }, hp: 200, maxHp: 200, element: 'light',
  hitboxRadius: 1.8, statuses: [], family: 'spiral', role: 'guardian',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 }, castInitialSpeed: 8, castZ: 2.5,
  ...over,
})
/** 守護型の味方（覆う対象）。 */
const mate = (id: string, pos: { x: number; y: number }): Enemy =>
  ({ ...guardian({ id, pos }), role: 'breaker' })

const threat = [ally('a', { x: 0, y: -20 })]
const ringOf = (traj: Trajectory, speed = 8) => attachRingSpeeds(buildRing(traj), speed)
/** 脅威方向（真下）の扇での最小迎撃威力＝強度×リング速度（#60：結界の抜かれにくさ）。 */
const wedgePower = (traj: Trajectory, speed = 8): number => {
  const ring = ringOf(traj, speed)
  const inWedge = ring.filter((p) => Math.abs(Math.atan2(p.pos.y, p.pos.x) + Math.PI / 2) < Math.PI / 6)
  return Math.min(...inWedge.map((p) => strengthOf(p.z) * (p.speed ?? 0)))
}

describe('守護型：結界は障害物の素材に絶対触れない（#71 ①）', () => {
  it('柱に囲まれた地形でも、リングの全点が素材の外にある', () => {
    // 敵の周りの4方向に柱（既定半径7のリング上）。素材を避けた外形でなければ即霧散する
    const walls: Obstacle[] = [
      { id: 'w1', element: 'neutral', carves: [], solids: [{ x: 7, y: 0, r: 2 }] },
      { id: 'w2', element: 'neutral', carves: [], solids: [{ x: -7, y: 1, r: 2 }] },
      { id: 'w3', element: 'neutral', carves: [], solids: [{ x: 1, y: 7.5, r: 2 }] },
      { id: 'w4', element: 'dark', carves: [], solids: [{ x: -2, y: -8, r: 2.5 }] },
    ]
    for (const level of [4, 5, 6, 7]) {
      const g = guardian({ level, directedAura: true })
      const plan = planEnemyShot(g, threat, walls, [], [g])
      expect(plan, `LVL${level}`).not.toBeNull()
      const ring = buildRing(plan!.trajectory)
      expect(ring.length).toBeGreaterThan(3)
      for (const rp of ring) {
        expect(walls.some((w) => isSolidAt(w, rp.pos)), `LVL${level} の結界が素材に触れた`).toBe(false)
      }
      // 触れない外形を選んでも、強すぎる場で自壊してはいけない（#31）
      expect(simulateFlight(plan!.trajectory, g.castInitialSpeed).end).not.toBe('vanished')
    }
  })

  it('素材に囲まれて張る余地がなければ結界を張らない（null＝無駄撃ちしない）', () => {
    // 至近距離（距離3）を8方向すべて柱で塞ぐ＝最小半径すら素材に触れる
    const solids = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2
      return { x: 3 * Math.cos(a), y: 3 * Math.sin(a), r: 1.6 }
    })
    const cage: Obstacle = { id: 'cage', element: 'neutral', carves: [], solids }
    const g = guardian({ level: 7, directedAura: true })
    expect(planEnemyShot(g, threat, [cage], [], [g])).toBeNull()
  })
})

describe('守護型：近くの味方を覆う（#71 ②）', () => {
  it('開けた地形では左右の味方をまとめて覆う', () => {
    const m1 = mate('m1', { x: -5, y: 3 })
    const m2 = mate('m2', { x: 6, y: 2 })
    const g = guardian({ level: 6, directedAura: true })
    const plan = planEnemyShot(g, threat, [], [], [g, m1, m2])
    const ring = buildRing(plan!.trajectory)
    expect(ringEncloses(ring, m1.pos)).toBe(true)
    expect(ringEncloses(ring, m2.pos)).toBe(true)
    expect(ringEncloses(ring, g.pos)).toBe(true)
  })

  it('遠すぎる味方は諦め、自分を守る既定の大きさで張る（従来動作）', () => {
    const far = mate('m', { x: 20, y: 0 })
    const g = guardian()
    const plan = planEnemyShot(g, threat, [], [], [g, far])
    const ring = buildRing(plan!.trajectory)
    expect(ringEncloses(ring, far.pos)).toBe(false)
    expect(ringRadius(ring)).toBeCloseTo(GAME.enemyGuardRadius, 0)
  })
})

describe('守護型：LVL が上がるほど複雑な式で最適化できる（#71 ④）', () => {
  // 右に柱（自由半径が 3 強まで縮む）・上に味方（覆うには半径10相当が要る）。
  // 真円しか組めない個体は「柱を避ける小さな円」しか張れず味方を覆えないが、
  // フーリエ級数を組める個体は柱の方向だけ凹ませて味方の方向へ伸ばせる。
  const wall: Obstacle = { id: 'w', element: 'neutral', carves: [], solids: [{ x: 6, y: 0, r: 2 }] }
  const m = mate('m', { x: 0, y: 7 })

  it('LVL4（真円のみ）は柱の陰の味方を覆えない', () => {
    const g = guardian({ level: 4, directedAura: true })
    const plan = planEnemyShot(g, threat, [wall], [], [g, m])
    const ring = buildRing(plan!.trajectory)
    expect(ringEncloses(ring, m.pos)).toBe(false)
    expect(isSolidAt(wall, { x: 0, y: 0 })).toBe(false)
    for (const rp of ring) expect(isSolidAt(wall, rp.pos)).toBe(false)
  })

  it('LVL6 は外形を歪めて柱を避けつつ味方を覆う', () => {
    const g = guardian({ level: 6, directedAura: true })
    const plan = planEnemyShot(g, threat, [wall], [], [g, m])
    const ring = buildRing(plan!.trajectory)
    expect(ringEncloses(ring, m.pos)).toBe(true)
    for (const rp of ring) expect(isSolidAt(wall, rp.pos)).toBe(false)
    // 真円ではない（柱側は縮み、味方側へ伸びる）
    const rs = ring.map((rp) => Math.hypot(rp.pos.x - g.pos.x, rp.pos.y - g.pos.y))
    expect(Math.max(...rs) - Math.min(...rs)).toBeGreaterThan(2)
  })

  it('z 場の最適化：LVL が上がるほど脅威方向の迎撃威力が高く、かつ自壊しない', () => {
    const powers = [4, 6, 7].map((level) => {
      const g = guardian({ level, directedAura: true })
      const plan = planEnemyShot(g, threat, [wall], [], [g, m])
      expect(simulateFlight(plan!.trajectory, g.castInitialSpeed).end).not.toBe('vanished')
      return wedgePower(plan!.trajectory)
    })
    expect(powers[1]).toBeGreaterThan(powers[0])
    expect(powers[2]).toBeGreaterThan(powers[1])
  })

  it('最上位（LVL7）は |z|>zRef の過励起を使うが、失速して霧散はしない', () => {
    const g = guardian({ level: 7, directedAura: true })
    const plan = planEnemyShot(g, threat, [wall], [], [g, m])
    const ring = ringOf(plan!.trajectory)
    expect(Math.max(...ring.map((rp) => Math.abs(rp.z)))).toBeGreaterThan(FIELD.zRef)
    expect(ring.every((rp) => (rp.speed ?? 0) > 0)).toBe(true)
    expect(simulateFlight(plan!.trajectory, g.castInitialSpeed).end).not.toBe('vanished')
  })

  it('方向づけを持たない個体は従来どおり一様な場（|z|=zRef 一定）を張る', () => {
    const g = guardian({ level: 7 })
    const plan = planEnemyShot(g, threat, [], [], [g])
    const ring = ringOf(plan!.trajectory)
    for (const rp of ring) expect(Math.abs(rp.z)).toBeCloseTo(FIELD.zRef, 6)
  })
})

describe('守護型：前ターンの相手の魔法を読んで張る（#76）', () => {
  /** 味方 from → to へ真っ直ぐ飛ぶ手（強さ mag の一定場）。 */
  const castAt = (allyId: string, from: Vec2, to: Vec2, mag: number, speed = 10): AllyCast => ({
    allyId,
    trajectory: {
      mode: 'rotate', g: () => 0, angle: Math.atan2(to.y - from.y, to.x - from.x), origin: from, z: constZField(mag),
    } as Trajectory,
    initialSpeed: speed,
  })
  const shooter = ally('s', { x: 18, y: 0 }) // 右（+x）から撃ってくる
  const plan = (g: Enemy, allies: Ally[], predicted: PredictedShot[]) =>
    planEnemyShot(g, allies, [], [], [g], undefined, 0, [], { predicted })

  it('飛来弾の反対極で張る＝同極では透過されてしまう弾を実際に撃ち落とせる', () => {
    const g = guardian({ level: 7, directedAura: true }) // element=light＝従来は光の結界
    const light = predictAllyShots([castAt('s', shooter.pos, g.pos, FIELD.zRef)], [shooter])
    const barrier = ringOf(plan(g, [shooter], light)!.trajectory)
    // 光で来るので闇（z<0）側を強く張る＝反対極でしか相殺できない（04-magic §4.6）
    expect(Math.min(...barrier.map((rp) => rp.z))).toBeLessThan(0)
    expect(predictedBlock(barrier, light).stopped).toBe(1)
    // 読みが無ければ従来どおり自分の属性（光）の一様な場＝この弾は素通りしてしまう
    const naive = ringOf(planEnemyShot(g, [shooter], [], [], [g])!.trajectory)
    expect(Math.min(...naive.map((rp) => rp.z))).toBeGreaterThan(0)
    expect(predictedBlock(naive, light).stopped).toBe(0)
  })

  it('闇で来れば光で張る（極性は飛来弾に合わせて反転する）', () => {
    const g = guardian({ level: 7, element: 'dark', directedAura: true })
    const dark = predictAllyShots([castAt('s', shooter.pos, g.pos, -FIELD.zRef)], [shooter])
    const barrier = ringOf(plan(g, [shooter], dark)!.trajectory)
    expect(Math.max(...barrier.map((rp) => rp.z))).toBeGreaterThan(0)
    expect(predictedBlock(barrier, dark).stopped).toBe(1)
  })

  it('防御の指向性は「飛来弾が来る方角」へ向く（脅威度が最大の味方の方角ではない）', () => {
    // 手負いの味方は真下（-y）＝脅威度は最大だが、実際に飛んでくるのは右（+x）から
    const wounded: Ally = { ...ally('w', { x: 0, y: -20 }), hp: 20 }
    const g = guardian({ level: 7, directedAura: true })
    const incoming = predictAllyShots([castAt('s', shooter.pos, g.pos, FIELD.zRef)], [shooter, wounded])
    const peakPhi = (traj: Trajectory): number => {
      const ring = ringOf(traj)
      const peak = ring.reduce((b, rp) => (Math.abs(rp.z) > Math.abs(b.z) ? rp : b))
      return Math.atan2(peak.pos.y - g.pos.y, peak.pos.x - g.pos.x)
    }
    expect(Math.abs(peakPhi(plan(g, [shooter, wounded], incoming)!.trajectory))).toBeLessThan(Math.PI / 6)
    // 読みが無ければ従来どおり脅威度最大の味方（真下）へ向く
    expect(peakPhi(planEnemyShot(g, [shooter, wounded], [], [], [g])!.trajectory)).toBeCloseTo(-Math.PI / 2, 1)
  })

  it('stage が極性を指定した個体（guardZSign）は読みでも極性を変えない', () => {
    const g = guardian({ level: 7, directedAura: true, guardZSign: 1 })
    const light = predictAllyShots([castAt('s', shooter.pos, g.pos, FIELD.zRef)], [shooter])
    const ring = ringOf(plan(g, [shooter], light)!.trajectory)
    expect(Math.max(...ring.map((rp) => rp.z))).toBeGreaterThan(0)
    expect(Math.min(...ring.map((rp) => rp.z))).toBeGreaterThanOrEqual(0)
  })

  it('3発を接触時刻順に再評価し、先の迎撃による結界の失速を後続弾へ引き継ぐ', () => {
    const barrier = ringOf({
      mode: 'polar',
      f: () => GAME.enemyGuardRadius,
      origin: { x: 0, y: 0 },
      z: constZField(-FIELD.zRef),
    }, 8)
    const near = ally('near', { x: 12, y: 0 })
    const middle = ally('middle', { x: 15, y: 0 })
    const far = ally('far', { x: 18, y: 0 })
    const shots = predictAllyShots([
      castAt('far', far.pos, { x: 0, y: 0 }, FIELD.zRef, 2),
      castAt('middle', middle.pos, { x: 0, y: 0 }, FIELD.zRef, 4),
      castAt('near', near.pos, { x: 0, y: 0 }, FIELD.zRef, 3),
    ], [near, middle, far])

    // 入力順は逆でも、近い2発を順に止めて失速し、最後の弾には結界を破られる。
    expect(predictedBlock(barrier, shots).stopped).toBe(2)
  })

  it('最大半径だけをかすめる強い弾でなく、実形状へ当たる弾の反対極を選ぶ', () => {
    const g = guardian({ level: 4, directedAura: true })
    const nearMiss = ally('near-miss', { x: 18, y: 10 })
    const actual = ally('actual', { x: 18, y: 0 })
    const predicted = predictAllyShots([
      castAt('near-miss', nearMiss.pos, { x: -18, y: 10 }, FIELD.zRef, 12),
      castAt('actual', actual.pos, g.pos, -FIELD.zRef, 3),
    ], [nearMiss, actual])
    const ring = ringOf(plan(g, [nearMiss, actual], predicted)!.trajectory)

    expect(predictedBlock(ring, predicted).stopped).toBe(1)
    expect(predictedBlock(ring, [predicted[1]]).stopped).toBe(1)
    expect(predictedBlock(ring, [predicted[0]]).stopped).toBe(0)
  })
})

describe('守護型：同じ結界は重ね張りしない（#71 ③）', () => {
  it('既に張ってある結界とは別形状を選び、上限（2枚）に達したら張り直す', () => {
    const g = guardian({ level: 6, directedAura: true })
    const p1 = planEnemyShot(g, threat, [], [], [g])
    const r1 = ringOf(p1!.trajectory)
    // 2枚目：1枚目と同じ結界を張っても層は増えない（同IDで置き換わる）ので別の大きさを選ぶ
    const p2 = planEnemyShot(g, threat, [], [], [g], undefined, 0, [r1])
    const r2 = ringOf(p2!.trajectory)
    expect(Math.abs(ringRadius(r2) - ringRadius(r1))).toBeGreaterThan(1.2)
    // 3枚目：上限に達しているので、既存と同じ結界を張り直す（迎撃で失速した結界の速度回復）
    const p3 = planEnemyShot(g, threat, [], [], [g], undefined, 0, [r1, r2])
    const r3 = ringOf(p3!.trajectory)
    const gap = Math.min(Math.abs(ringRadius(r3) - ringRadius(r1)), Math.abs(ringRadius(r3) - ringRadius(r2)))
    expect(gap).toBeLessThan(1.2)
  })

  it('低 LVL（1枚まで）は毎ターン同じ結界を張り直す', () => {
    const g = guardian({ level: 4 })
    const p1 = planEnemyShot(g, threat, [], [], [g])
    const r1 = ringOf(p1!.trajectory)
    const p2 = planEnemyShot(g, threat, [], [], [g], undefined, 0, [r1])
    expect(ringRadius(ringOf(p2!.trajectory))).toBeCloseTo(ringRadius(r1), 2)
  })

  it('resolveTurn 統合：2ターンで別形状の結界が2枚とも持続する', () => {
    const g = guardian({ level: 6, directedAura: true })
    const base = {
      allies: [ally('a', { x: 0, y: -20 })],
      casts: [],
      obstacles: [],
      mechanics: { obstacles: true, enemyFire: true },
    }
    const t1 = resolveTurn({ ...base, enemies: [g], castingEnemyIds: ['g'] })
    const own1 = t1.orbits.filter((o) => o.owner === 'enemy' && o.ownerId === 'g')
    expect(own1.length).toBe(1)
    const t2 = resolveTurn({ ...base, enemies: t1.enemies, castingEnemyIds: ['g'], activeOrbits: t1.orbits })
    const own2 = t2.orbits.filter((o) => o.owner === 'enemy' && o.ownerId === 'g')
    expect(own2.length).toBe(2)
    // 3ターン目は増えない（上限2枚＝turn.ts のオーラ加算上限と同じ）
    const t3 = resolveTurn({ ...base, enemies: t2.enemies, castingEnemyIds: ['g'], activeOrbits: t2.orbits })
    expect(t3.orbits.filter((o) => o.owner === 'enemy' && o.ownerId === 'g').length).toBe(2)
  })
})
