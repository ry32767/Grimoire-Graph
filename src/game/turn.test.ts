import { describe, it, expect } from 'vitest'
import { resolveTurn, traverseObstacles } from './turn'
import { simulateFlight } from './physics'
import { isSolidAt } from './obstacle'
import { firstHit } from './collision'
import { computeDamage, zfieldAt } from './attribute'
import { orbitSweep } from './orbit'
import { FIELD, GAME } from '../data/constants'
import type { ActiveOrbit, Ally, AllyCast, Enemy, Mechanics, Obstacle, Trajectory } from './types'

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

describe('同時発射の攻撃は物理イベント時刻順に解決する', () => {
  const straight = (origin: { x: number; y: number }): Trajectory => ({
    mode: 'rotate', g: () => 0, angle: 0, origin, z: zLightMid,
  })
  const run = (reverse: boolean, targetHp: number) => {
    const slow = cast('slow', straight({ x: -8, y: 0 }), 8)
    const fast = cast('fast', straight({ x: 0, y: 0 }), 8)
    const casts = reverse ? [fast, slow] : [slow, fast]
    return resolveTurn({
      allies: [ally('slow', { x: -8, y: 0 }), ally('fast', { x: 0, y: 0 })],
      casts,
      enemies: [enemy('target', { x: 5, y: 0 }, 'dark', targetHp)],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
  }
  const attackSummary = (result: ReturnType<typeof resolveTurn>) => ({
    hp: result.enemies[0].hp,
    hits: result.allyShots
      .map((shot) => ({ allyId: shot.allyId, hits: shot.hits }))
      .sort((a, b) => a.allyId.localeCompare(b.allyId)),
    popups: result.popups.map(({ targetId, amount, kind, t }) => ({ targetId, amount, kind, t })),
  })

  it('到達時刻の違う2発は casts を反転してもHP・hits・popupsが一致する', () => {
    const forward = attackSummary(run(false, 1000))
    const reversed = attackSummary(run(true, 1000))

    expect(reversed).toEqual(forward)
    expect(forward.hits.every((shot) => shot.hits.length === 1)).toBe(true)
    expect(forward.popups[0].t).toBeLessThan(forward.popups[1].t)
  })

  it('早い致死弾の後に到達する弾は casts 順にかかわらず撃破済み対象へ命中しない', () => {
    const forward = attackSummary(run(false, 1))
    const reversed = attackSummary(run(true, 1))

    expect(reversed).toEqual(forward)
    expect(forward.hp).toBe(0)
    expect(forward.hits.find((shot) => shot.allyId === 'fast')?.hits).toHaveLength(1)
    expect(forward.hits.find((shot) => shot.allyId === 'slow')?.hits).toHaveLength(0)
    expect(forward.popups).toHaveLength(1)
  })
})

describe('敵の同時攻撃も物理イベント時刻順に解決する', () => {
  const run = (reverse: boolean, targetHp: number) => {
    const far = enemy('far', { x: 0, y: 12 }, 'dark', 100, 8)
    const near = enemy('near', { x: 0, y: 5 }, 'dark', 100, 8)
    const enemies = reverse ? [near, far] : [far, near]
    const castingEnemyIds = reverse ? ['near', 'far'] : ['far', 'near']
    return resolveTurn({
      allies: [ally('target', { x: 0, y: -8 }, 'neutral', targetHp)],
      casts: [],
      enemies,
      castingEnemyIds,
      obstacles: [],
      mechanics: withFire,
    })
  }
  const attackSummary = (result: ReturnType<typeof resolveTurn>) => ({
    hp: result.allies[0].hp,
    hits: result.enemyShots
      .map((shot) => ({ enemyId: shot.enemyId, hits: shot.hits }))
      .sort((a, b) => a.enemyId.localeCompare(b.enemyId)),
    popups: result.popups.map(({ targetId, amount, kind, t }) => ({ targetId, amount, kind, t })),
  })

  it('enemies と castingEnemyIds を反転しても味方HP・hits・popupsが一致する', () => {
    const forward = attackSummary(run(false, 1000))
    const reversed = attackSummary(run(true, 1000))

    expect(reversed).toEqual(forward)
    expect(forward.hits.every((shot) => shot.hits.length === 1)).toBe(true)
    expect(forward.popups[0].t).toBeLessThan(forward.popups[1].t)
  })

  it('早い敵の致死弾後に到達する敵弾は配列順にかかわらず命中しない', () => {
    const forward = attackSummary(run(false, 1))
    const reversed = attackSummary(run(true, 1))

    expect(reversed).toEqual(forward)
    expect(forward.hp).toBe(0)
    expect(forward.hits.find((shot) => shot.enemyId === 'near')?.hits).toHaveLength(1)
    expect(forward.hits.find((shot) => shot.enemyId === 'far')?.hits).toHaveLength(0)
    expect(forward.popups).toHaveLength(1)
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

  it('威力で勝った結界は敵弾を消し、残威力ぶんの速度で回り続ける（威力の引き算）', () => {
    // 闇結界(速度10・威力25) vs 光の敵弾(速度9・威力22.5) → 結界の勝ち：敵弾は消滅し、
    // 結界は残威力（25−22.5）を速度に換算した分だけ残して存続する（broken=false）
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
    // 回り出す前の自壊は bornBroken=true・breakTime は null のまま（実際に破壊された時刻ではない・#75）
    expect(orbitShot.bornBroken).toBe(true)
    expect(orbitShot.breakTime).toBeNull()
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
    // P は別の味方 b(反対極＋HP低=狙われる) を狙い、その弾が (0,4) 付近で自弾と交差する。
    // 敵AI は castZField（闇 −zRef）の実属性で採点するため、b=光（相性1.5・低HP）が
    // a=闇（同極0.5）より明確に高評価になる配置にして「P→b の横撃ち」を固定する。
    const parrier = { ...enemy('P', { x: 10, y: 4 }, 'light', 100, 10), castZField: () => -FIELD.zRef }
    const allies = [ally('a', { x: 0, y: -6 }, 'dark'), ally('b', { x: -10, y: 4 }, 'light', 20)]
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
    // 分身の散らばり（描画）と敵AIの狙いのブレ（perceivedPos）が同じ値を使うので、
    // ここが 0 だと「隠蔽しているのに何も起きない」になる（#73）
    expect(t.concealRmse).toBeGreaterThan(0)
    expect(t.concealRmse).toBeCloseTo(7 / 2, 1) // 1重＝囲む円の半径/2
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

describe('暴発は AoE 内の結界も最大威力で削る（§3.5）', () => {
  // 真上へ直進し (0,~7) で暴発する軌道（AoE 半径5）
  const upMisfire: Trajectory = {
    mode: 'rotate',
    g: () => 0,
    angle: Math.PI / 2,
    origin: { x: 0, y: 0 },
    z: (_x, y) => (y > 7 ? NaN : FIELD.zRef),
  }
  // center を中心とする円リングの持続結界（点ごとに speed つき）。owner=味方（ownerId で持続判定）。
  const ringAround = (center: { x: number; y: number }, r: number, z: number, speed: number, ownerId = 'm'): ActiveOrbit => {
    const ring = []
    const N = 24
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      ring.push({ pos: { x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) }, z, speed })
    }
    return { id: 'ring1', ownerId, owner: 'player', ring, ringSpeed: speed }
  }

  it('AoE 内の味方持続結界は暴発に呑まれて霧散する（次ターンへ持ち越さない）', () => {
    const orbit = ringAround({ x: 0, y: 7 }, 2, FIELD.zRef, 12) // 暴発点(0,~7)の内側
    const res = resolveTurn({
      allies: [ally('m', { x: 0, y: 0 })],
      casts: [cast('m', upMisfire)],
      enemies: [],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
      activeOrbits: [orbit],
    })
    expect(res.orbits.some((o) => o.id === 'ring1')).toBe(false) // 消滅
    expect(res.log.some((l) => l.text.includes('暴発に呑まれて'))).toBe(true)
  })

  it('暴発 AoE 内の結界へのパリィ火花は「最速点」でなく「爆心に最も近い点」に出る（#75）', () => {
    // 減速判定（最大速度基準）は変えず、演出座標だけ最近接点にすることを確認する。
    // 実際の暴発座標を先に取得してから、爆心近くの遅い点／遠くの速い点を仕込む。
    const probe = resolveTurn({
      allies: [ally('m', { x: 0, y: 0 })],
      casts: [cast('m', upMisfire)],
      enemies: [],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    const center = probe.allyShots.find((s) => s.misfirePos)!.misfirePos!
    const near = { x: center.x, y: center.y } // 爆心そのもの・遅い
    const far = { x: center.x + FIELD.aoeRadius - 0.3, y: center.y } // 圏内の縁・速い（vMax はこちら）
    const orbit: ActiveOrbit = {
      id: 'ring1',
      ownerId: 'm',
      owner: 'player',
      ring: [
        { pos: near, z: FIELD.zRef, speed: 1 },
        { pos: far, z: FIELD.zRef, speed: 20 },
        { pos: { x: center.x, y: center.y + 0.5 }, z: FIELD.zRef, speed: 1 },
      ],
      ringSpeed: 20,
    }
    const res = resolveTurn({
      allies: [ally('m', { x: 0, y: 0 })],
      casts: [cast('m', upMisfire)],
      enemies: [],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
      activeOrbits: [orbit],
    })
    expect(res.clashes.length).toBeGreaterThan(0)
    const clash = res.clashes[0]
    expect(clash.pos.x).toBeCloseTo(near.x, 6) // 最速点(far)ではなく最近接点(near)
    expect(clash.pos.y).toBeCloseTo(near.y, 6)
    // 破壊点も同じ最近接点になる（vMax=20 で確実に霧散する速度なので destroyed のはず）
    expect(res.orbitBreaks['ring1']?.pos.x).toBeCloseTo(near.x, 6)
  })

  it('AoE 圏外の結界は無傷で残る', () => {
    const orbit = ringAround({ x: 0, y: 22 }, 2, FIELD.zRef, 12) // 遠方（AoE 圏外）
    const res = resolveTurn({
      allies: [ally('m', { x: 0, y: 0 })],
      casts: [cast('m', upMisfire)],
      enemies: [],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
      activeOrbits: [orbit],
    })
    expect(res.orbits.some((o) => o.id === 'ring1')).toBe(true) // 残る
  })

  it('敵の暴発（崩し手）も AoE 内の味方結界を削る（敵味方無差別・#42）', () => {
    // 崩し手が (0,0) の味方近傍で暴発。その AoE 内に味方の持続結界を置く
    const rupt: Enemy = {
      ...enemy('r', { x: 0, y: 12 }, 'dark', 100, 8),
      role: 'ruptor',
      family: 'arc',
    }
    const orbit = ringAround({ x: 0, y: -1 }, 2, FIELD.zRef, 12, 'a')
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: -1 }, 'light')],
      casts: [],
      enemies: [rupt],
      castingEnemyIds: ['r'],
      obstacles: [],
      mechanics: withFire,
      activeOrbits: [orbit],
    })
    // 崩し手の暴発が解決し、AoE 内の味方結界が霧散している
    expect(res.misfires.some((m) => m.owner === 'enemy')).toBe(true)
    expect(res.orbits.some((o) => o.id === 'ring1')).toBe(false)
  })
})

describe('貫通（命中で減速せず消えない・複数対象へ多段ヒット）', () => {
  it('一直線上の2体の敵に1発で両方命中し、命中で減速しない（同ダメージ）', () => {
    // 原点から +x への直線弾（z=zRef 一定＝加減速なし）。x=5 と x=9 の敵を貫いて両方に当たる。
    // 命中は魔法を減速させないので、手前と奥のダメージは等しい。
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLightMid }, 10)],
      enemies: [enemy('e1', { x: 5, y: 0 }, 'dark'), enemy('e2', { x: 9, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    const shot = res.allyShots[0]
    expect(shot.hits.map((h) => h.targetId)).toEqual(['e1', 'e2']) // 弧長順に2体へ命中
    const d1 = 100 - res.enemies.find((e) => e.id === 'e1')!.hp
    const d2 = 100 - res.enemies.find((e) => e.id === 'e2')!.hp
    expect(d1).toBeGreaterThan(0)
    expect(d2).toBeCloseTo(d1, 6) // 命中しても減速しない＝奥の敵にも同じ威力
  })

  it('敵弾も貫通し、経路上の複数の味方に命中する', () => {
    // 敵(0,10) は最低HPの lo(0,-8) を狙う。直線経路上の hi(0,0) も貫通で被弾する。
    const res = resolveTurn({
      allies: [ally('hi', { x: 0, y: 0 }, 'neutral', 100), ally('lo', { x: 0, y: -8 }, 'neutral', 20)],
      casts: [],
      enemies: [enemy('e', { x: 0, y: 10 }, 'dark', 100, 8)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    const shot = res.enemyShots[0]
    expect(shot.hits.length).toBeGreaterThanOrEqual(2)
    expect(res.allies.find((a) => a.id === 'hi')!.hp).toBeLessThan(100)
    expect(res.allies.find((a) => a.id === 'lo')!.hp).toBeLessThan(20)
  })

  it('速度0で消えた弾はその先の対象に命中しない（貫通は霧散点まで）', () => {
    // z=zPeak（|z|>zRef）の減速場：弾は途中で失速して消え、遠い敵には届かない
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLight }, 6)],
      enemies: [enemy('far', { x: 25, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    const shot = res.allyShots[0]
    expect(shot.flight?.end).toBe('vanished')
    expect(shot.hits.length).toBe(0)
    expect(res.enemies[0].hp).toBe(100)
  })
})

describe('複数回パリィ（同時刻の共存で判定・勝ち残りは次の魔法とまたパリィする）', () => {
  // 敵(0,12)の光弾（速度12・威力30）が y 軸を下り、最低HPの味方 v(0,-10) を狙う。
  // 迎撃の闇弾（z=-zRef・強度2.5）を同軸で撃ち上げてパリィさせる共通セットアップ。
  const up = (o: { x: number; y: number }): Trajectory => ({
    mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: o, z: zDarkMid,
  })
  const eLight = () => ({ ...enemy('e', { x: 0, y: 12 }, 'light', 100, 12), castZField: () => FIELD.zRef })

  it('敵弾は弱い自弾に撃ち勝った後、別の自弾と再びパリィして消える（多段パリィ）', () => {
    // 弱い1本目（(0,2)から速度3・威力7.5）が先にぶつかって撃ち負けて消えるが、敵弾も威力を失い、
    // 後からぶつかる2本目（(0,-5)から速度12・威力30）が残威力の敵弾に撃ち勝って消滅させる。
    const v = ally('v', { x: 0, y: -10 }, 'light', 20)
    const i1 = ally('i1', { x: 0, y: 2 }, 'dark', 100)
    const i2 = ally('i2', { x: 0, y: -5 }, 'dark', 100)
    const res = resolveTurn({
      allies: [v, i1, i2],
      casts: [cast('i1', up(i1.pos), 3), cast('i2', up(i2.pos), 12)],
      enemies: [eLight()],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    // パリィが2回起きる（1回目で敵弾が勝ち、2回目で敵弾が消える）
    expect(res.log.filter((l) => l.kind === 'parry').length).toBe(2)
    expect(res.enemyShots[0].blocked).toBe(true)
    // 1本目の自弾はパリィで消滅、2本目は勝ち残って飛び続ける
    const s1 = res.allyShots.find((s) => s.allyId === 'i1')!
    const s2 = res.allyShots.find((s) => s.allyId === 'i2')!
    expect(s1.flight?.end).toBe('vanished')
    expect(s2.flight?.end).not.toBe('vanished')
    // 狙われた味方は無傷（敵弾は途中で消えた）
    expect(res.allies.find((a) => a.id === 'v')!.hp).toBe(20)
  })

  it('パリィはキャスト順でなくゲーム時刻の早い衝突から解決される', () => {
    // 1本目のキャスト（弱い闇弾・(0,-2)から速度3）より、2本目（(0,-5)から速度12・威力30）の方が
    // 先に敵弾へぶつかる。時系列解決なら同威力どうしの完全相殺が先に起き、敵弾は消滅、
    // 1本目の弱い弾はパリィを経験せずそのまま飛び続ける。
    const v = ally('v', { x: 0, y: -10 }, 'light', 20)
    const i1 = ally('i1', { x: 0, y: -2 }, 'dark', 100)
    const i2 = ally('i2', { x: 0, y: -5 }, 'dark', 100)
    const res = resolveTurn({
      allies: [v, i1, i2],
      casts: [cast('i1', up(i1.pos), 3), cast('i2', up(i2.pos), 12)],
      enemies: [eLight()],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    expect(res.log.filter((l) => l.kind === 'parry').length).toBe(1) // 完全相殺の1回だけ
    expect(res.enemyShots[0].blocked).toBe(true)
    const s1 = res.allyShots.find((s) => s.allyId === 'i1')!
    const s2 = res.allyShots.find((s) => s.allyId === 'i2')!
    expect(s2.flight?.end).toBe('vanished') // 同威力＝両方消滅
    expect(s1.flight?.end).not.toBe('vanished') // 先撃ちでも時刻が遅い衝突は起きない
    expect(res.allies.find((a) => a.id === 'v')!.hp).toBe(20)
  })
})

// ===== #70：ダメージ式は術者の種別に依らない（敵の role/family/species で変わらない） =====
describe('ダメージ計算は術者の種別に依らない（#70）', () => {
  const victim = (): Ally => ally('v', { x: 0, y: -12 }, 'light', 5000)

  /** 敵1体を1ターン撃たせ、命中があれば「その一撃のダメージと命中点の速度・z」を返す。 */
  const fireOnce = (over: Partial<Enemy>) => {
    const e: Enemy = { ...enemy('e0', { x: 0, y: 12 }, 'dark', 300, 8, -FIELD.zRef), ...over }
    const res = resolveTurn({
      allies: [victim()], casts: [], enemies: [e], castingEnemyIds: [e.id],
      obstacles: [], mechanics: withFire,
    })
    const shot = res.enemyShots[0]
    const hit = firstHit(shot.flight.samples, victim().pos, GAME.allyHitbox)
    return { shot, hit, traj: shot.traj }
  }

  it('敵弾のダメージは共有の computeDamage（速度×強度×相性）と一致する＝種別の項が無い', () => {
    // 役割・得意関数・種族を振っても、命中したなら必ず同じ式で解決される
    const variants: Partial<Enemy>[] = [
      { role: 'attacker', family: 'arc' },
      { role: 'breaker', family: 'line' },
      { role: 'attacker', family: 'abs', families: ['abs'], species: 'wraith', level: 6 },
      { role: 'breaker', family: 'exp', families: ['exp'], species: 'oni', level: 3 },
    ]
    let compared = 0
    for (const v of variants) {
      const { shot, hit, traj } = fireOnce(v)
      if (!hit) continue // 曲がって外れた個体は対象外（当たった弾の式だけを比べる）
      const expected = computeDamage(hit.speed, zfieldAt(traj, hit.pos), 'light').damage
      expect(shot.damage, JSON.stringify(v)).toBeCloseTo(expected, 6)
      expect(expected).toBeGreaterThan(0)
      compared++
    }
    // 命中した個体はすべて同じ式で解決された（曲がりの深い個体は外れることがあるので下限で見る）
    expect(compared).toBeGreaterThanOrEqual(3)
  })

  it('同じ速度・同じ z・同じ対象属性なら、味方弾・敵弾・周回掃射のダメージは同一', () => {
    const speed = 9.3
    const z = -FIELD.zRef // 闇
    const target: Ally['element'] = 'light'
    const base = computeDamage(speed, z, target).damage
    // 周回掃射（orbitSweep）も同じ式を通る＝リング速度を入れれば一致する
    const ring = [
      { pos: { x: 0, y: 0 }, z, speed },
      { pos: { x: 1, y: 0 }, z, speed },
      { pos: { x: 1, y: 1 }, z, speed },
    ]
    const hits = orbitSweep(ring, [{ id: 't', pos: { x: 0, y: 0 }, radius: 1, element: target }])
    expect(hits).toHaveLength(1)
    expect(hits[0].damage).toBeCloseTo(base, 9)
  })
})

describe('ダメージ表示の発生時刻（#75：エンジンが t を確定して返す）', () => {
  it('同じ対象への複数命中は、ポップの t が別々で昇順になる', () => {
    // 原点から +x への直線弾（z=zRef 一定＝加減速なし）。x=5 と x=9 の敵を貫いて両方に当たる。
    // 弧長順＝時間順で命中するので、後で当たる e2 の t が e1 より大きくなる。
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: zLightMid }, 10)],
      enemies: [enemy('e1', { x: 5, y: 0 }, 'dark'), enemy('e2', { x: 9, y: 0 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    const shot = res.allyShots[0]
    expect(shot.hits.map((h) => h.targetId)).toEqual(['e1', 'e2']) // 弧長順に2体へ命中
    const ts = res.popups
      .filter((p) => p.trigger === 'flash')
      .map((p) => ({ id: p.targetId, t: p.t }))
    expect(ts).toHaveLength(2)
    const tE1 = ts.find((x) => x.id === 'e1')!.t
    const tE2 = ts.find((x) => x.id === 'e2')!.t
    expect(tE1).not.toBeCloseTo(tE2, 6) // 別々の時刻
    expect(tE1).toBeLessThan(tE2) // 手前の敵に先に当たる＝昇順
  })

  it('t は全ポップで有限な数になる（命中・暴発・回復すべて）', () => {
    // 命中・暴発・回復が一通り混ざるよう、暴発する弾と光の周回回復を同時に起こす
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 }), ally('heal', { x: 0, y: -8 }, 'light')],
      casts: [
        cast('a', { mode: 'rotate', g: (x) => 1 / (5 - x), angle: 0, origin: { x: 0, y: 0 }, z: zLightMid }, 8),
        cast('heal', { mode: 'polar', f: () => 3, origin: { x: 0, y: -8 }, z: zLightMid }, 6),
      ],
      enemies: [enemy('e', { x: 8, y: 0 }, 'dark', 100, 6)],
      castingEnemyIds: ['e'],
      obstacles: [],
      mechanics: withFire,
    })
    expect(res.popups.length).toBeGreaterThan(0)
    for (const p of res.popups) expect(Number.isFinite(p.t)).toBe(true)
  })

  it('結界の掃射（軌道型）は、対象ごとにリングの粒が到達する時刻が別々になる（t=0固定の再発防止）', () => {
    // 半径6の周回（減速しない z=-zRef）が θ=90°・θ=270° の2体を同時に掃射する。
    // リング上の到達順（弧長順）が違うので、命中ポップの t も対象ごとに違うはず。
    const res = resolveTurn({
      allies: [ally('a', { x: 0, y: 0 })],
      casts: [cast('a', { mode: 'polar', f: () => 6, origin: { x: 0, y: 0 }, z: zDarkMid })],
      enemies: [enemy('e90', { x: 0, y: 6 }, 'light', 100, 0), enemy('e270', { x: 0, y: -6 }, 'light', 100, 0)],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: onlyHit,
    })
    const flashes = res.popups.filter((p) => p.trigger === 'flash')
    expect(flashes).toHaveLength(2)
    const t90 = flashes.find((p) => p.targetId === 'e90')!.t
    const t270 = flashes.find((p) => p.targetId === 'e270')!.t
    expect(t90).not.toBeCloseTo(t270, 6) // 別々の時刻
    expect(flashes.some((p) => p.t > 0)).toBe(true) // 全部0に固まっていない
  })
})
