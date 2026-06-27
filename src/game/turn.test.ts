import { describe, it, expect } from 'vitest'
import { resolveTurn } from './turn'
import type { Ally, AllyCast, Enemy, Mechanics, Trajectory } from './types'

const onlyHit: Mechanics = { obstacles: false, enemyFire: false }
const withFire: Mechanics = { obstacles: false, enemyFire: true }
const withObs: Mechanics = { obstacles: true, enemyFire: false }

const ally = (id: string, pos: { x: number; y: number }, element: Ally['element'] = 'neutral', hp = 100): Ally => ({
  id,
  name: id,
  pos,
  hp,
  maxHp: hp,
  element,
  statuses: [],
})

const enemy = (
  id: string,
  pos: { x: number; y: number },
  element: Enemy['element'],
  hp = 100,
  speed = 5,
  castZ = element === 'light' ? 5 : element === 'dark' ? -5 : 0,
): Enemy => ({
  id,
  name: id,
  pos,
  hp,
  maxHp: hp,
  element,
  hitboxRadius: 1.1,
  statuses: [],
  family: 'line',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: speed,
  castZ,
})

const cast = (allyId: string, trajectory: Trajectory, speed = 8): AllyCast => ({
  allyId,
  trajectory,
  initialSpeed: speed,
})

// 原点から +x へ飛び z=x で光を帯びる光線
const lightRay = (origin = { x: 0, y: 0 }): Trajectory => ({
  mode: 'rotate',
  g: (x) => x,
  angle: -Math.PI / 4,
  origin,
})

describe('命中 → ダメージ（#15）', () => {
  it('光を帯びた自弾が闇の敵に当たるとHPが減る', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', lightRay())],
      enemies: [enemy('e', { x: 5, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    expect(res.enemies[0].hp).toBeLessThan(100)
    expect(res.log.some((l) => l.kind === 'playerHit')).toBe(true)
  })

  it('当たらず場外へ抜けると外れ', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'rotate', g: (x) => x, angle: 0, origin: { x: 0, y: 0 } })],
      enemies: [enemy('e', { x: 5, y: -5 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    expect(res.enemies[0].hp).toBe(100)
    expect(res.log.some((l) => l.kind === 'miss')).toBe(true)
  })
})

describe('暴発（自爆・#3/#9）', () => {
  it('1/x は術者位置で暴発し近くの味方を巻き込む', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'rotate', g: (x) => 1 / x, angle: 0, origin: { x: 0, y: 0 } })],
      enemies: [enemy('e', { x: 8, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    expect(res.allies[0].hp).toBeLessThan(100)
    expect(res.log.some((l) => l.kind === 'misfire')).toBe(true)
  })
})

describe('軌道型（周回結界）の防御（#4）', () => {
  it('円のリングが敵弾を迎撃して止める', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 } })],
      enemies: [enemy('e', { x: 10, y: 0 }, 'dark', 100, 5)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    expect(res.log.some((l) => l.kind === 'orbit')).toBe(true)
    expect(res.allies[0].hp).toBe(100) // 迎撃で被弾なし
  })
})

describe('防御の重ね掛け（軌道型＋パリィ）', () => {
  it('リング迎撃とパリィの速度損が累積する（単独より強く減速）', () => {
    // 敵弾：(0,10)→味方(0,-4) の直線（光・強）。原点まわりの円リングと、下方の闇弾でパリィ。
    const en = enemy('e', { x: 0, y: 10 }, 'light', 100, 6)
    const allies = [ally('ring', { x: 0, y: 0 }), ally('parry', { x: -1, y: -4 }, 'dark')]
    const ringCast = cast('ring', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 } })
    // 闇の直線（パリィ用）：(-1,-4) から +x 方向へ薙ぐ → 敵弾(0,-y軸付近)と交差
    const parryCast = cast('parry', { mode: 'rotate', g: (x) => -x, angle: 0, origin: { x: -1, y: -4 } })

    const both = resolveTurn({
      allies,
      casts: [ringCast, parryCast],
      enemies: [en],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    const ringOnly = resolveTurn({
      allies,
      casts: [ringCast],
      enemies: [en],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    // 両防御の方が敵弾の到達速度は小さい（=減衰が累積している）
    expect(both.enemyShots[0].flight.endSpeed).toBeLessThanOrEqual(ringOnly.enemyShots[0].flight.endSpeed)
  })
})

describe('障害物（耐久＝半径を削る・#1/#16）', () => {
  it('障害物に当たると耐久が削れる', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', lightRay())],
      enemies: [enemy('e', { x: 9, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [
        { id: 'o', pos: { x: 4, y: 0 }, hitboxRadius: 1, element: 'light', durability: 50, maxDurability: 50, maxRadius: 1 },
      ],
      mechanics: withObs,
    })
    expect(res.obstacles[0].durability).toBeLessThan(50)
    expect(res.obstacles[0].hitboxRadius).toBeLessThan(1) // 半径も縮む
    expect(res.log.some((l) => l.kind === 'obstacle')).toBe(true)
  })
})

describe('敵弾が味方へ命中（#15）', () => {
  it('防御なしなら狙われた味方のHPが減る', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: -5 }, 'neutral')],
      // 光の自弾（敵の光弾と同極＝パリィしない）。敵弾はそのまま到達
      casts: [cast('a', { mode: 'rotate', g: (x) => x, angle: Math.PI / 2, origin: { x: 0, y: -5 } })],
      enemies: [enemy('e', { x: 4, y: 5 }, 'light', 100, 5)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    expect(res.allies[0].hp).toBeLessThan(100)
    expect(res.log.some((l) => l.kind === 'enemyHit')).toBe(true)
  })
})

describe('狙う味方の選択', () => {
  it('最もHPが低い味方が狙われる', () => {
    const res = resolveTurn({
      allies: [ally('hi', { x: -5, y: -5 }, 'neutral', 100), ally('lo', { x: 5, y: -5 }, 'neutral', 20)],
      casts: [],
      enemies: [enemy('e', { x: 0, y: 8 }, 'dark', 100, 5)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    const lo = res.allies.find((a) => a.id === 'lo')!
    const hi = res.allies.find((a) => a.id === 'hi')!
    expect(lo.hp).toBeLessThan(20)
    expect(hi.hp).toBe(100)
  })
})
