// テストプレイで報告されたバグの回帰テスト：
// 1) パリィの同時性（交点を同時刻に通過するときだけ相殺・すれ違いは干渉しない）
// 2) 破壊不能壁（unbreakable）を横切る攻撃候補は全ロールで棄却
// 3) 迂回型は回り込めるクリーンな経路があれば壁を貫く候補を選ばない
// 4) 火力型はランプ z 場（飛行中は中庸で加速→命中直前に zPeak）で速度と強度を両立する
import { describe, it, expect } from 'vitest'
import { resolveTurn, traverseObstacles } from './turn'
import { planEnemyShot, planRuptorShot, enemyFlight } from './enemyAI'
import { firstHit } from './collision'
import { zfieldAt, strengthOf } from './attribute'
import { constZField } from './zfields'
import { isSolidAt } from './obstacle'
import { simulateFlight } from './physics'
import { parseExpression } from './functions'
import { recommendCast } from './recommend'
import { dist } from './coords'
import { createBattleState, prepareTurn, resolveAllyCasts } from './battle'
import { STAGES } from '../data/stages'
import { makeParty } from '../data/party'
import { FIELD } from '../data/constants'
import type { Ally, Enemy, Obstacle, Rect, Trajectory } from './types'

const ally = (id: string, pos: { x: number; y: number }, hp = 500, element: Ally['element'] = 'light'): Ally => ({
  id, name: id, pos, hp, maxHp: hp, element, statuses: [],
})

const baseEnemy = (over: Partial<Enemy> = {}): Enemy => ({
  id: 'e0', name: '敵', pos: { x: 5, y: 20 }, hp: 300, maxHp: 300, element: 'dark',
  hitboxRadius: 1.8, statuses: [], family: 'line',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 }, castInitialSpeed: 8, castZ: -2.5,
  ...over,
})

/** 矩形1枚の壁（テスト用）。 */
const rectWall = (rect: Rect, kind: Obstacle['kind'] = 'normal'): Obstacle => ({
  id: `ob-${rect.x}-${rect.y}`, element: 'neutral', solids: [], rects: [rect], carves: [], kind,
})

describe('パリィの同時性（バグ修正：交点にあれば位置関係なく相殺されていた）', () => {
  // 敵（5,20）→ 味方 v（5,-20）への縦の弾と、術者の横の弾（y=0・角度0）が (5,0) で交差する。
  // 敵弾は 20 ユニットで交点へ（t≈2.5）。術者の発射位置で自弾の到達時刻を変える。
  const runWith = (casterX: number) => {
    const caster = ally('p', { x: casterX, y: 0 }, 500, 'neutral')
    const victim = ally('v', { x: 5, y: -20 }, 40, 'light') // 低HP＝敵の狙いを固定
    const traj: Trajectory = {
      mode: 'rotate', g: () => 0, angle: 0, origin: caster.pos, z: constZField(FIELD.zRef), // 光・減速なし
    }
    return resolveTurn({
      allies: [caster, victim],
      casts: [{ allyId: 'p', trajectory: traj, initialSpeed: 8 }],
      enemies: [baseEnemy()],
      castingEnemyIds: ['e0'],
      obstacles: [],
      mechanics: { obstacles: false, enemyFire: true },
    })
  }

  it('同時刻に交点を通過する2弾は相殺する（従来どおり）', () => {
    // 自弾も交点まで 20 ユニット（t≈2.5）＝敵弾とほぼ同時
    const res = runWith(-15)
    expect(res.log.some((l) => l.kind === 'parry')).toBe(true)
    expect(res.clashes.length).toBeGreaterThan(0)
  })

  it('先に通過し終えた後に相手が来る「すれ違い」では相殺しない', () => {
    // 敵弾 t≈2.5 に対し自弾は 30 ユニット（t≈3.75）＝時間差×速度 ≈10 ユニットの離れ
    const res = runWith(-25)
    expect(res.log.some((l) => l.kind === 'parry')).toBe(false)
    expect(res.clashes.length).toBe(0)
    // 敵弾は干渉されず対象へ届く
    expect(res.enemyShots[0].blocked).toBe(false)
  })
})

