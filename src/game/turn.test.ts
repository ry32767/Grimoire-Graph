import { describe, it, expect } from 'vitest'
import { resolveTurn, traverseObstacles } from './turn'
import { simulateFlight } from './physics'
import { isSolidAt } from './obstacle'
import { FIELD } from '../data/constants'
import type { Ally, AllyCast, Enemy, Mechanics, Obstacle, Trajectory } from './types'

// 新モデル（#30）：属性は z 場（位置の関数）。テスト用の一定 z 場。
const zLight: (x: number, y: number) => number = () => FIELD.zPeak // 光・最強（|z|>zRef＝減速して失速する）
// 減速しない最大強度 |z|=zRef（中遠距離でも届く・周回も失速しない・#31）
const zLightMid: (x: number, y: number) => number = () => FIELD.zRef // 光・到達重視
const zDarkMid: (x: number, y: number) => number = () => -FIELD.zRef // 闇・到達重視

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

// 原点から +x へ飛び、z 場で光を帯びる光線（経路は g=x、属性は z 場で別指定）。
// 減速しない zRef で帯びる＝中距離の敵にも確実に届く（#31）。
const lightRay = (origin = { x: 0, y: 0 }): Trajectory => ({
  mode: 'rotate',
  g: (x) => x,
  angle: -Math.PI / 4,
  origin,
  z: zLightMid,
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
      // 敵(闇)は中立の味方へ光で攻撃するので、闇のリング(反対極)で迎撃する（#28）。
      // リングは減速しない zRef（|z|>zRef だと結界自身が失速して霧散するため・#31）。遅い敵弾を止めきる。
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zDarkMid })],
      enemies: [enemy('e', { x: 10, y: 0 }, 'dark', 100, 3)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    expect(res.log.some((l) => l.kind === 'orbit')).toBe(true)
    expect(res.allies[0].hp).toBe(100) // 迎撃で被弾なし
  })
})

describe('壁すり抜け防止（判定の密化・#1）', () => {
  it('頂点が大きく開く急な軌道でも壁を取りこぼさず削る', () => {
    // 傾き37の直線：頂点間隔 ≈ 0.08×√(1+37²) ≈ 3 ユニット（頂点と頂点の間に壁が入る）
    const steep: Trajectory = { mode: 'rotate', g: (x) => 37 * x, angle: 0, origin: { x: 0, y: 0 }, z: zLight }
    // 線上 x≈0.12 (pos≈(0.12,4.44)) に薄い壁。両隣の頂点(x=0.08,0.16)は半径1.3の外＝点判定だけだと素通り
    const wall: Obstacle = { id: 'thin', element: 'dark', solids: [{ x: 0.12, y: 4.44, r: 1.3 }], carves: [] }
    const flight = simulateFlight(steep, 10)
    const res = traverseObstacles(steep, 10, flight, [wall])
    // 密化判定により壁がえぐられる（すり抜けない）
    expect(res.carves.length).toBeGreaterThan(0)
    expect(wall.carves.length).toBeGreaterThan(0)
  })
})

