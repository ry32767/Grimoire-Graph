// 敵AI（#2・#17・修正仕様書）：敵ごとの「得意関数（系統）」で攻撃を最適化する。純粋関数。
// 計画は3層（幾何経路探索 → family フィット → 本番物理検証・enemyPlanning/）に分かれ、
// このファイルは各ロールへの振り分け（facade）と迂回型（attacker/breaker）・守護型の計画を持つ。
// 採点は辞書式 rank（§11.3）：クリーン命中がある限り、壁を削る候補は決して選ばれない。
import type { Ally, Enemy, EnemyFamily, EnemyRole, Obstacle, Trajectory, Vec2, ZField } from './types'
import { dist } from './coords'
import { firstHit } from './collision'
import { isSolidAt } from './obstacle'
import { densifyGeom, OBSTACLE_STEP } from './carve'
import { attributeOf, strengthOf, affinityMultiplier, zfieldAt } from './attribute'
import { ringEncloses, ringAverageAttr, ringCentroid, ringInterception, type RingPoint } from './orbit'
import { constZField } from './zfields'
import { COMBAT, ENEMY_ROUTE_PLANNING, FIELD, GAME } from '../data/constants'
import {
  AVOIDER_FAMILIES,
  ELITE_FIT_FAMILIES,
  ABS_H_RATIO,
  aimAt,
  buildEnemyTrajectory,
  familyTrajectories,
  shapeCandidates,
  enemyFlight,
} from './enemyPlanning/trajectories'
import { perceivedPos, enemyFamilies, avoiderFamiliesOf } from './enemyPlanning/perception'
import { planGuardianBarrier } from './enemyPlanning/guardianPlanner'
import { buildPlanningEnv, type PlanningEnv } from './enemyPlanning/planningEnv'
import { findRoute, type Route } from './enemyPlanning/routeSearch'
import { fitRouteToFamilies } from './enemyPlanning/routeFit'
import { fitComplexityFor } from './enemyPlanning/fitComplexity'
import { evaluateEnemyShot, compareRank } from './enemyPlanning/evaluate'
import { planRuptorShot, buildRuptorZField } from './enemyPlanning/ruptorPlanner'
import { foreseeInterception, type PredictedShot } from './enemyPlanning/foresight'

// 既存の公開 API（テスト・turn.ts が参照）は enemyPlanning/ へ移した実装を再輸出して維持する
export { AVOIDER_FAMILIES, enemyFlight, planRuptorShot, buildRuptorZField }

/**
 * 敵AIに渡す追加情報（#75）。位置引数が既に多いので、以降の拡張はこのオブジェクトへ足す。
 * predicted＝「一つ前のターンに味方が撃った魔法を、今ターンも撃ってくる」と読んだ飛来弾。
 * 省略時は従来どおり（読み無し）の計画になる。
 */
export interface EnemyPlanOptions {
  predicted?: PredictedShot[]
}

/** 敵チームの味方（守護型が囲む対象・05b §5.4）。Enemy をそのまま渡せる最小形。 */
export interface TeamMate {
  id: string
  pos: Vec2
  hp: number
}

/** 敵AIの選択結果 */
export interface EnemyPlan {
  trajectory: Trajectory
  targetId: string
  /** 見込みダメージ（0=命中見込みなし＝牽制） */
  expectedDamage: number
  /**
   * 崩し手（ruptor・#42）が計画した暴発点（z 場の極に弾が達する位置）。
   * 予告マーカー（赤✕＋揺れる円）と解決時の AoE 中心に使う。他ロールは null。
   */
  misfirePos?: Vec2 | null
}

/**
 * 攻撃属性の強さ候補（#31）：最強 zPeak は近距離で大威力だが |z|>zRef なので減速して失速する。
 * 減速しない zRef は中遠距離でも確実に届く。AI は両方を試し「実際に届く威力」が最大の方を選ぶ。
 */
const ATTACK_Z_MAGS = [FIELD.zPeak, FIELD.zRef]