describe('破壊不能壁と迂回型の経路選択（バグ修正）', () => {
  const target = ally('t', { x: 0, y: -15 }, 500, 'light')

  it('unbreakable が全面を塞ぐとき、攻撃候補は棄却され牽制（期待ダメージ0）へ落ちる', () => {
    const wallU = rectWall({ x: -30, y: -1, w: 60, h: 2 }, 'unbreakable')
    for (const role of [undefined, 'breaker'] as const) {
      const e = baseEnemy({ pos: { x: 0, y: 20 }, role, families: ['arc', 'abs'] })
      const plan = planEnemyShot(e, [target], [wallU])
      expect(plan).not.toBeNull()
      // 貫通も迂回も不可能＝命中見込みのある候補が無い（牽制のみ）
      expect(plan!.expectedDamage).toBe(0)
    }
  })

  it('unbreakable の脇に隙間があれば、breaker でも隙間側の（横切らない）経路を選ぶ', () => {
    const wallU = rectWall({ x: -30, y: -1, w: 38, h: 2 }, 'unbreakable') // x≤8 を塞ぐ・右に隙間
    const e = baseEnemy({ pos: { x: 0, y: 20 }, role: 'breaker', families: ['arc', 'abs', 'poly34'] })
    const plan = planEnemyShot(e, [target], [wallU])
    expect(plan).not.toBeNull()
    expect(plan!.expectedDamage).toBeGreaterThan(0)
    const { path } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    expect(path.some((p) => isSolidAt(wallU, p))).toBe(false)
  })

  it('迂回型は回り込めるルートがあれば、削れる壁を貫く候補を選ばない', () => {
    const wallN = rectWall({ x: -12, y: -1, w: 24, h: 2 }, 'normal') // 中央だけ塞ぐ・左右に隙間
    const e = baseEnemy({ pos: { x: 0, y: 20 }, families: ['arc', 'abs', 'poly34'] }) // attacker=迂回型
    const plan = planEnemyShot(e, [target], [wallN])
    expect(plan).not.toBeNull()
    expect(plan!.expectedDamage).toBeGreaterThan(0)
    // 選ばれた経路は素材に一切触れない（＝壁を貫かず回り込む）
    const { path, flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    const hit = firstHit(flight.samples, target.pos, 2.0)
    expect(hit).not.toBeNull()
    const before = path.filter((_, i) => (flight.samples[i]?.arcLen ?? Infinity) < hit!.arcLen)
    expect(before.some((p) => isSolidAt(wallN, p))).toBe(false)
  })
})

describe('正面パリィ（バグ修正：collinear/anti-parallel 経路が相殺されなかった）', () => {
  // 敵（12,0・光）と味方（-12,0・闇）が同一直線上を逆走して正面衝突する。
  // 以前は segmentIntersect の平行分岐で交点が拾えず、両弾がすり抜けていた。
  it('反対極どうしが同一直線上を正面衝突するとパリィが成立する', () => {
    const e1: Enemy = {
      id: 'e1', name: 'e1', pos: { x: 12, y: 0 }, hp: 300, maxHp: 300, element: 'light',
      hitboxRadius: 1.8, statuses: [], family: 'line', role: 'attacker',
      castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
      castZField: constZField(FIELD.zRef), castInitialSpeed: 10, castZ: FIELD.zRef,
    }
    const a1 = ally('a1', { x: -12, y: 0 }, 500, 'dark')
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: 0, origin: { x: -12, y: 0 }, z: constZField(-FIELD.zRef) }
    const res = resolveTurn({
      allies: [a1], casts: [{ allyId: 'a1', trajectory: traj, initialSpeed: 10 }],
      enemies: [e1], castingEnemyIds: ['e1'], obstacles: [], mechanics: { obstacles: false, enemyFire: true },
    })
    expect(res.log.some((l) => l.kind === 'parry')).toBe(true)
    expect(res.clashes.length).toBeGreaterThan(0)
  })
})

describe('第6面：崩し手の暴発が確実に成立する（バグ修正・#63）', () => {
  it('前衛の崩し手は不発にならず、無防備な味方の近傍で確実に暴発する', () => {
    // #63 の再設計：崩し手は封印帯の「前」に立ち、暴発弾は初手から味方の目前へ届く。
    // 無防備（発射なし）で受けると、崩し手の弾は極まで到達して必ず暴発する（不発・通常命中化しない）。
    let state = createBattleState(STAGES[5], 5, makeParty())
    let total = 0
    let ruptorShots = 0
    for (let t = 0; t < 4 && state.outcome === 'ongoing'; t++) {
      const prep = prepareTurn(state)
      if (prep.state.outcome !== 'ongoing') break
      const ruptorIds = new Set(
        prep.state.enemies.filter((e) => e.role === 'ruptor' && e.hp > 0).map((e) => e.id),
      )
      const { state: after, resolution } = resolveAllyCasts(prep.state, [], prep.castingEnemyIds)
      for (const shot of resolution.enemyShots) {
        if (!ruptorIds.has(shot.enemyId)) continue
        ruptorShots++
        expect(shot.misfired).toBe(true) // 暴発予告どおり必ず暴発する（AI予告と実解決の一致）
      }
      total += resolution.misfires.filter((m) => m.owner === 'enemy').length
      state = after
    }
    expect(ruptorShots).toBeGreaterThanOrEqual(2)
    expect(total).toBe(ruptorShots)
  })
})

describe('断末魔はボス単独（バグ修正：33%を跨がず即死させると眷属が生き残っていた）', () => {
  it('ボスをフェーズ閾値を跨がずに0へ落とすと、最終フェーズが適用され眷属が間引かれる', () => {
    const state = createBattleState(STAGES[6], 6, makeParty())
    const prep = prepareTurn(state)
    // バーストでボスだけ即死（フェーズ0のまま＝33%を跨いでいない）
    const bursted = { ...prep.state, enemies: prep.state.enemies.map((e) => (e.boss ? { ...e, hp: 0 } : e)) }
    const { state: after } = resolveAllyCasts(bursted, [], [])
    // 最終フェーズが適用され、眷属は崩落で間引かれる
    expect(after.bossPhase).toBe(2)
    expect(after.enemies.filter((e) => !e.boss).every((m) => m.hp <= 0)).toBe(true)
    // 次ターンの断末魔はボス単独（眷属は撃たない）
    const prep2 = prepareTurn(after)
    const castingMinions = prep2.castingEnemyIds.filter(
      (id) => prep2.state.enemies.find((e) => e.id === id && !e.boss),
    ).length
    expect(prep2.state.finale).toBe('cast')
    expect(castingMinions).toBe(0)
  })
})