describe('周回が魔法に負けると霧散する（#34）', () => {
  it('結界は敵弾に速度を削られ、0 になると破れて霧散する（#59・パリィ相互相殺）', () => {
    // 遅い闇結界(速度2) vs しっかりした光の敵弾 → 相互相殺で結界の速度が0になり霧散
    const e = { ...enemy('e', { x: 0, y: 12 }, 'light', 100, 12), castZField: () => FIELD.zRef }
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 }, 'dark')],
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zDarkMid }, 2)],
      enemies: [e],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    const orbitShot = res.allyShots.find((s) => s.kind === 'orbit')!
    expect(orbitShot.broken).toBe(true)
    expect(res.log.some((l) => l.text.includes('霧散'))).toBe(true)
  })

  it('止めきれない敵弾でも結界は減速して存続する（#59：失速した速度で回り続ける）', () => {
    // そこそこの闇結界(速度10) vs 光の敵弾 → 敵弾は弱まりつつ通過、結界は減速して存続（broken=false）
    const e = { ...enemy('e', { x: 0, y: 12 }, 'light', 100, 9), castZField: () => FIELD.zRef }
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 }, 'dark')],
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zDarkMid }, 10)],
      enemies: [e],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    const orbitShot = res.allyShots.find((s) => s.kind === 'orbit')!
    expect(orbitShot.broken).toBe(false) // 存続
    expect(orbitShot.ringSpeed).toBeLessThan(10) // 敵弾に当たって減速した
    expect(orbitShot.ringSpeed).toBeGreaterThan(0)
    expect(res.log.some((l) => l.text.includes('減速'))).toBe(true)
  })

  it('敵弾を止めきった周回は霧散しない（broken=false・存続）', () => {
    // 減速しない闇リング(|z|=zRef) vs 遅い光の敵弾 → 相殺して止める＝周回の勝ち（#31：強すぎる z は自滅）
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zDarkMid })],
      enemies: [enemy('e', { x: 10, y: 0 }, 'dark', 100, 3)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    const orbitShot = res.allyShots.find((s) => s.kind === 'orbit')!
    expect(orbitShot.broken).toBe(false)
  })

  it('十分強い結界は通常速度の敵弾を止める。ただし結界も減速する（#43/#59）', () => {
    // 速い闇結界(速度16) vs 光の敵弾(速度8) → 敵弾を止めきる（味方無傷）。結界は存続するが減速する
    const e = { ...enemy('e', { x: 0, y: 16 }, 'light', 100, 8), castZField: () => FIELD.zRef }
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 }, 'dark')],
      casts: [cast('a', { mode: 'polar', f: () => 6, origin: { x: 0, y: 0 }, z: zDarkMid }, 16)],
      enemies: [e],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    const orbitShot = res.allyShots.find((s) => s.kind === 'orbit')!
    expect(orbitShot.broken).toBe(false) // 結界は存続
    expect(res.enemyShots.every((s) => !s.reachedTarget)).toBe(true) // 敵弾は味方へ届かない
    expect(res.allies[0].hp).toBe(100) // 無傷
    expect(orbitShot.ringSpeed).toBeLessThan(16) // 止めても結界は減速する（#59）
  })

  it('強属性(|z|>zRef)の結界は失速して自滅し、消えたことがログで分かる（#31/#44）', () => {
    // z=zPeak(=5)>zRef の光リングは減速し速度0で自滅する。結界は broken になり、専用ログが出る。
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: -8 }, 'light')],
      casts: [cast('a', { mode: 'polar', f: () => 7, origin: { x: 0, y: -8 }, z: zLight }, 10)],
      enemies: [enemy('e', { x: 0, y: 14 }, 'dark', 100, 8)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    const orbitShot = res.allyShots.find((s) => s.kind === 'orbit')!
    expect(orbitShot.broken).toBe(true) // 失速で自滅する
    expect(res.log.some((l) => l.text.includes('失速') && l.text.includes('自滅'))).toBe(true) // 自滅ログで分かる
  })
})

describe('防御の重ね掛け（軌道型＋パリィ）', () => {
  it('リング迎撃とパリィの速度損が累積する（単独より強く減速）', () => {
    // 敵弾：(0,10)→味方(0,-4) の直線（光・強）。原点まわりの円リングと、下方の闇弾でパリィ。
    const en = enemy('e', { x: 0, y: 10 }, 'light', 100, 6)
    const allies = [ally('ring', { x: 0, y: 0 }), ally('parry', { x: -1, y: -4 }, 'dark')]
    const ringCast = cast('ring', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zDarkMid })
    // 闇の直線（パリィ用）：(-1,-4) から +x 方向へ薙ぐ → 敵弾(0,-y軸付近)と交差。減速しない zRef で届かせる
    const parryCast = cast('parry', { mode: 'rotate', g: (x) => -x, angle: 0, origin: { x: -1, y: -4 }, z: zDarkMid })

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

  it('パリィは相互相殺：反対極の敵弾と交差した自弾も減速し、与ダメが下がる（#59・A）', () => {
    // 味方a(光)が (0,-6)→上へ直進し、遠くの敵T(0,14) を撃つ。別の敵P の闇弾が y=4 で自弾と交差。
    // P が撃つと自弾が削られ、T への与ダメが減る（自弾が減速する＝相互相殺）。
    const target = enemy('T', { x: 0, y: 14 }, 'dark', 999, 5)
    // P は別の味方 b(HP低=狙われる) を狙い、その弾が (0,4) 付近で自弾と交差する
    const parrier = { ...enemy('P', { x: 10, y: 4 }, 'light', 100, 10), castZField: () => -FIELD.zRef }
    const allies = [ally('a', { x: 0, y: -6 }, 'light'), ally('b', { x: -10, y: 4 }, 'dark', 20)]
    const aCast = cast('a', { mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: { x: 0, y: -6 }, z: zLightMid }, 12)
    const base = { allies, casts: [aCast], enemies: [target, parrier], obstacles: [], mechanics: withFire }
    const withParry = resolveTurn({ ...base, castingEnemyIds: ['P'] })
    const noParry = resolveTurn({ ...base, castingEnemyIds: [] })
    const dmg = (r: ReturnType<typeof resolveTurn>) => 999 - r.enemies.find((e) => e.id === 'T')!.hp
    expect(dmg(noParry)).toBeGreaterThan(0) // 交差が無ければ自弾は満速で命中
    expect(dmg(withParry)).toBeLessThan(dmg(noParry)) // 敵弾と相殺して自弾が削られ、与ダメ減
    expect(withParry.log.some((l) => l.kind === 'parry')).toBe(true)
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
      // 光・低速・+x直進（減速しない zRef で壁まで届くが、同極の厚い壁を削り切れず止まる・#31）
      casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLightMid }, 5)],
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
      // 速め(12)に撃ってえぐり半径を確保（zRef は強度が中庸なので速度で威力を出す・#31）
      casts: [cast('a', lightRay(), 12)],
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
    // 1発で消し飛ばさず、掘り進めるには複数発要る。減速しない zRef で壁の奥（敵）まで届かせる（#31）。
    let obstacles = [lightWall(4, 12)]
    const fireMax = () => {
      const res = resolveTurn({
        allies: [ally('a', { x: 0, y: 0 })],
        casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLightMid }, 14)],
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
      casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLightMid }, 4)],
      enemies: [enemy('e', { x: 20, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [lightWall(4, 12)],
      mechanics: withObs,
    })
    expect(res.enemies[0].hp).toBe(100) // 届かない
    expect(isSolidAt(res.obstacles[0], { x: 10, y: 0 })).toBe(true) // 壁の奥は残る
  })
})