/**
 * 攻撃用の z 場候補を返す（#28/#31：敵は属性に関係なく光・闇を自由に使う）。
 * 署名の castZField があればそれ1つ、無ければ対象の反対極を ATTACK_Z_MAGS の各強さで突く一定場。
 */
function attackZCandidates(
  enemy: Enemy,
  targetElement: Enemy['element'],
): { z: ZField; zVal: number }[] {
  if (enemy.castZField) return [{ z: enemy.castZField, zVal: enemy.castZ }]
  const sign = targetElement === 'light' ? -1 : 1 // 反対極を突く
  return ATTACK_Z_MAGS.map((m) => ({ z: constZField(sign * m), zVal: sign * m }))
}

/** family の見た目情報（スプライトの記号・名称）。 */
export const ARCHETYPES: Record<EnemyFamily, { label: string; glyph: EnemyFamily }> = {
  line: { label: '直進', glyph: 'line' },
  arc: { label: '弧', glyph: 'arc' },
  wave: { label: '波', glyph: 'wave' },
  spiral: { label: '渦', glyph: 'spiral' },
  exp: { label: '昇り', glyph: 'exp' },
  poly34: { label: '捻れ', glyph: 'poly34' },
  abs: { label: '折れ', glyph: 'abs' },
  harmonic: { label: '重波', glyph: 'harmonic' },
}

/**
 * ボスの断末魔の変異体（#45・06b §6 第7面）：HP0 直後の「最後の一手」＝暴発型3連・固定。
 * 物理・干渉ルールは通常の崩し手と完全に同一（特例なし）。
 */
export function finaleVariant(e: Enemy): Enemy {
  return { ...e, role: 'ruptor', castCount: 3, patternPool: undefined, ruptorTarget: 'allies' }
}

/**
 * 多重詠唱（#44・05b §5.5）：castCount 本の弾を「独立に」計画して同時発射する。
 * 1つの弾に複数のAIロジックは混ぜない。弾ごとに patternPool からパターン（role）を順繰りに選び、
 * 既存の単一パターン計画関数を1回ずつ呼ぶだけ。狙いは基本「まだ狙っていない味方」へ1発ずつ
 * 分散し、全員に行き渡ったら通常の優先度（低HP者へ集中）に戻る。
 */
export function planEnemyShots(
  enemy: Enemy,
  allies: Ally[],
  obstacles: Obstacle[] = [],
  standingRings: RingPoint[][] = [],
  teammates: TeamMate[] = [],
  fieldR?: number,
  instability = 0,
  ownRings: RingPoint[][] = [],
  opts: EnemyPlanOptions = {},
): EnemyPlan[] {
  const count = Math.max(1, enemy.castCount ?? 1)
  if (count === 1) {
    const p = planEnemyShot(enemy, allies, obstacles, standingRings, teammates, fieldR, instability, ownRings, opts)
    return p ? [p] : []
  }
  const pool: EnemyRole[] =
    enemy.patternPool && enemy.patternPool.length > 0 ? enemy.patternPool : [enemy.role ?? 'attacker']
  const alive = allies.filter((a) => a.hp > 0)
  const taken = new Set<string>()
  const plans: EnemyPlan[] = []
  for (let i = 0; i < count; i++) {
    const role = pool[i % pool.length]
    // パターン別 family/z（06b §6 第7面・B.7）：family 制約は role 分岐（planEnemyShot 内）に委ねる。
    // z 場は breaker（火力型）弾＝一定（castZ）、それ以外（迂回/暴発）弾＝castZField があればそれ。
    // 専用の合成ロジックは作らず、変異体の castZField を落とすだけで一定場に切り替える。
    const variant: Enemy = {
      ...enemy,
      role,
      castCount: 1,
      castZField: role === 'breaker' ? undefined : enemy.castZField,
    }
    const remaining = alive.filter((a) => !taken.has(a.id))
    const pickFrom = remaining.length > 0 ? remaining : alive
    const plan = planEnemyShot(variant, pickFrom, obstacles, standingRings, teammates, fieldR, instability, ownRings, opts)
    if (!plan) continue
    if (plan.targetId) taken.add(plan.targetId)
    plans.push(plan)
  }
  return plans
}