describe('DoT（burn）撃破の検出タイミング（バグ修正：撃破演出が載らない経路）', () => {
  // App.tsx の DoT 撃破演出（onAnimationDone で prepareTurn 後に検出）が依拠する不変条件：
  // burn による撃破は resolveAllyCasts ではなく prepareTurn（ターン開始の継続ダメージ）で起きる。
  it('burn は resolveAllyCasts では倒さず、次の prepareTurn で hp>0→hp<=0 になる', () => {
    const base = createBattleState(STAGES[0], 0, makeParty())
    const state = {
      ...base,
      enemies: base.enemies.map((e) => ({
        ...e,
        hp: 3,
        statuses: [{ kind: 'burn' as const, magnitude: 10, remainingTurns: 3 }],
      })),
    }
    const { state: after } = resolveAllyCasts(state, [], [])
    expect(after.enemies[0].hp).toBe(3) // 解決フェーズでは死なない
    const prep = prepareTurn(after)
    expect(after.enemies[0].hp).toBeGreaterThan(0) // 撃破前スナップショットは生存
    expect(prep.state.enemies[0].hp).toBe(0) // prepareTurn の継続ダメージで撃破＝ここで演出へ引き渡す
  })

  // App.tsx の burn 中間演出（バグ修正）が依拠する不変条件：主解決で撃破した敵は after.enemies で
  // hp<=0 になっている。burn 演出前に盤面を after へ更新すれば drawEnemies が主解決の撃破敵を隠すため、
  // 「撃破済みの敵が生き返って見える」不具合が起きない。ここではその前提（after の状態）を固定する。
  it('主解決で撃破した敵と burn 予定の敵が同居するとき、after では主解決の敵だけが hp<=0', () => {
    const base = createBattleState(STAGES[0], 0, makeParty())
    // 敵A：主解決で直接撃破される（低HP・弾を当てる）。敵B：burn 付与済みで次ターン頭に死ぬ想定
    const enemyA: Enemy = baseEnemy({ id: 'A', name: 'A', pos: { x: 0, y: 12 }, hp: 5, maxHp: 100, element: 'dark' })
    const enemyB: Enemy = baseEnemy({
      id: 'B', name: 'B', pos: { x: 12, y: 12 }, hp: 4, maxHp: 100, element: 'dark',
      statuses: [{ kind: 'burn', magnitude: 10, remainingTurns: 3 }],
    })
    // 味方を敵A の真下（近距離）に置いて確実に当てる
    const shooter = ally('shooter', { x: 0, y: 0 }, 500, 'light')
    const state = {
      ...base, mechanics: { obstacles: false, enemyFire: false },
      allies: [shooter], enemies: [enemyA, enemyB],
    }
    const traj: Trajectory = {
      mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: shooter.pos, z: constZField(FIELD.zRef),
    }
    const { state: after } = resolveAllyCasts(state, [{ allyId: shooter.id, trajectory: traj, initialSpeed: 12 }], [])
    const aAfter = after.enemies.find((e) => e.id === 'A')!
    const bAfter = after.enemies.find((e) => e.id === 'B')!
    expect(aAfter.hp).toBeLessThanOrEqual(0) // 主解決で撃破＝after で hp<=0（描画で隠れる）
    expect(bAfter.hp).toBeGreaterThan(0) // burn 予定の敵は after ではまだ生存
    // burn 撃破は次の prepareTurn（ターン開始の継続ダメージ）で起きる
    const prep = prepareTurn(after)
    expect(prep.state.enemies.find((e) => e.id === 'B')!.hp).toBe(0)
  })
})

describe('火力型のランプ z 場（バグ修正：速度を出す z 場を使えていなかった）', () => {
  it('飛行中は中庸で加速し、命中点では zPeak 級の強度で当てる', () => {
    const target = ally('t', { x: 0, y: -15 }, 500, 'light')
    const e = baseEnemy({ pos: { x: 0, y: 20 }, role: 'breaker' })
    const plan = planEnemyShot(e, [target], [])
    expect(plan).not.toBeNull()
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    const hit = firstHit(flight.samples, target.pos, 2.0)
    expect(hit).not.toBeNull()
    // 加速して初速より明確に速く着弾する（一定 zPeak 場では減速して初速を下回る）
    expect(hit!.speed).toBeGreaterThan(12)
    // 命中点の z は zPeak 付近＝最大級の強度
    const zHit = zfieldAt(plan!.trajectory, hit!.pos)
    expect(strengthOf(zHit)).toBeGreaterThan(3.5)
  })
})

