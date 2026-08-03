// 守護型（guardian）の結界最適化（#71・05b §5.4）の回帰テスト。
// ①素材に絶対触れない ②近くの味方を覆う ③同じ結界を重ね張りしない ④LVL で式の複雑さが上がる
import { describe, it, expect } from 'vitest'
import { planEnemyShot } from '../enemyAI'
import { resolveTurn } from '../turn'
import { attachRingSpeeds, buildRing, ringEncloses, ringRadius } from '../orbit'
import { isSolidAt } from '../obstacle'
import { simulateFlight } from '../physics'
import { strengthOf } from '../attribute'
import { FIELD, GAME } from '../../data/constants'
import type { Ally, Enemy, Obstacle, Trajectory } from '../types'

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