/** 迂回（壁よけ・経路フィット）の取り回しコスト：遠回りなので直進よりわずかに不利（#28）。 */
const MANEUVER = 0.9

/**
 * クリーン経路を「広い車線優先」で集める（#69）。
 * 弾は硬い壁に一度触れただけで失速して消えるため、隙間のギリギリを縫う経路は
 * family フィットの誤差でほぼ確実に潰れる。まず余白 wideClearance で探し、
 * 見つからなければ通常の余白でも探して、両方をフィット候補にする。
 */
function cleanRoutes(env: PlanningEnv, wide: PlanningEnv, from: Vec2, to: Vec2): Route[] {
  const out: Route[] = []
  const w = findRoute(wide, from, to, 'clean')
  if (w) out.push(w)
  const n = findRoute(env, from, to, 'clean')
  if (n && (!w || Math.abs(n.length - w.length) > 0.5)) out.push(n)
  return out
}

/**
 * 敵の攻撃を計画する（迂回型 attacker／火力型 breaker）。候補は本番物理（削り・結界減速込み）で
 * 評価し、辞書式 rank で選ぶ（§11.3）：
 *   [ clean優先(迂回型のみ), 壁内折れ点, 反対極結界の横断数, −期待ダメージ, 命中弧長 ]
 * unbreakable を横切る候補・壁内部で曲がる迂回候補は棄却。クリーン経路が無いときだけ、
 * 経路探索（wallTunnel）の直線掘削か、壁を削る family 候補を採用する。
 * どの候補も命中見込みがなければ、結界削り→牽制へフォールバックする（§14.1）。
 */