describe('敵 guardian の持続結界（owner=enemy・バグ修正：ターンをまたぐと消滅していた）', () => {
  const guardian = (over: Partial<Enemy> = {}): Enemy =>
    baseEnemy({
      id: 'g', name: 'g', pos: { x: 0, y: 12 }, hp: 200, maxHp: 200, element: 'dark',
      family: 'spiral', role: 'guardian', castZ: -4, ...over,
    })

  it('沈黙するターンでも持続し、味方弾を迎撃して guardian を守る', () => {
    const a = ally('a', { x: 0, y: 0 }, 500, 'light')
    // turn1：敵結界を張る
    const t1 = resolveTurn({
      allies: [a], casts: [], enemies: [guardian()], castingEnemyIds: ['g'],
      obstacles: [], mechanics: { obstacles: false, enemyFire: true },
    })
    const enemyOrbit = t1.orbits.find((o) => o.owner === 'enemy')
    expect(enemyOrbit).toBeDefined()
    // turn2：guardian は沈黙（castingEnemyIds=[]）。味方が弱めの光弾を上方へ発射
    // （威力＝速度×強度が結界威力を下回る弾。パリィは威力の引き算＝負けた側が必ず消える）
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: { x: 0, y: 0 }, z: constZField(2.5) }
    const t2 = resolveTurn({
      allies: [a], casts: [{ allyId: 'a', trajectory: traj, initialSpeed: 6 }],
      enemies: [{ ...t1.enemies[0] }], castingEnemyIds: [],
      obstacles: [], mechanics: { obstacles: false, enemyFire: true },
      activeOrbits: t1.orbits,
    })
    // 結界は消滅せず持ち越され、味方弾を迎撃（clash が立つ）して guardian を守る
    expect(t2.orbits.some((o) => o.owner === 'enemy')).toBe(true)
    expect(t2.clashes.length).toBeGreaterThan(0)
    // 威力で負けた弾は消滅し、guardian へは届かない（迎撃なし＝バグ時は命中して hp が減る）
    expect(t2.allyShots[0].flight?.end).toBe('vanished')
    expect(t2.enemies[0].hp).toBe(200)
  })

  it('光の敵結界は沈黙ターンでも内側の guardian を回復させる（#61）', () => {
    const g = guardian({ element: 'light', castZ: 4, hp: 150, maxHp: 200 })
    const a = ally('a', { x: 0, y: 0 }, 500, 'light')
    const t1 = resolveTurn({
      allies: [a], casts: [], enemies: [g], castingEnemyIds: ['g'],
      obstacles: [], mechanics: { obstacles: false, enemyFire: true },
    })
    // turn2：沈黙。持続する光結界が回復オーラを及ぼす
    const t2 = resolveTurn({
      allies: [a], casts: [], enemies: [{ ...t1.enemies[0] }], castingEnemyIds: [],
      obstacles: [], mechanics: { obstacles: false, enemyFire: true },
      activeOrbits: t1.orbits,
    })
    expect(t2.enemies[0].hp).toBeGreaterThan(t1.enemies[0].hp)
    expect(t2.log.some((l) => l.text.includes('回復'))).toBe(true)
  })

  it('guardian が倒れた持続結界は次ターンへ持ち越さない', () => {
    const g = guardian({ hp: 10, maxHp: 200 })
    const a = ally('a', { x: 0, y: 8 }, 500, 'light') // 結界内で強い弾を当てて撃破
    const t1 = resolveTurn({
      allies: [a], casts: [], enemies: [g], castingEnemyIds: ['g'],
      obstacles: [], mechanics: { obstacles: false, enemyFire: true },
    })
    // turn2：guardian を掃射で撃破する強い光弾。結界所有者が死ねば結界も残らない
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: { x: 0, y: 8 }, z: constZField(FIELD.zPeak) }
    const t2 = resolveTurn({
      allies: [a], casts: [{ allyId: 'a', trajectory: traj, initialSpeed: 14 }],
      enemies: [{ ...t1.enemies[0] }], castingEnemyIds: [],
      obstacles: [], mechanics: { obstacles: false, enemyFire: true },
      activeOrbits: t1.orbits,
    })
    if (t2.enemies[0].hp <= 0) {
      expect(t2.orbits.some((o) => o.owner === 'enemy')).toBe(false)
    }
  })
})

describe('部屋の囲いが場境界まで届き、回り込み抜けを塞ぐ（手描き仕様）', () => {
  // 手描き仕様では各面は「円の中に壁で囲った部屋」。矩形の部屋（第2/3/6/7面）は境界ぎわの左右が
  // 囲い壁で完全に塞がれている（縦に貫くクリーンな通路が場境界側に無い）。
  // 第5面は十字の部屋で左右の横回廊が意図的に境界へ開くため対象外（第4面・開けた円も対象外）。
  it.each([
    ['第2面', 1],
    ['第3面', 2],
    ['第6面', 5],
    ['第7面①', 6],
  ])('%s：境界ぎわの左右は囲い壁で塞がれている（縦に抜けられない）', (_name, idx) => {
    const st = STAGES[idx]
    const R = st.rField ?? FIELD.rField
    for (const sign of [1, -1]) {
      const x = sign * (R - 2) // 境界の内側（部屋の外＝囲い壁の中）
      let anyOpen = false
      for (let y = -8; y <= 8; y += 0.5) {
        if (Math.hypot(x, y) > R) continue
        if (!st.obstacles.some((ob) => isSolidAt(ob, { x, y }))) anyOpen = true
      }
      expect(anyOpen).toBe(false)
    }
  })
})

describe('おまかせ照準が障害物のある面でも進捗を出す（recommend・バグ修正）', () => {
  // recommend の返り値をそのまま App.tsx と同じ手順で軌道へ組み直して評価する。
  const evalRecommend = (
    from: { x: number; y: number },
    target: Enemy,
    obstacles: Obstacle[],
    fieldR: number,
  ) => {
    const rec = recommendCast(from, target, obstacles, fieldR)
    const expr = rec.line ? `${rec.line.a}*x` : rec.freeExpr!
    const g = parseExpression(expr, 'x')!
    const traj: Trajectory = { mode: 'rotate', g, angle: rec.angle, origin: from, z: constZField(rec.zConst), fieldR }
    const free = simulateFlight(traj, FIELD.fixedSpeed)
    const obs = obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
    const { flight } = traverseObstacles(traj, FIELD.fixedSpeed, free, obs)
    return firstHit(flight.samples, target.pos, target.hitboxRadius)
  }

  it('第1面（囲いのみ・障害物なし）は直接命中する（従来どおり）', () => {
    const st = STAGES[0]
    const tgt = st.enemies[0]
    // 第1面は部屋の枠で囲うが mechanics.obstacles=false（装飾）＝当たり判定なし。
    // recommend も App と同様に壁を無視する（gated）。味方はステージ定義の実配置を使う。
    const positions = st.allyPositions ?? makeParty().map((a) => a.pos)
    const obs = st.mechanics.obstacles ? st.obstacles : []
    let hits = 0
    for (const p of positions) if (evalRecommend(p, tgt, obs, st.rField ?? FIELD.rField)) hits++
    expect(hits).toBe(positions.length)
  })

  it('壁で塞がれた面でも、直線フォールバックでなく対象へ近づく（削り進める）軌道を返す', () => {
    // 第5面：初手は全員壁の奥で直接命中不可。recommend は素の直線でなく、対象方向へ削る軌道を返すべき。
    const st = STAGES[4]
    const R = st.rField ?? FIELD.rField
    const a = makeParty()[0]
    const tgt = st.enemies.reduce((b, e) => (dist(a.pos, e.pos) < dist(a.pos, b.pos) ? e : b))
    const rec = recommendCast(a.pos, tgt, st.obstacles, R)
    // 素の直線（b=0 の line）ではなく、壁を削り進める曲線（freeExpr）を返す
    expect(rec.freeExpr).toBeDefined()
  })

  it('第3面はおまかせ自動プレイで全滅させず撃破できる（多ターンで壁を突破）', () => {
    // 修正前は 10 ターンで 0 ダメージのまま gameover していた。壁を削り進めて撃破まで到達することを確認する。
    for (const s of [2]) {
      let state = createBattleState(STAGES[s], s, makeParty())
      for (let t = 0; t < 20 && state.outcome === 'ongoing'; t++) {
        const prep = prepareTurn(state)
        if (prep.state.outcome !== 'ongoing') { state = prep.state; break }
        const casts = prep.state.allies
          .filter((al) => al.hp > 0)
          .flatMap((al) => {
            const alive = prep.state.enemies.filter((e) => e.hp > 0)
            if (alive.length === 0) return []
            const tgt = alive.reduce((b, e) => (dist(al.pos, e.pos) < dist(al.pos, b.pos) ? e : b))
            const rec = recommendCast(al.pos, tgt, prep.state.obstacles, prep.state.rField)
            const expr = rec.line ? `${rec.line.a}*x` : rec.freeExpr!
            const g = parseExpression(expr, 'x')!
            const traj: Trajectory = { mode: 'rotate', g, angle: rec.angle, origin: al.pos, z: constZField(rec.zConst), fieldR: prep.state.rField }
            return [{ allyId: al.id, trajectory: traj, initialSpeed: 8 }]
          })
        state = resolveAllyCasts(prep.state, casts, prep.castingEnemyIds).state
      }
      expect(state.enemies.every((e) => e.hp <= 0)).toBe(true)
    }
  })
})

