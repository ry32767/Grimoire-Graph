import { describe, it, expect } from 'vitest'
import { resolveTurn } from './turn'
import { isSolidAt } from './obstacle'
import { FIELD } from '../data/constants'
import type { Ally, AllyCast, Enemy, Mechanics, Obstacle, Trajectory } from './types'

// 新モデル（#30）：属性は z 場（位置の関数）。テスト用の一定 z 場。
const zLight: (x: number, y: number) => number = () => FIELD.zPeak // 光・最強
const zDark: (x: number, y: number) => number = () => -FIELD.zPeak // 闇・最強

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

// 原点から +x へ飛び、z 場で光(最強)を帯びる光線（経路は g=x、属性は z 場で別指定）
const lightRay = (origin = { x: 0, y: 0 }): Trajectory => ({
  mode: 'rotate',
  g: (x) => x,
  angle: -Math.PI / 4,
  origin,
  z: zLight,
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
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zLight })],
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
    const ringCast = cast('ring', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zDark })
    // 闇の直線（パリィ用）：(-1,-4) から +x 方向へ薙ぐ → 敵弾(0,-y軸付近)と交差
    const parryCast = cast('parry', { mode: 'rotate', g: (x) => -x, angle: 0, origin: { x: -1, y: -4 }, z: zDark })

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

// +x 軸上に伸びる光のブロブ壁（中心 [x0,x1] を半径 1.6 の円で埋める）
const lightWall = (x0: number, x1: number): Obstacle => ({
  id: 'wall',
  element: 'light',
  solids: Array.from({ length: Math.round((x1 - x0) / 1.6) + 1 }, (_, i) => ({
    x: x0 + i * 1.6,
    y: 0,
    r: 1.6,
  })),
  carves: [],
})

describe('障害物の削り・貫通条件（#1/#16）', () => {
  it('厚い同極の壁は弱い弾を止めて貫通させない（削り切れず消滅・敵に届かない）', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      // 強い光・低速・+x直進（強属性なので加速せず、同極の厚い壁を削り切れない）
      casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLight }, 5)],
      enemies: [enemy('e', { x: 20, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [lightWall(4, 14)], // 同極＝削りにくい厚い壁
      mechanics: withObs,
    })
    expect(res.enemies[0].hp).toBe(100) // 敵には届かない
    expect(res.log.some((l) => l.kind === 'obstacle' && l.text.includes('止まった'))).toBe(true)
    expect(isSolidAt(res.obstacles[0], { x: 13, y: 0 })).toBe(true) // 壁の奥は残る
  })

  it('魔法が当たった点を中心に円でえぐられ穴が開く（carves）', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', lightRay())],
      enemies: [enemy('e', { x: 9, y: 0 }, 'dark')],
      castingEnemyIds: [],
      // lightRay は +x 軸上を進む（pos=(√2·x, 0)）。(4,0) のブロブを通過する
      obstacles: [{ id: 'o', element: 'light', solids: [{ x: 4, y: 0, r: 1.6 }], carves: [] }],
      mechanics: withObs,
    })
    expect(res.obstacles[0].carves.length).toBeGreaterThan(0) // 円が引かれた
    expect(isSolidAt(res.obstacles[0], { x: 4, y: 0 })).toBe(false) // 当たった所に穴
    expect(res.log.some((l) => l.kind === 'obstacle')).toBe(true)
  })

  it('厚い壁は最大威力でも1発で貫通できず、撃ち続ければ数発で貫通する（#1/#16）', () => {
    // 1発で消し飛ばさず、掘り進めるには複数発要る。強属性 z=5 で加速させない。
    let obstacles = [lightWall(4, 12)]
    const fireMax = () => {
      const res = resolveTurn({
        allies: [ally('a', { x: 0, y: 0 })],
        casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLight }, 14)],
        enemies: [enemy('e', { x: 20, y: 0 }, 'dark')],
        castingEnemyIds: [],
        obstacles,
        mechanics: withObs,
      })
      obstacles = res.obstacles // 削り跡を次の発に引き継ぐ
      return res.enemies[0].hp
    }
    const hp1 = fireMax()
    expect(hp1).toBe(100) // 1発では貫通できない
    let hp = hp1
    let shots = 1
    while (hp === 100 && shots < 12) {
      hp = fireMax()
      shots++
    }
    expect(hp).toBeLessThan(100) // 撃ち続ければ貫通して命中
    expect(shots).toBeGreaterThanOrEqual(2) // 1発では無理だった
  })

  it('低威力の弾は厚い壁で止まる（貫通しない）', () => {
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLight }, 4)],
      enemies: [enemy('e', { x: 20, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [lightWall(4, 12)],
      mechanics: withObs,
    })
    expect(res.enemies[0].hp).toBe(100) // 届かない
    expect(isSolidAt(res.obstacles[0], { x: 10, y: 0 })).toBe(true) // 壁の奥は残る
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