export function planEnemyShot(
  enemy: Enemy,
  allies: Ally[],
  obstacles: Obstacle[] = [],
  standingRings: RingPoint[][] = [],
  teammates: TeamMate[] = [],
  fieldR?: number,
  instability = 0,
  ownRings: RingPoint[][] = [],
  opts: EnemyPlanOptions = {},
): EnemyPlan | null {
  const alive = allies.filter((a) => a.hp > 0)
  if (alive.length === 0) return null
  // 読み（#75）：前ターンと同じ魔法が飛んでくると仮定した予測弾。LVL に依らず全個体が使う
  const predicted = opts.predicted ?? []

  // 防御ロール：自陣（自分＋近くの味方）を覆う周回結界を張る（#28/#71・05b §5.4）。
  // 素材に触れない外形が組めなければ null＝このターンは張らない（触れる結界は即霧散して無駄）
  // ※守護型は「経路」でなく外形を組む役なので、読み（#75）は使わない
  if (enemy.role === 'guardian') {
    return planGuardianBarrier(enemy, { allies, obstacles, teammates, ownRings, fieldR })
  }

  // 崩し手（#42）：狙った対象の近傍で暴発させる専用計画（enemyPlanning/ruptorPlanner）。
  // teammates（敵チーム）を渡し、自爆・味方巻き込みになる極を避けさせる（§12.7）
  if (enemy.role === 'ruptor') {
    return planRuptorShot(enemy, allies, obstacles, undefined, standingRings, fieldR, instability, teammates, predicted)
  }

  // 闇の周回で完全に隠れた味方は視認不可＝狙えない（#35）。全員隠れていれば見えないなりに撃つ。
  const visible = alive.filter((a) => (a.concealed ?? 0) < COMBAT.orbitConcealFull)
  const candidates = visible.length > 0 ? visible : alive

  // 火力型（breaker）は障害物を壊して進む＝family 制約なし・clean 優先もしない。
  // 迂回型（attacker）は abs/arc/poly34 のみに絞る（#46・05b §2）。
  const breaker = enemy.role === 'breaker'
  const families = breaker ? enemyFamilies(enemy) : avoiderFamiliesOf(enemy)
  // 経路フィットに使える family（線・波の個体でも、迂回が要る局面では主力一式で回り込む）。
  // harmonic を持つ個体（#69・終盤の強敵）はフーリエ正弦級数フィットも候補に入る。
  const fitFams = families.filter((f) => ELITE_FIT_FAMILIES.includes(f))
  const routeFams: readonly EnemyFamily[] = fitFams.length > 0 ? fitFams : AVOIDER_FAMILIES
  // 敵の LVL で「最適化できる式の複雑さ」が決まる（#70・05b §2.1）：
  // 弱い敵は1次・2次の素直な曲線まで、強い敵ほど高次・多重の折れ・積の式まで合わせられる
  const fitCx = fitComplexityFor(enemy.level)
  const env = obstacles.length > 0 ? buildPlanningEnv(obstacles, fieldR) : null
  // 広い車線を優先する探索用の環境（#69）。素材から wideClearance だけ離れた経路を探す
  const wideEnv =
    obstacles.length > 0 ? buildPlanningEnv(obstacles, fieldR, ENEMY_ROUTE_PLANNING.wideClearance) : null

  // 採点結果（プロパティ経由＝クロージャ代入でも型の絞り込みが崩れない）
  // blocked＝読み（#75）で「狙いに届く前に撃ち落とされる」と判定された候補
  const sel = { best: null as { plan: EnemyPlan; rank: readonly number[]; blocked: boolean } | null }
  // 掘削候補（#64・#69・#70）：どの候補も命中しない＝壁が厚いとき、牽制でお茶を濁さず
  // **障害物に当ててでも相手へ向かう**一手を布石に選ぶ（#70 で火力型から全ロールへ拡張）。
  // 何を「良い掘削」とするか（#69：明らかに非効率な削り方の根絶／#70：相手へ最短で届く経路）：
  //   ① この一撃のあと、狙いまでの経路に**残る素材の長さ**が最小（＝あと少しで貫通する）
  //   ② 同点なら、この一撃で**削り取った素材の長さ**が最大（＝仕事量が多い）
  //   ③ さらに同点なら、狙いの近くまで到達している
  //   ④ それでも同点なら、経路そのものが短い（＝遠回りせず最短で相手へ届く・#70）
  // 壁を浅い角度で舐める軌道は「素材の中を長々と進むのに、ほとんど貫通に近づかない」ため
  // ① で必ず負ける。壁へ正面から入る軌道（＝最短の厚みを抜く）が自然に選ばれる。
  const drill = { best: null as { plan: EnemyPlan; rank: readonly number[] } | null }
  const trackDrill = (traj: Trajectory, ally: Ally, aimPos: Vec2, ev: ReturnType<typeof evaluateEnemyShot>): void => {
    const last = ev.flight.samples[ev.flight.samples.length - 1]
    if (!last) return
    if (ev.materialArcs.length === 0) return // 素材を削らず失速/逸れた候補は掘削でない
    // 「掘れば道が開く」見込みのない候補は掘削にしない（不可解な壁撃ちの根絶）：
    // (1) 実際に素材が減っていない一撃（＝硬すぎて弾かれただけ）は掘削の進捗にならない
    const removed = ev.materialLenBefore - ev.materialLenAfter
    if (removed <= 1e-6) return
    // 既にある最良候補より①②③で明確に劣るなら、この先の検証（自由飛行の再シミュレート）は不要。
    // compareRank は短い方の長さで比較するので、3キーのまま4キーの best と突き合わせられる。
    const base = [ev.materialLenAfter, -removed, dist(last.pos, aimPos)] as const
    if (drill.best && compareRank(base, drill.best.rank) > 0) return
    // (2) 壁が無くても z 減速で狙いへ届かない弾は、掘って壁の速度損を消しても永遠に届かない。
    //     障害物なしの自由飛行が狙いのヒットボックスへ届くことを掘削の前提条件にする。
    const free = enemyFlight(traj, enemy.castInitialSpeed).flight
    const freeHit = firstHit(free.samples, aimPos, GAME.allyHitbox)
    if (!freeHit || freeHit.speed <= 0) return
    // (3) 狙いへ達する前に unbreakable（削れない壁）を横切る経路は、掘り進めても必ずそこで
    //     止まる＝トンネルは開通しない（手前で止まっている今も、掘り切った後も同じ）。
    if (ev.unbreakableArc !== null && ev.unbreakableArc < freeHit.arcLen) return
    const rank = [...base, freeHit.arcLen] as const
    if (!drill.best || compareRank(rank, drill.best.rank) < 0) {
      drill.best = { plan: { trajectory: traj, targetId: ally.id, expectedDamage: 0 }, rank }
    }
  }
  /** 候補を本番物理で評価し rank で採点する。命中しなければ false（＝攻撃候補にならない）。 */
  const consider = (traj: Trajectory, ally: Ally, aimPos: Vec2, zVal: number, maneuver: number, turnXs?: number[]): boolean => {
    const ev = evaluateEnemyShot(traj, enemy.castInitialSpeed, obstacles, standingRings, { turnXs, aimPos })
    const hit = firstHit(ev.flight.samples, aimPos, GAME.allyHitbox)
    if (!hit || hit.speed <= 0) {
      // 不達でも掘削の布石として記録（#64／#70：迂回型も牽制でなく壁を掘って相手へ向かう）
      trackDrill(traj, ally, aimPos, ev)
      return false // 失速・不達の候補は捨てる（#31）
    }
    // 破壊不能壁（unbreakable）は削れず必ず弾を止める＝命中前に横切る候補は全ロールで棄却
    if (ev.unbreakableArc !== null && ev.unbreakableArc < hit.arcLen) return false
    const matBefore = ev.materialArcs.filter((a) => a < hit.arcLen).length
    const turnsBefore = ev.turnInMaterialArcs.filter((a) => a < hit.arcLen).length
    // 壁内部で曲がる候補（§9.3：壁の中は入口→出口の直線が理想）は**棄却せず降格**する（#70）。
    // 命中を最優先するため：rank の第0要素（clean 優先）・第1要素（壁内の折れ点数）で
    // 必ず下位に沈むので、クリーン命中も「壁の中で曲がらない貫通命中」も無いときにだけ選ばれる。
    const ringsBefore = ev.oppositeRingArcs.filter((a) => a < hit.arcLen).length
    // 属性・強度の評価：迂回型は命中点の z 場（削り・結界減速込みの実速度 × 実強度＝本番と同じ
    // ダメージ）。火力型はランプ z の到達点＝代表 zVal（06b B.7「直進の火力弾」の設計を保つ：
    // 命中点 z で採点すると「横から回り込んで zPeak ちょうどで当てる」曲線を選んでしまう）
    const hz = breaker ? zVal : zfieldAt(traj, hit.pos)
    // 読み（#75）：前ターンと同じ味方弾が飛んでくると仮定し、命中より手前で相殺される分だけ
    // 期待ダメージを割り引く（威力＝速度×強度なので、残速度の比がそのまま倍率になる）。
    // 完全に撃ち落とされる候補は survive=0＝期待ダメージ0 になり、通る経路に必ず負ける。
    const icp =
      predicted.length > 0 ? foreseeInterception(ev.flight.samples, (p) => zfieldAt(traj, p), predicted) : null
    const survive = icp && icp.arcLen <= hit.arcLen ? icp.speedRatio : 1
    const baseDmg =
      hit.speed * strengthOf(hz) * affinityMultiplier(attributeOf(hz), ally.element) * maneuver * survive
    // とどめを刺せる相手を最優先、次に手負い（割合）・絶対低HPを優先
    const killBonus = baseDmg >= ally.hp ? 2.2 : 1
    const woundFocus = 1 + (1 - ally.hp / ally.maxHp) * 0.5
    const lowHpBias = 1 + Math.max(0, (60 - ally.hp) / 60) * 0.25
    const score = baseDmg * killBonus * woundFocus * lowHpBias
    const rank = [
      breaker ? 0 : matBefore > 0 ? 2 : 0, // clean=0 / wallTunnel=2（§11.3：clean があれば削らない）
      turnsBefore,
      ringsBefore,
      -score,
      hit.arcLen,
    ] as const
    if (!sel.best || compareRank(rank, sel.best.rank) < 0) {
      sel.best = { plan: { trajectory: traj, targetId: ally.id, expectedDamage: score }, rank, blocked: survive <= 0 }
    }
    // 撃ち落とされる直進は「クリーン命中」と認めない＝この後の迂回経路探索へ進ませる（#75）
    return rank[0] === 0 && survive > 0
  }

  // 味方ごとの狙い（見かけ位置・z 候補）を組み、family 候補→（必要なら）クリーン経路候補を評価
  const aims: { ally: Ally; aimPos: Vec2; zCands: { z: ZField; zVal: number }[] }[] = []
  for (const ally of candidates) {
    // 隠れている味方は見かけの位置（ずれた位置）で狙う＝命中評価もそこに対して行う（#35）
    let aimPos = perceivedPos(ally)
    // 攻撃の z 場は対象の弱点（反対極）を、強さ違い（zPeak/zRef）で試す（#28/#31：届く威力を最大化）
    let zCands = attackZCandidates(enemy, ally.element)
    // 迂回型の高難度個体（05b §5.2/#47）：狙う相手が結界に守られていれば、
    // 結界の平均属性と同極の z に合わせてすり抜ける（同極は透過＝04-magic §4.6）。
    if (enemy.slipThrough && standingRings.length > 0) {
      const enclosing = standingRings.find((ring) => ring.length >= 3 && ringEncloses(ring, aimPos))
      if (enclosing) {
        const ringAttr = ringAverageAttr(enclosing)
        if (ringAttr !== 'neutral') {
          const sign = ringAttr === 'light' ? 1 : -1
          zCands = ATTACK_Z_MAGS.map((m) => ({ z: constZField(sign * m), zVal: sign * m }))
          // 対象が隠蔽されている（#47）：ジッターのかかった見かけ位置は不確か。
          // 位置が確実な「結界そのもの（リング中心）」を同極 z で狙い、その奥まで透過で届かせる。
          if ((ally.concealed ?? 0) > 0) aimPos = ringCentroid(enclosing)
        }
      }
    } else if (breaker && !enemy.castZField && standingRings.length > 0) {
      // 火力型（05b §1）：狙う相手が結界に守られていれば、結界の反対極の候補も加えて
      // 「結界を破壊して押し通る」選択肢を採点に載せる（採用は最大ダメージ基準）
      const enclosing = standingRings.find((ring) => ring.length >= 3 && ringEncloses(ring, aimPos))
      if (enclosing) {
        const ringAttr = ringAverageAttr(enclosing)
        if (ringAttr !== 'neutral') {
          const sign = ringAttr === 'light' ? -1 : 1 // 反対極で当てて相殺（破壊）する
          for (const m of ATTACK_Z_MAGS) {
            if (!zCands.some((c) => c.zVal === sign * m)) {
              zCands = [...zCands, { z: constZField(sign * m), zVal: sign * m }]
            }
          }
        }
      }
    }
    // 火力型のランプ z 場（05b §3 指数系）：飛行中は |z|≈0（中庸＝最大加速）を保ち、
    // 命中直前に |z|→zPeak へ立ち上げる。「速度を出しつつ最大強度で当てる」火力型らしい候補。
    // 飛行中の |z|≈0 は最大加速＝壁に高速で当たる＝carve 半径も大きい（#64：加速度を上げる
    // ほど貫通しやすい）。掘削（drill）の最深到達もこのランプ候補が自然に担う。
    if (breaker && !enemy.castZField) {
      const Lr = dist(enemy.pos, aimPos) || 1
      const sign = ally.element === 'light' ? -1 : 1 // 反対極を突く
      const ramp: ZField = (x, y) => {
        const t = Math.min(1, Math.hypot(x, y) / Lr)
        return sign * FIELD.zPeak * Math.pow(t, COMBAT.breakerRampPow)
      }
      zCands = [...zCands, { z: ramp, zVal: sign * FIELD.zPeak }]
      // 高難度（LVL≥breakerDrillMinLevel）は「掘削用の弱い一定場」を両極で試す（05b §5.1）：
      // |z|=breakerDrillZ(=1.5) は加速域（|z|<zRef）のまま高速を保ち、削りの速度損に耐える。
      // さらに z を壁の反対極に合わせられれば削りの速度損は ×0.5（相性1.5）になり、
      // 色つきの壁を3倍安く掘り抜ける。おまかせ（zWeak）は対象の反対極しか試さないため、
      // 高難度の火力型はここで掘削効率が上回る。開けた地形ではランプ候補が採点で勝つ。
      if ((enemy.level ?? 7) >= COMBAT.breakerDrillMinLevel) {
        for (const m of [COMBAT.breakerDrillZ, -COMBAT.breakerDrillZ]) {
          if (!zCands.some((c) => c.zVal === m)) zCands = [...zCands, { z: constZField(m), zVal: m }]
        }
      }
    }
    aims.push({ ally, aimPos, zCands })

    const base = aimAt(enemy.pos, aimPos)
    const hFold = dist(enemy.pos, aimPos) * ABS_H_RATIO
    // 得意関数を全て試す（#28：poly34 の 3〜5 次・abs の折れ点は familyTrajectories が一元展開・#46）
    let cleanHit = false
    for (const fam of families) {
      for (const zc of zCands) {
        for (const traj of familyTrajectories(fam, enemy.pos, base, zc.z, hFold, fieldR, fitCx)) {
          if (consider(traj, ally, aimPos, zc.zVal, 1)) cleanHit = true
        }
      }
    }
    // 壁よけ（§8/§10）：クリーン命中が無ければ、経路探索→family フィットで回り込む。
    // breaker は壊して進むので使わない（従来どおり）。
    if (!breaker && env && wideEnv && !cleanHit) {
      for (const route of cleanRoutes(env, wideEnv, enemy.pos, aimPos)) {
        for (const fit of fitRouteToFamilies(route.points, enemy.pos, routeFams, fitCx)) {
          for (const zc of zCands) {
            const traj: Trajectory = { mode: 'rotate', g: fit.g, angle: fit.angle, origin: enemy.pos, z: zc.z, fieldR }
            consider(traj, ally, aimPos, zc.zVal, MANEUVER, fit.turnXs)
          }
        }
      }
    }
  }

  // クリーン命中がどの味方にも無いときだけ、直線トンネル（壁削り）の経路を追加で試す（§9.1）。
  // 読み（#75）で撃ち落とされると分かっている候補しか無いときも、道を掘る手を探し直す
  if (!breaker && env && (!sel.best || sel.best.rank[0] > 0 || sel.best.blocked)) {
    for (const { ally, aimPos, zCands } of aims) {
      const route = findRoute(env, enemy.pos, aimPos, 'wallTunnel')
      if (!route) continue
      for (const fit of fitRouteToFamilies(route.points, enemy.pos, routeFams, fitCx)) {
        for (const zc of zCands) {
          const traj: Trajectory = { mode: 'rotate', g: fit.g, angle: fit.angle, origin: enemy.pos, z: zc.z, fieldR }
          consider(traj, ally, aimPos, zc.zVal, MANEUVER, fit.turnXs)
        }
      }
    }
  }
  if (sel.best) return sel.best.plan

  // 火力型（#64）：どの候補も命中しない＝壁が厚い。牽制でお茶を濁さず、
  // 「1番奥まで掘れる」候補で壁を掘り進める（毎ターン掘り足せばいずれ道が開く）。
  if (breaker && drill.best) return drill.best.plan

  // 迂回型（#70）：結界も突破できないなら、**障害物に当ててでも相手へ向かう**。
  // 牽制（当たらない一撃）より、狙いまでに残る素材が最小＝相手へ最短で届く経路を掘る方が常に良い。
  if (drill.best) return drill.best.plan

  // 命中見込みなし：最もHPが低い味方へ牽制（見える相手・見かけ位置へ・#35）。
  // family は得意関数から選ぶ（line を持たない個体＝迂回型/暴発型は曲線で牽制・05b §2）。
  const target = candidates.reduce((lo, a) => (a.hp < lo.hp ? a : lo))
  const aim = perceivedPos(target)
  const fbFam = families.includes('line') ? 'line' : families[0]
  const fbShape =
    fbFam === 'line' ? 0 : shapeCandidates(fbFam).slice().sort((a, b) => Math.abs(a) - Math.abs(b))[0]
  // 狙う相手が結界に囲まれて突破できない場合は、結界そのものに反対極を当てて削る
  // （迂回型・暴発型：避けられないなら結界に当てる／火力型：破壊して道を開ける・05b §1）。
  // 得意関数の候補から「実際に結界の境界を横切る」軌道を選ぶ（曲がる family でも確実に当てる）
  const enclosing = standingRings.find((ring) => ring.length >= 3 && ringEncloses(ring, aim))
  const enclosingAttr = enclosing ? ringAverageAttr(enclosing) : 'neutral'
  if (enclosing && !enemy.castZField && enclosingAttr !== 'neutral') {
    const sign = enclosingAttr === 'light' ? -1 : 1 // 結界の反対極＝横断点で相殺して結界を削る
    const z = constZField(sign * FIELD.zRef)
    const base = aimAt(enemy.pos, aim)
    const unbreakables = obstacles.filter((ob) => (ob.kind ?? 'normal') === 'unbreakable')
    for (const fam of families) {
      for (const shape of shapeCandidates(fam)) {
        // 曲がる family は終点が狙いから大きく逸れる → 終点方向との差で狙い角を補正しながら試す
        let angle = base
        for (let iter = 0; iter < 3; iter++) {
          const traj = buildEnemyTrajectory(fam, enemy.pos, angle, shape, z, 20, 3, fieldR)
          const { path, flight } = enemyFlight(traj, enemy.castInitialSpeed)
          if (path.length < 2) break
          const inter = ringInterception(enclosing, path)
          if (inter.crossed && inter.enemyIndex !== undefined) {
            // 横断点まで失速せず届き、unbreakable を横切らない候補だけ採用（§14.1）
            const sample = flight.samples[Math.min(inter.enemyIndex, flight.samples.length - 1)]
            const dense = densifyGeom(flight.samples.slice(0, inter.enemyIndex + 1), OBSTACLE_STEP)
            const hitsU = unbreakables.length > 0 && dense.some((s) => unbreakables.some((ob) => isSolidAt(ob, s.pos)))
            if (sample && sample.speed > 0 && !hitsU) {
              return { trajectory: traj, targetId: target.id, expectedDamage: 0 }
            }
          }
          const end = path[path.length - 1]
          const err = base - aimAt(enemy.pos, end)
          if (!Number.isFinite(err) || Math.abs(err) < 1e-3) break
          angle += err
        }
      }
    }
  }
  // 通常の牽制：失速しないよう、減速しない zRef（対象の反対極）で撃つ（#31）
  const fallbackZ = enemy.castZField ?? constZField((target.element === 'light' ? -1 : 1) * FIELD.zRef)
  return {
    trajectory: buildEnemyTrajectory(fbFam, enemy.pos, aimAt(enemy.pos, aim), fbShape, fallbackZ, 20, 3, fieldR),
    targetId: target.id,
    expectedDamage: 0,
  }
}