// 5) 崩し手（ruptor）の AoE 到達圏ガード（05b §4）：
//    arc 単独の崩し手（第6面「崩し手・弧」）は、壁の無い盤面でも極（暴発点）を対象から大きく外し、
//    「暴発するのに AoE が届かず無害」になっていた。得意 family で圏外になるなら主力 family 一式
//    （abs/arc/poly34）で再探索し、暴発点を対象の AoE 到達圏（aoeRadius）内へ収める。
describe('崩し手の AoE 到達圏ガード（暴発が必ず対象へ届く・#42/05b §4）', () => {
  const rupt = (family: Enemy['family'], families?: Enemy['families']): Enemy =>
    baseEnemy({
      id: 'r', role: 'ruptor', element: 'light', family, families,
      pos: { x: 0, y: 20 }, castInitialSpeed: 8,
    })

  it('arc 単独の崩し手でも、壁の無い盤面で暴発点を対象の AoE 圏内に置く', () => {
    for (const ty of [0, -5, -10, -15]) {
      const t = ally('t', { x: 0, y: ty }, 40, 'dark')
      const plan = planRuptorShot(rupt('arc'), [t], [])
      expect(plan).not.toBeNull()
      expect(plan!.misfirePos).not.toBeNull()
      // 修正前は d=6.7〜21.7（aoeRadius=5 の外＝無害）。ガードで圏内へ収める
      expect(dist(plan!.misfirePos!, t.pos)).toBeLessThan(FIELD.aoeRadius)
    }
  })

  it('resolveTurn で arc 単独の崩し手の暴発が実際に対象へダメージを与える', () => {
    const t = ally('t', { x: 0, y: 0 }, 40, 'dark')
    const e = rupt('arc')
    const res = resolveTurn({
      allies: [t], casts: [], enemies: [e], castingEnemyIds: [e.id],
      obstacles: [] as Obstacle[], mechanics: { obstacles: true, enemyFire: true },
      activeOrbits: [], misfireRoll: 0.5,
    })
    expect(res.enemyShots[0].misfired).toBe(true)
    // 修正前は misfired=true でも target hp は 40 のまま。今は AoE が届き HP が減る
    expect(res.allies[0].hp).toBeLessThan(40)
  })

  it('abs 単独の崩し手は元から圏内なので挙動を変えない（回帰なし）', () => {
    const t = ally('t', { x: 0, y: 0 }, 40, 'dark')
    const plan = planRuptorShot(rupt('abs'), [t], [])
    expect(plan!.misfirePos).not.toBeNull()
    expect(dist(plan!.misfirePos!, t.pos)).toBeLessThan(FIELD.aoeRadius)
  })
})

// ===== #64：テストプレイ報告の修正（見た目すり抜け／blocked 意味論／掘削／パリィ／結界破壊点） =====

describe('壁の見た目すり抜けの根絶（#64：削りの早期打ち切りバグ）', () => {
  // 修正前：resim 後の flight.end==='vanished'（遠くの自然失速）で削りを打ち切り、
  // 弾が「残りの壁素材の中」を減速なしで通過していた（アニメ上だけ貫通して見える）。
  it('第3面T1：全敵弾の飛行サンプルは、解決後の壁素材の中を速度>0で通らない', () => {
    const stage = STAGES[2]
    const res = resolveTurn({
      allies: makeParty(),
      casts: [],
      enemies: stage.enemies,
      castingEnemyIds: stage.enemies.map((e) => e.id),
      obstacles: stage.obstacles.map((o) => ({ ...o, carves: [...o.carves] })),
      mechanics: stage.mechanics,
      fieldR: stage.rField,
    })
    for (const shot of res.enemyShots) {
      const leak = shot.flight.samples.filter(
        (s) => s.speed > 0 && res.obstacles.some((o) => isSolidAt(o, s.pos)),
      )
      expect(leak).toEqual([])
    }
  })

  it('blocked（壁止まり）の敵弾は、飛行サンプルが停止点より先へ伸びない', () => {
    // 全幅の厚い壁で必ず止まる構図。アニメーションは flight.samples をそのまま描くため、
    // これが「弾は壁で止まって見える」ことの保証になる。
    const wallN = rectWall({ x: -30, y: 0, w: 60, h: 8 }, 'normal')
    const victim = ally('v', { x: 0, y: -15 }, 40, 'light')
    const res = resolveTurn({
      allies: [victim],
      casts: [],
      enemies: [baseEnemy({ pos: { x: 0, y: 20 }, role: 'breaker' })],
      castingEnemyIds: ['e0'],
      obstacles: [wallN],
      mechanics: { obstacles: true, enemyFire: true },
    })
    const shot = res.enemyShots[0]
    expect(shot.blocked).toBe(true)
    const last = shot.flight.samples[shot.flight.samples.length - 1]
    expect(last.speed).toBe(0)
    // 停止点は壁の帯（y -2.4..10.4 付近）より手前＝壁の中。奥（対象側）へ抜けていない
    expect(last.pos.y).toBeGreaterThan(-3)
  })
})

