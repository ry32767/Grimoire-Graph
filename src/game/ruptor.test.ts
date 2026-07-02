// 崩し手（ruptor・#42／05b §4）：z 場の極による暴発と、通常ルールでの迎撃のテスト。
import { describe, it, expect } from 'vitest'
import { planRuptorShot, planEnemyShot, buildRuptorZField, enemyFlight } from './enemyAI'
import { resolveTurn } from './turn'
import { buildRing } from './orbit'
import { constZField } from './zfields'
import { dist } from './coords'
import { FIELD } from '../data/constants'
import type { ActiveOrbit, Ally, Enemy, EnemyFamily, Obstacle, Trajectory } from './types'

const ally = (
  id: string,
  pos: { x: number; y: number },
  element: Ally['element'] = 'neutral',
  hp = 100,
): Ally => ({ id, name: id, pos, hp, maxHp: hp, element, statuses: [] })

const ruptor = (pos: { x: number; y: number }, family: EnemyFamily = 'wave'): Enemy => ({
  id: 'r',
  name: '崩し手',
  pos,
  hp: 100,
  maxHp: 100,
  element: 'dark',
  hitboxRadius: 1.8,
  statuses: [],
  family,
  role: 'ruptor',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: 8,
  castZ: -3,
})

/** 味方 pos を囲む円結界（半径 r・一定 z）を永続周回として作る。 */
function orbitAround(ownerId: string, center: { x: number; y: number }, z: number): ActiveOrbit {
  const traj: Trajectory = { mode: 'polar', f: () => 4, origin: center, z: constZField(z) }
  return { id: `orb-${ownerId}`, ownerId, owner: 'player', ring: buildRing(traj), ringSpeed: 10 }
}

describe('buildRuptorZField（05b §4：z=zBase×極性+k/g の極）', () => {
  it('接近側では極性どおりの属性を帯び、狙点近傍で発散する', () => {
    const zf = buildRuptorZField({ x: 0, y: 10 }, { x: 0, y: -8 }, -1)
    // 中間点（狙点まで遠い）：闇の通常弾として読める大きさ
    const mid = zf(0, 2)
    expect(mid).toBeLessThan(0)
    expect(Math.abs(mid)).toBeLessThan(FIELD.zRef + 0.5)
    // 狙点の直前：|z| が発散に向かう
    expect(Math.abs(zf(0, -7.9))).toBeGreaterThan(2 * FIELD.zPeak)
  })
})

describe('planRuptorShot（#42）', () => {
  it('狙った味方の近傍に暴発点（misfirePos）を置く', () => {
    const e = ruptor({ x: 0, y: 10 })
    const t = ally('t', { x: 0, y: -8 })
    const plan = planRuptorShot(e, [t])
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    expect(dist(plan!.misfirePos!, t.pos)).toBeLessThan(FIELD.aoeRadius)
  })

  it('planEnemyShot は role=ruptor を専用計画に分岐する', () => {
    const e = ruptor({ x: 0, y: 10 })
    const plan = planEnemyShot(e, [ally('t', { x: 0, y: -8 })])
    expect(plan?.misfirePos).toBeTruthy()
  })

  it('line family しか持たなくても line では撃たない（迂回型と同じ制約・05b §2）', () => {
    const e = ruptor({ x: 0, y: 10 }, 'line')
    const plan = planRuptorShot(e, [ally('t', { x: 0, y: -8 })])
    expect(plan).not.toBeNull()
    // arc にフォールバックする＝軌道は曲率を持つ（直線なら中間点の横ずれが 0 になる）
    const { path } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    const mid = path[Math.floor(path.length / 2)]
    const start = path[0]
    const end = path[path.length - 1]
    // 始点→終点の直線からの中間点の距離が 0 より大きい（曲がっている）
    const L = dist(end, start)
    const cross = Math.abs((end.x - start.x) * (start.y - mid.y) - (start.x - mid.x) * (end.y - start.y)) / L
    expect(cross).toBeGreaterThan(0.3)
  })

  it('ruptorTarget=obstacles は味方でなく壁の近くに暴発点を置く（第4面デモ・#42）', () => {
    const e: Enemy = { ...ruptor({ x: 0, y: 12 }), ruptorTarget: 'obstacles' }
    const wall: Obstacle = {
      id: 'w',
      element: 'dark',
      solids: [{ x: 6, y: 0, r: 2.4 }],
      carves: [],
    }
    const t = ally('t', { x: -8, y: -10 })
    const plan = planRuptorShot(e, [t], [wall])
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    expect(dist(plan!.misfirePos!, { x: 6, y: 0 })).toBeLessThan(FIELD.aoeRadius)
    expect(dist(plan!.misfirePos!, t.pos)).toBeGreaterThan(FIELD.aoeRadius)
  })
})

describe('resolveTurn での崩し手の暴発と迎撃（#42・05-enemies §5.4b）', () => {
  const baseInput = (enemies: Enemy[], allies: Ally[], activeOrbits: ActiveOrbit[] = []) => ({
    allies,
    casts: [],
    enemies,
    castingEnemyIds: enemies.map((e) => e.id),
    obstacles: [] as Obstacle[],
    mechanics: { obstacles: true, enemyFire: true },
    activeOrbits,
  })

  it('迎撃されなければ狙点で暴発し、AoE 内の味方へ最大威力ダメージ＋misfires に計上される', () => {
    const e = ruptor({ x: 0, y: 10 })
    const t = ally('t', { x: 0, y: -8 }, 'neutral', 500) // クランプされない十分な HP
    const res = resolveTurn(baseInput([e], [t]))
    expect(res.misfires).toHaveLength(1)
    expect(res.misfires[0].owner).toBe('enemy')
    const shot = res.enemyShots[0]
    expect(shot.misfired).toBe(true)
    // 暴発は常に最大威力（power=sMax×maxFlightSpeed、×1.5）＝ 180
    expect(res.allies[0].hp).toBeLessThan(t.hp)
    expect(t.hp - res.allies[0].hp).toBeCloseTo(FIELD.sMax * FIELD.maxFlightSpeed * 1.5, 5)
  })

  it('反対極の結界が着弾前に速度を0にすれば、暴発せず instability も積まない', () => {
    const e = ruptor({ x: 0, y: 10 }) // 闇の弾
    const t = ally('t', { x: 0, y: -8 }, 'light')
    const guard = orbitAround('t', t.pos, FIELD.zRef) // 光（反対極）の結界
    const res = resolveTurn(baseInput([e], [t], [guard]))
    expect(res.misfires).toHaveLength(0)
    expect(res.enemyShots[0].misfired).toBe(false)
    expect(res.allies[0].hp).toBe(t.hp) // 無傷
  })

  it('同極の結界は素通りして暴発する（04-magic §4.6 のまま）', () => {
    const e = ruptor({ x: 0, y: 10 }) // 闇の弾
    const t = ally('t', { x: 0, y: -8 }, 'light')
    const guard = orbitAround('t', t.pos, -FIELD.zRef) // 闇（同極）の結界＝透過
    const res = resolveTurn(baseInput([e], [t], [guard]))
    expect(res.misfires).toHaveLength(1)
    expect(res.enemyShots[0].misfired).toBe(true)
  })
})
