import { describe, it, expect } from 'vitest'
import { resolveTurn } from './turn'
import type { Enemy, Mechanics, PlayerState, Trajectory } from './types'

const fullMechanics: Mechanics = { obstacles: true, shield: true, enemyFire: true, parry: true }
const onlyHit: Mechanics = { obstacles: false, shield: false, enemyFire: false, parry: false }

const player = (hp = 120): PlayerState => ({ hp, maxHp: 120, statuses: [], shield: null })

const enemy = (
  id: string,
  pos: { x: number; y: number },
  element: Enemy['element'],
  hp = 100,
  speed = 4,
  castZ = element === 'light' ? 3 : -3,
): Enemy => ({
  id,
  name: id,
  pos,
  hp,
  maxHp: hp,
  element,
  hitboxRadius: 1.1,
  statuses: [],
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: speed,
  castZ,
})

// +x 軸に沿って飛び、関数値 z=x で光を帯びる光線
const lightRay = (speed = 8): { kind: 'attack'; trajectory: Trajectory; initialSpeed: number } => ({
  kind: 'attack',
  trajectory: { mode: 'rotate', g: (x) => x, angle: -Math.PI / 4 },
  initialSpeed: speed,
})

describe('命中 → ダメージ（機能6・9）', () => {
  it('光を帯びた自弾が闇の敵に当たるとHPが減る', () => {
    const res = resolveTurn({
      player: player(),
      enemies: [enemy('e', { x: 5, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      action: lightRay(),
      mechanics: onlyHit,
    })
    expect(res.enemies[0].hp).toBeLessThan(100)
    expect(res.log.some((l) => l.kind === 'playerHit')).toBe(true)
  })

  it('どの敵にも当たらず場内で完結すると外れ（ダメージ0）', () => {
    const res = resolveTurn({
      player: player(),
      enemies: [enemy('e', { x: 10, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      action: { kind: 'attack', trajectory: { mode: 'polar', f: () => 5 }, initialSpeed: 5 },
      mechanics: onlyHit,
    })
    expect(res.enemies[0].hp).toBe(100)
    expect(res.log.some((l) => l.kind === 'miss')).toBe(true)
  })
})

describe('暴発（自爆）', () => {
  it('1/x は原点で暴発し術者を巻き込む', () => {
    const res = resolveTurn({
      player: player(),
      enemies: [enemy('e', { x: 8, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      action: { kind: 'attack', trajectory: { mode: 'rotate', g: (x) => 1 / x, angle: 0 }, initialSpeed: 5 },
      mechanics: onlyHit,
    })
    expect(res.player.hp).toBeLessThan(120)
    expect(res.log.some((l) => l.kind === 'misfire')).toBe(true)
  })
})

describe('パリィ（反対極で敵弾を相殺）', () => {
  it('闇を帯びた自弾で光の敵弾を相殺する', () => {
    const res = resolveTurn({
      player: player(),
      enemies: [enemy('e', { x: -5, y: 5 }, 'light', 100, 3, 3)], // 光の敵弾
      castingEnemyIds: ['e'],
      obstacles: [],
      // z=-x（闇）で第一象限(x,x)方向へ → 敵弾(直線 (-5,5)→O)と原点で交差
      action: { kind: 'attack', trajectory: { mode: 'rotate', g: (x) => -x, angle: Math.PI / 2 }, initialSpeed: 8 },
      mechanics: { ...fullMechanics, obstacles: false, shield: false },
    })
    expect(res.enemyShots[0].parried).toBe(true)
    expect(res.player.hp).toBe(120)
  })
})

describe('障害物（弾速を削る）', () => {
  it('障害物に当たると耐久が削れる', () => {
    const res = resolveTurn({
      player: player(),
      enemies: [enemy('e', { x: 9, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [{ id: 'o', pos: { x: 4, y: 0 }, hitboxRadius: 1, element: 'light', durability: 50, maxDurability: 50 }],
      action: lightRay(),
      mechanics: { ...onlyHit, obstacles: true },
    })
    expect(res.obstacles[0].durability).toBeLessThan(50)
    expect(res.log.some((l) => l.kind === 'obstacle')).toBe(true)
  })
})

describe('結界（敵弾を止める）', () => {
  it('結界が同極の敵弾を吸収して止め、被弾を防ぐ', () => {
    const res = resolveTurn({
      player: player(),
      enemies: [enemy('e', { x: 8, y: 0 }, 'light', 100, 4, 5)], // 強い光の敵弾(z=5・加速なし)
      castingEnemyIds: ['e'],
      obstacles: [],
      action: {
        kind: 'shield',
        shield: { shape: 'circle', params: { R: 4 }, element: 'light', durability: 100, maxDurability: 100 },
      },
      mechanics: { ...onlyHit, shield: true, enemyFire: true },
    })
    expect(res.enemyShots[0].blocked).toBe(true)
    expect(res.player.hp).toBe(120)
  })
})