describe('blocked の意味論（#64：自然失速＝壁止まりではない）', () => {
  it('敵弾が味方を通過した後に壁の中で止まっても、停止点までの命中は有効', () => {
    // 仕様決定：壁で止まる弾も「それまで」は当たる（AI 事前評価との乖離解消・spec §9）。
    // 構図：敵(0,20) → 味方(0,5) → 全幅の厚い壁（y -8..0）。弾は味方に命中してから壁で止まる。
    const victim = ally('v', { x: 0, y: 5 }, 100, 'light')
    const wallN = rectWall({ x: -30, y: -8, w: 60, h: 8 }, 'normal')
    const res = resolveTurn({
      allies: [victim],
      casts: [],
      enemies: [baseEnemy({ pos: { x: 0, y: 20 }, role: 'breaker' })],
      castingEnemyIds: ['e0'],
      obstacles: [wallN],
      mechanics: { obstacles: true, enemyFire: true },
    })
    const shot = res.enemyShots[0]
    expect(shot.blocked).toBe(true) // 壁の中で停止している
    expect(shot.hits.map((h) => h.targetId)).toContain('v') // それでも停止点より前の命中は有効
    expect(res.allies[0].hp).toBeLessThan(100)
  })

  it('敵弾が対象の先で自然失速（z 減速）しても、途中の味方への命中は無効化されない', () => {
    // castZField=-3（|z|>zRef＝減速場）：弾は味方を過ぎたあたりで速度0になる（end=vanished）。
    // 修正前は obstacles のある面で end==='vanished' を一律 blocked にしていたため、
    // 実際には当たっている弾が無効化されていた。
    const victim = ally('v', { x: 0, y: -2 }, 100, 'light')
    const farWall = rectWall({ x: 20, y: 20, w: 4, h: 4 }, 'normal') // 経路と無関係な遠い壁
    const e = baseEnemy({
      pos: { x: 0, y: 10 },
      castZField: constZField(-3),
      castZ: -3,
      castInitialSpeed: 14,
    })
    const res = resolveTurn({
      allies: [victim],
      casts: [],
      enemies: [e],
      castingEnemyIds: ['e0'],
      obstacles: [farWall],
      mechanics: { obstacles: true, enemyFire: true },
    })
    const shot = res.enemyShots[0]
    expect(shot.blocked).toBe(false)
    expect(shot.hits.map((h) => h.targetId)).toContain('v')
    expect(res.allies[0].hp).toBeLessThan(100)
  })
})

describe('火力型の掘削（#64：牽制でなく「1番奥まで掘れる」候補で壁を掘り進める）', () => {
  it('厚い壁で全候補が不達でも、数ターンの掘削で道を開けて命中に至る', () => {
    // 反対極（安く削れる）の壁・厚さ5。1ターンでは貫けないが、穴は累積するので
    // 掘削（最深到達）を選び続ければ数ターンで貫通して命中する。
    const wallN: Obstacle = { id: 'w', element: 'light', solids: [], rects: [{ x: -30, y: 0, w: 60, h: 5 }], carves: [] }
    let obstacles: Obstacle[] = [{ ...wallN, carves: [] }]
    let allies = [ally('v', { x: 0, y: -15 }, 500, 'light')]
    const e = baseEnemy({ pos: { x: 0, y: 20 }, role: 'breaker' })
    let hitTurn = -1
    for (let t = 1; t <= 6; t++) {
      const res = resolveTurn({
        allies,
        casts: [],
        enemies: [e],
        castingEnemyIds: ['e0'],
        obstacles,
        mechanics: { obstacles: true, enemyFire: true },
      })
      // 掘削は毎ターン素材を削る（牽制の空撃ちで止まらない）
      expect(res.enemyShots[0].carves.length).toBeGreaterThan(0)
      obstacles = res.obstacles
      allies = res.allies
      if (res.enemyShots[0].hits.length > 0) {
        hitTurn = t
        break
      }
    }
    expect(hitTurn).toBeGreaterThan(0) // 数ターン以内に掘り抜いて命中する
  })
})