describe('周回オーラ（#39：固定回復・重複・入れ子は内側優先）', () => {
  const healAlly = (id: string, pos: { x: number; y: number }, hp: number, maxHp: number): Ally => ({
    id,
    name: id,
    pos,
    hp,
    maxHp,
    element: 'neutral',
    statuses: [],
  })

  it('光リング1重で囲まれた味方は固定量(30)回復する（強度に依らない）', () => {
    const res = resolveTurn({
      allies: [healAlly('a', { x: 0, y: 0 }, 50, 200)],
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zLightMid })],
      enemies: [enemy('e', { x: 0, y: 20 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    expect(res.allies[0].hp).toBe(80) // 50 + 30
  })

  it('光リング2重なら回復は重複する（30×2）', () => {
    const res = resolveTurn({
      allies: [healAlly('a', { x: 0, y: 0 }, 50, 200), healAlly('b', { x: 0, y: 0 }, 100, 200)],
      casts: [
        cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zLightMid }),
        cast('b', { mode: 'polar', f: () => 9, origin: { x: 0, y: 0 }, z: zLightMid }),
      ],
      enemies: [enemy('e', { x: 0, y: 26 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    expect(res.allies.find((x) => x.id === 'a')!.hp).toBe(110) // 50 + 30 + 30
  })

  it('入れ子（光・闇・光）は内側2つだけ効く＝内の光と中の闇のみ', () => {
    const res = resolveTurn({
      allies: [
        healAlly('t', { x: 0, y: 0 }, 50, 200),
        healAlly('c1', { x: 0, y: 0 }, 100, 200),
        healAlly('c2', { x: 0, y: 0 }, 100, 200),
        healAlly('c3', { x: 0, y: 0 }, 100, 200),
      ],
      casts: [
        cast('c1', { mode: 'polar', f: () => 4, origin: { x: 0, y: 0 }, z: zLightMid }), // 内・光
        cast('c2', { mode: 'polar', f: () => 7, origin: { x: 0, y: 0 }, z: zDarkMid }), // 中・闇
        cast('c3', { mode: 'polar', f: () => 10, origin: { x: 0, y: 0 }, z: zLightMid }), // 外・光（無視）
      ],
      enemies: [enemy('e', { x: 0, y: 28 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    const t = res.allies.find((x) => x.id === 't')!
    expect(t.hp).toBe(80) // 50 + 30（内側の光のみ。外側の光は入れ子で無視）
    expect(t.concealed).toBe(1) // 中の闇で1重
  })
})

describe('周回の永続化（#39：破壊されるまで残る）', () => {
  const lightAlly = (id: string, pos: { x: number; y: number }, hp: number, maxHp: number): Ally => ({
    id,
    name: id,
    pos,
    hp,
    maxHp,
    element: 'light',
    statuses: [],
  })

  it('前ターンの周回が残り、撃ち直さなくても回復し続ける', () => {
    const t1 = resolveTurn({
      allies: [lightAlly('a', { x: 0, y: 0 }, 50, 200)],
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zLightMid })],
      enemies: [enemy('e', { x: 0, y: 20 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    expect(t1.orbits.length).toBe(1)
    expect(t1.allies[0].hp).toBe(80) // 50 + 30
    // 次ターン：新規キャストなし。永続周回だけで回復する
    const t2 = resolveTurn({
      allies: t1.allies,
      casts: [],
      enemies: t1.enemies,
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
      activeOrbits: t1.orbits,
    })
    expect(t2.allies[0].hp).toBe(110) // さらに +30
    expect(t2.orbits.length).toBe(1) // 残り続ける
  })

  it('反対属性の敵弾に相殺されると永続周回は消える', () => {
    const t1 = resolveTurn({
      allies: [lightAlly('a', { x: 0, y: 0 }, 100, 200)],
      casts: [cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zLightMid })],
      enemies: [enemy('e', { x: 10, y: 0 }, 'dark', 100, 14)],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    expect(t1.orbits.length).toBe(1)
    // 次ターン：速い闇の敵弾（光の味方を狙う＝闇）が光リングを破る
    const t2 = resolveTurn({
      allies: t1.allies,
      casts: [],
      enemies: [enemy('e', { x: 10, y: 0 }, 'dark', 100, 14)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
      activeOrbits: t1.orbits,
    })
    expect(t2.orbits.length).toBe(0) // 相殺で消滅
    expect(t2.log.some((l) => l.text.includes('消滅'))).toBe(true)
  })
})

describe('敵 guardian の結界効果（#61）', () => {
  it('光の敵結界は内側の敵を回復し、結界は持続結界(owner=enemy)として残る', () => {
    // 傷ついた光の守護者が自分の周りに光結界を張る → 自分を回復。結界は次ターンへ持ち越す
    const g: Enemy = { ...enemy('g', { x: 0, y: 12 }, 'light', 100, 6), role: 'guardian', hp: 50 }
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: -12 }, 'dark')],
      casts: [],
      enemies: [g],
      castingEnemyIds: ['g'],
      obstacles: [],
      mechanics: withFire,
    })
    const healed = res.enemies.find((e) => e.id === 'g')!
    expect(healed.hp).toBeGreaterThan(50) // 光結界で回復した
    expect(res.orbits.some((o) => o.owner === 'enemy' && o.ownerId === 'g')).toBe(true) // 敵結界が残る
    expect(res.log.some((l) => l.text.includes('光の結界') && l.text.includes('回復'))).toBe(true)
  })

  it('闇の敵結界は敵を回復しない（視認阻害は描画側で表現）', () => {
    const g: Enemy = { ...enemy('g', { x: 0, y: 12 }, 'dark', 100, 6), role: 'guardian', hp: 50 }
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: -12 }, 'light')],
      casts: [],
      enemies: [g],
      castingEnemyIds: ['g'],
      obstacles: [],
      mechanics: withFire,
    })
    const e = res.enemies.find((x) => x.id === 'g')!
    expect(e.hp).toBe(50) // 闇は回復しない
    expect(res.orbits.some((o) => o.owner === 'enemy' && o.ownerId === 'g')).toBe(true) // 闇結界も持続（視認阻害用）
  })

  it('敵結界は張り直さなくても次ターンへ持続し、毎ターン内側の敵を回復する（#61）', () => {
    const g: Enemy = { ...enemy('g', { x: 0, y: 12 }, 'light', 200, 6), role: 'guardian', hp: 50 }
    const t1 = resolveTurn({
      allies: [ally('a', { x: 0, y: -12 }, 'dark')],
      casts: [],
      enemies: [g],
      castingEnemyIds: ['g'],
      obstacles: [],
      mechanics: withFire,
    })
    const hp1 = t1.enemies.find((e) => e.id === 'g')!.hp
    expect(hp1).toBeGreaterThan(50)
    // 次ターン：guardian は発射しない（ひるみ等）が、持続結界が残って回復し続ける
    const t2 = resolveTurn({
      allies: t1.allies,
      casts: [],
      enemies: t1.enemies,
      castingEnemyIds: [],
      obstacles: [],
      mechanics: withFire,
      activeOrbits: t1.orbits,
    })
    expect(t2.orbits.some((o) => o.owner === 'enemy' && o.ownerId === 'g')).toBe(true) // 破壊されるまで残る
    expect(t2.enemies.find((e) => e.id === 'g')!.hp).toBeGreaterThan(hp1) // 持続結界でも回復
  })

  it('持続中の敵結界は反対極の味方弾で相殺・破壊できる（#59/#61）', () => {
    const g: Enemy = { ...enemy('g', { x: 12, y: 0 }, 'light', 200, 6), role: 'guardian' }
    const t1 = resolveTurn({
      allies: [ally('a', { x: -12, y: 0 }, 'dark')],
      casts: [],
      enemies: [g],
      castingEnemyIds: ['g'],
      obstacles: [],
      mechanics: withFire,
    })
    expect(t1.orbits.some((o) => o.owner === 'enemy')).toBe(true)
    // 次ターン：闇（反対極）の強い弾を結界へ撃ち込む → 相互相殺で結界が減速 or 破壊される
    const darkShot: Trajectory = {
      mode: 'rotate',
      g: (x) => x,
      angle: -Math.PI / 4,
      origin: { x: -12, y: 0 },
      z: zDarkMid,
    }
    const t2 = resolveTurn({
      allies: t1.allies,
      casts: [cast('a', darkShot, 14)],
      enemies: t1.enemies,
      castingEnemyIds: [],
      obstacles: [],
      mechanics: withFire,
      activeOrbits: t1.orbits,
    })
    // 相互相殺の衝突が発生し、弾側にも減速が及ぶ（クラッシュ点が記録される）
    expect(t2.clashes.length).toBeGreaterThan(0)
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

describe('暴発の壁破壊（#41）', () => {
  // 真上へ直進。z 場が y>7 でエラー → (0,~7) で暴発する軌道。
  const upMisfire: Trajectory = {
    mode: 'rotate',
    g: () => 0,
    angle: Math.PI / 2,
    origin: { x: 0, y: 0 },
    z: (_x, y) => (y > 7 ? NaN : FIELD.zRef),
  }

  it('AoE 内の壁素材を削る（範囲内の点が素材でなくなる）', () => {
    const wall: Obstacle = { id: 'w', element: 'neutral', solids: [{ x: 0, y: 9, r: 2.4 }], carves: [] }
    expect(isSolidAt(wall, { x: 0, y: 9 })).toBe(true)
    const res = resolveTurn({
      allies: [ally('m', { x: 0, y: 0 })],
      casts: [cast('m', upMisfire)],
      enemies: [],
      castingEnemyIds: [],
      obstacles: [wall],
      mechanics: withObs,
    })
    const w2 = res.obstacles.find((o) => o.id === 'w')!
    expect(w2.carves.length).toBeGreaterThan(0)
    expect(isSolidAt(w2, { x: 0, y: 9 })).toBe(false) // AoE 内の素材は消えた
    // 暴発ログが出ている
    expect(res.log.some((l) => l.kind === 'misfire')).toBe(true)
  })

  it('AoE 内に倒れた敵(hp0)がいてもダメージ判定を出さない（生存敵だけ巻き込む）', () => {
    // 暴発点は (0,~7)。弾の直線上(x=0)に死体、外れた位置(x=3)に生存敵を AoE 内へ置く
    const dead = enemy('dead', { x: 0, y: 6 }, 'dark', 0) // すでに撃破済み（AoE 内・経路上だが hp0 で素通り）
    const alive = enemy('alive', { x: 3, y: 7 }, 'dark', 80) // 生存（AoE 内・経路外）
    const res = resolveTurn({
      allies: [ally('m', { x: 0, y: 0 })],
      casts: [cast('m', upMisfire)],
      enemies: [dead, alive],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    // 倒した敵にはポップアップもダメージも出ない
    expect(res.popups.some((p) => p.targetId === 'dead')).toBe(false)
    expect(res.enemies.find((e) => e.id === 'dead')!.statuses).toHaveLength(0)
    // 生存敵には暴発の白ダメージが入る
    expect(res.popups.some((p) => p.targetId === 'alive' && p.kind === 'misfire')).toBe(true)
    expect(res.enemies.find((e) => e.id === 'alive')!.hp).toBeLessThan(80)
  })

  it('壊れない壁（unbreakable）は暴発でも削れない', () => {
    const wall: Obstacle = { id: 'u', element: 'neutral', kind: 'unbreakable', solids: [{ x: 0, y: 9, r: 2.4 }], carves: [] }
    const res = resolveTurn({
      allies: [ally('m', { x: 0, y: 0 })],
      casts: [cast('m', upMisfire)],
      enemies: [],
      castingEnemyIds: [],
      obstacles: [wall],
      mechanics: withObs,
    })
    const w2 = res.obstacles.find((o) => o.id === 'u')!
    expect(w2.carves.length).toBe(0)
    expect(isSolidAt(w2, { x: 0, y: 9 })).toBe(true) // 残る
  })
})
