// 攻撃パターンの拡張（05b）：迂回型高難度の同極すり抜け・守護型の交互張り/回復/配置のテスト。
import { describe, it, expect } from 'vitest'
import { planEnemyShot } from './enemyAI'
import { prepareTurn, createBattleState } from './battle'
import { resolveTurn } from './turn'
import { buildRing, attachRingSpeeds, ringRadius } from './orbit'
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
function ringOrbit(center: { x: number; y: number }, z: number, ownerId = 't'): ActiveOrbit {
  const traj: Trajectory = { mode: 'polar', f: () => 4, origin: center, z: constZField(z) }
  return { id: 'orb', ownerId, owner: 'player', ring: attachRingSpeeds(buildRing(traj), 10), ringSpeed: 10 }
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