describe('パリィの実衝突判定（#64：撃ち返し・横合いの迎撃が成立する）', () => {
  it('予告経路の中点あたりを狙って撃つと、交差時刻が合いパリィが成立する', () => {
    // 敵(10,15)→味方 v(10,-14) の縦弾に対し、離れた味方 p が経路中点(10,0) 付近を狙って撃つ。
    // 旧・幾何交点＋通過時刻ゲートでは僅かな時刻差で弾かれがちだった「狙った迎撃」の成立を固定する。
    const p = ally('p', { x: -10, y: -10 }, 500, 'neutral')
    const victim = ally('v', { x: 10, y: -14 }, 40, 'light')
    const aim = { x: 10, y: 0 }
    const ang = Math.atan2(aim.y - p.pos.y, aim.x - p.pos.x)
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: ang, origin: p.pos, z: constZField(FIELD.zRef) }
    const res = resolveTurn({
      allies: [p, victim],
      casts: [{ allyId: 'p', trajectory: traj, initialSpeed: FIELD.fixedSpeed }],
      enemies: [baseEnemy({ pos: { x: 10, y: 15 } })],
      castingEnemyIds: ['e0'],
      obstacles: [],
      mechanics: { obstacles: false, enemyFire: true },
    })
    expect(res.log.some((l) => l.kind === 'parry')).toBe(true)
    expect(res.enemyShots[0].damage).toBeLessThan(30) // 相殺で削れて素通しより軽い
  })
})

describe('暴発の余波と発射魔法の干渉（#66：効果中に圏内へ入った弾は呑まれる）', () => {
  // 崩し手（0,20・光・遅め）が餌役（0,0）の近傍で暴発する。射手 p は左遠方から
  // +x へ横切る弾を撃ち、その速度で「爆発より先に通過し終える／爆発後に圏内へ入る」を切り替える。
  const run = (bulletSpeed: number) => {
    const bait = ally('bait', { x: 0, y: 0 }, 40, 'dark') // 低HP＝崩し手の狙いを固定
    const p = ally('p', { x: -20, y: 0 }, 500, 'neutral')
    const far = baseEnemy({ id: 'far', name: 'far', pos: { x: 20, y: 0 }, element: 'dark', hp: 300 })
    const ruptor = baseEnemy({
      id: 'r', name: 'r', pos: { x: 0, y: 20 }, element: 'light', role: 'ruptor',
      castInitialSpeed: 5, // 遅い＝爆発時刻が遅い（速い弾はその前に通過し切れる）
    })
    // 光の横弾（崩し手の光弾と同極＝パリィは透過。干渉するなら余波だけ）
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: 0, origin: p.pos, z: constZField(FIELD.zRef) }
    return resolveTurn({
      allies: [bait, p],
      casts: [{ allyId: 'p', trajectory: traj, initialSpeed: bulletSpeed }],
      enemies: [ruptor, far],
      castingEnemyIds: ['r'],
      obstacles: [],
      mechanics: { obstacles: false, enemyFire: true },
      misfireRoll: 0.5,
    })
  }

  it('爆発後に圏内へ入った弾は余波に呑まれ、奥の敵へ届かない', () => {
    const res = run(4) // 遅い弾＝爆発の瞬間（極手前の減速で遅め）にまだ AoE 圏内に居る
    expect(res.enemyShots.find((s) => s.enemyId === 'r')!.misfired).toBe(true) // 暴発は成立
    expect(res.log.some((l) => l.text.includes('余波'))).toBe(true)
    const shot = res.allyShots.find((s) => s.allyId === 'p')!
    expect(shot.flight!.end).toBe('vanished') // 呑まれて消える
    expect(res.enemies.find((e) => e.id === 'far')!.hp).toBe(300) // 奥の敵は無傷
  })

  it('爆発より先に通過し終えた弾は影響を受けず、奥の敵へ届く', () => {
    const res = run(16) // 速い弾＝爆発前に AoE 圏を通過し切る
    expect(res.enemyShots.find((s) => s.enemyId === 'r')!.misfired).toBe(true)
    expect(res.log.some((l) => l.text.includes('余波'))).toBe(false)
    expect(res.enemies.find((e) => e.id === 'far')!.hp).toBeLessThan(300) // 命中している
  })
})

describe('結界破壊点の記録（#64：霧散演出を弾の到達と同期する）', () => {
  it('敵 guardian の新規結界が味方弾に破られると breakPos が立つ', () => {
    const g = baseEnemy({
      id: 'g', name: 'g', pos: { x: 0, y: 12 }, hp: 200, maxHp: 200, element: 'dark',
      family: 'spiral', role: 'guardian', castZ: -2.5, castInitialSpeed: 3, // 遅い結界＝一撃で破れる
    })
    const a = ally('a', { x: 0, y: -8 }, 500, 'light')
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: a.pos, z: constZField(FIELD.zRef) }
    const res = resolveTurn({
      allies: [a],
      casts: [{ allyId: 'a', trajectory: traj, initialSpeed: 14 }],
      enemies: [g],
      castingEnemyIds: ['g'],
      obstacles: [],
      mechanics: { obstacles: false, enemyFire: true },
    })
    const ring = res.enemyRings[0]
    expect(ring.broken).toBe(true)
    expect(ring.breakPos).not.toBeNull()
    // 破壊点はリング境界付近（弾の横断点）＝そこへ弾が到達した瞬間に霧散が始められる
    expect(Math.abs(dist(ring.breakPos!, g.pos) - 7)).toBeLessThan(2.5)
  })

  it('持続結界（前ターンの敵結界）が破られると orbitBreaks に破壊点が載る', () => {
    const g = baseEnemy({
      id: 'g', name: 'g', pos: { x: 0, y: 12 }, hp: 200, maxHp: 200, element: 'dark',
      family: 'spiral', role: 'guardian', castZ: -2.5, castInitialSpeed: 3,
    })
    const a = ally('a', { x: 0, y: -8 }, 500, 'light')
    const t1 = resolveTurn({
      allies: [a], casts: [], enemies: [g], castingEnemyIds: ['g'],
      obstacles: [], mechanics: { obstacles: false, enemyFire: true },
    })
    const orbit = t1.orbits.find((o) => o.owner === 'enemy')
    expect(orbit).toBeDefined()
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: a.pos, z: constZField(FIELD.zRef) }
    const t2 = resolveTurn({
      allies: [a],
      casts: [{ allyId: 'a', trajectory: traj, initialSpeed: 14 }],
      enemies: [{ ...t1.enemies[0] }],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: { obstacles: false, enemyFire: true },
      activeOrbits: t1.orbits,
    })
    if (!t2.orbits.some((o) => o.owner === 'enemy')) {
      expect(t2.orbitBreaks[orbit!.id]).toBeDefined() // 破壊されたなら破壊点が必ず載る
    }
  })
})

