import { describe, it, expect } from 'vitest'
import { resolveTurn } from './turn'
import type { Enemy, Field, Mechanics, PlayerState, Trajectory } from './types'

const fullMechanics: Mechanics = { obstacles: true, shield: true, enemyFire: true, parry: true }
const onlyHit: Mechanics = { obstacles: false, shield: false, enemyFire: false, parry: false }

const player = (hp = 100): PlayerState => ({ hp, maxHp: 100, statuses: [], shield: null })

const enemy = (id: string, pos: { x: number; y: number }, element: Enemy['element'], hp = 100, speed = 4): Enemy => ({
  id,
  name: id,
  pos,
  hp,
  maxHp: hp,
  element,
  hitboxRadius: 1,
  statuses: [],
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: speed,
})

const lineAttack = (speed = 5): { kind: 'attack'; trajectory: Trajectory; initialSpeed: number } => ({
  kind: 'attack',
  trajectory: { mode: 'rotate', g: () => 0, angle: 0 }, // +x 方向
  initialSpeed: speed,
})

describe('命中 → ダメージ（機能6・9）', () => {
  it('自弾が敵に当たると敵HPが減る', () => {
    const field: Field = () => 3 // 光・強度3
    const res = resolveTurn({
      field,
      player: player(),
      enemies: [enemy('e', { x: 5, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      action: lineAttack(),
      mechanics: onlyHit,
    })
    expect(res.enemies[0].hp).toBeLessThan(100)
    expect(res.log.some((l) => l.kind === 'playerHit')).toBe(true)
  })

  it('どの敵にも当たらず場内で完結すると外れ（ダメージ0）', () => {
    const field: Field = () => 3
    const res = resolveTurn({
      field,
      player: player(),
      enemies: [enemy('e', { x: 10, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      action: { kind: 'attack', trajectory: { mode: 'polar', f: () => 5 }, initialSpeed: 5 }, // 円(半径5)は場内で完結
      mechanics: onlyHit,
    })
    expect(res.enemies[0].hp).toBe(100)
    expect(res.log.some((l) => l.kind === 'miss')).toBe(true)
  })
})

describe('暴発（自爆）', () => {
  it('1/x は原点で暴発し術者を巻き込む', () => {
    const field: Field = () => 0
    const res = resolveTurn({
      field,
      player: player(),
      enemies: [enemy('e', { x: 8, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      action: { kind: 'attack', trajectory: { mode: 'rotate', g: (x) => 1 / x, angle: 0 }, initialSpeed: 5 },
      mechanics: onlyHit,
    })
    expect(res.player.hp).toBeLessThan(100)
    expect(res.log.some((l) => l.kind === 'misfire')).toBe(true)
  })
})

describe('パリィ（反対極で敵弾を相殺）', () => {
  it('闇を帯びた敵弾を光の自弾で相殺する', () => {
    const field: Field = (x) => x * 5 // x>0 で光、x<0 で闇（強度高め＝加速域は原点近傍のみ）
    const res = resolveTurn({
      field,
      player: player(),
      enemies: [enemy('e', { x: -5, y: 5 }, 'light', 100, 3)],
      castingEnemyIds: ['e'],
      obstacles: [],
      // 自弾は +x（光の領域）へ：path (x,x) → 光を帯びる
      action: { kind: 'attack', trajectory: { mode: 'rotate', g: (x) => x, angle: 0 }, initialSpeed: 6 },
      mechanics: { ...fullMechanics, obstacles: false, shield: false },
    })
    expect(res.enemyShots[0].parried).toBe(true)
    expect(res.player.hp).toBe(100) // 敵弾は相殺され被弾なし
  })
})

describe('障害物（弾速を削る）', () => {
  it('障害物に当たると耐久が削れる', () => {
    const field: Field = () => 3
    const res = resolveTurn({
      field,
      player: player(),
      enemies: [enemy('e', { x: 9, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [{ id: 'o', pos: { x: 4, y: 0 }, hitboxRadius: 1, element: 'light', durability: 50, maxDurability: 50 }],
      action: lineAttack(),
      mechanics: { ...onlyHit, obstacles: true },
    })
    expect(res.obstacles[0].durability).toBeLessThan(50)
    expect(res.log.some((l) => l.kind === 'obstacle')).toBe(true)
  })
})

describe('結界（敵弾を止める）', () => {
  it('結界が低速の敵弾を止め、被弾を防ぐ', () => {
    const field: Field = () => 5 // 強属性帯（加速0）で再加速を防ぐ
    const res = resolveTurn({
      field,
      player: player(),
      enemies: [enemy('e', { x: 8, y: 0 }, 'light', 100, 4)],
      castingEnemyIds: ['e'],
      obstacles: [],
      action: {
        kind: 'shield',
        shield: { shape: 'circle', params: { R: 4 }, element: 'light', durability: 100, maxDurability: 100 },
      },
      mechanics: { ...onlyHit, shield: true, enemyFire: true },
    })
    expect(res.enemyShots[0].blocked).toBe(true)
    expect(res.player.hp).toBe(100)
  })
})