describe('火力型の掘削は「掘れば道が開く」壁だけを狙う（不可解な壁撃ちの修正）', () => {
  it('直進路の奥が unbreakable で塞がる地形では、掘れば開く側の壁を掘って数ターンで命中する', () => {
    // 中央の直進路は tough 壁の奥に unbreakable（掘っても絶対に開通しない死路）。
    // 弧で横へ膨らめば tough 壁だけで抜けられる。従来は「停止点が狙いに近い」だけで
    // 中央の死路を毎ターン掘り続け、永遠に命中しなかった（不可解な壁撃ち）。
    const tough = rectWall({ x: -14, y: 8, w: 28, h: 3 }, 'tough')
    const unbreak = rectWall({ x: -5, y: 2, w: 10, h: 2 }, 'unbreakable')
    const e = baseEnemy({ pos: { x: 0, y: 20 }, role: 'breaker', families: ['arc', 'poly34', 'abs'] })
    let obstacles: Obstacle[] = [tough, unbreak]
    let allies = [ally('v', { x: 0, y: -15 }, 5000, 'light')]
    let hitTurn = -1
    for (let t = 1; t <= 8; t++) {
      const res = resolveTurn({
        allies, casts: [], enemies: [e], castingEnemyIds: ['e0'],
        obstacles, mechanics: { obstacles: true, enemyFire: true },
      })
      obstacles = res.obstacles
      allies = res.allies
      // unbreakable は削れない＝死路側を掘ってもここには穴が開かない（掘るだけ無駄）
      expect(res.obstacles.find((o) => o.id === unbreak.id)!.carves.length).toBe(0)
      if (res.enemyShots[0].hits.length > 0) {
        hitTurn = t
        break
      }
    }
    expect(hitTurn).toBeGreaterThan(0) // 開通する側の壁を掘り進め、数ターンで命中へ至る
  })

  it('z 減速で壁が無くても届かない相手を、壁を掘って狙い続けない', () => {
    // castZField=-3 の弾は自由飛行でも十数ユニットで失速し、32ユニット先の対象へは
    // 物理的に届かない（掘削で消せるのは壁の速度損だけ）。従来は掘削候補に選ばれ続け、
    // 毎ターン角度を変えては壁を掘った（不可解な壁撃ち）。修正後は牽制（直線）に落ち、
    // 牽制線上の穴が開いた後は壁を削らなくなる。
    const wall = rectWall({ x: -6, y: 10, w: 12, h: 2 }, 'fragile')
    const e = baseEnemy({
      pos: { x: 0, y: 20 }, role: 'breaker', castZField: constZField(-3), castZ: -3,
    })
    let obstacles: Obstacle[] = [wall]
    const allies = [ally('v', { x: 0, y: -12 }, 500, 'light')]
    const carvesPerTurn: number[] = []
    for (let t = 1; t <= 6; t++) {
      const res = resolveTurn({
        allies, casts: [], enemies: [e], castingEnemyIds: ['e0'],
        obstacles, mechanics: { obstacles: true, enemyFire: true },
      })
      obstacles = res.obstacles
      carvesPerTurn.push(res.enemyShots[0]?.carves.length ?? 0)
    }
    // 終盤ターンは壁を削らない（従来は毎ターン別の角度で掘り続けて全ターン carve が出た）
    expect(carvesPerTurn.slice(3)).toEqual([0, 0, 0])
  })
})

describe('高難度の火力型は掘削用の弱い一定場を両極で使う（掘削がおまかせに劣らない）', () => {
  // 闇の厚壁（h=6）×光の味方狙い：素の z 候補（対象の反対極＝闇）は壁と同極で削りが高くつく。
  // 高難度（LVL≥COMBAT.breakerDrillMinLevel）は壁の反対極（光）の弱場（|z|=breakerDrillZ）も試し、
  // 速度損 ×0.5 で3倍安く掘り抜ける（おまかせの zWeak は対象の反対極しか試さない＝この差で上回る）。
  const digTurns = (level: number): number => {
    let allies = [ally('v', { x: 0, y: -15 }, 5000, 'light')]
    const e = baseEnemy({ pos: { x: 0, y: 20 }, role: 'breaker', families: ['arc', 'abs', 'poly34'], level })
    let obstacles: Obstacle[] = [
      { id: 'wall', element: 'dark', solids: [], rects: [{ x: -30, y: 0, w: 60, h: 6 }], carves: [], kind: 'normal' },
    ]
    for (let t = 1; t <= 10; t++) {
      const res = resolveTurn({
        allies, casts: [], enemies: [e], castingEnemyIds: ['e0'],
        obstacles, mechanics: { obstacles: true, enemyFire: true },
      })
      obstacles = res.obstacles
      allies = res.allies
      if (res.enemyShots[0].hits.length > 0) return t
    }
    return -1
  }

  it('LVL6：同極で削りにくい闇の厚壁を、壁の反対極の弱場で安く掘り抜き2ターン以内に命中する', () => {
    const t = digTurns(6)
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThanOrEqual(2)
  })

  it('LVL3（低難度）には解禁されず、同じ壁の突破に高難度より時間がかかる（従来挙動）', () => {
    const t = digTurns(3)
    expect(t === -1 || t > 2).toBe(true)
  })
})
