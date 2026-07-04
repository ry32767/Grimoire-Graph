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
import { COMBAT, FIELD, GAME } from '../data/constants'
import {
  AVOIDER_FAMILIES,
  ABS_H_RATIO,
  aimAt,
  buildEnemyTrajectory,
  familyTrajectories,
  shapeCandidates,
  enemyFlight,
} from './enemyPlanning/trajectories'
import { perceivedPos, threatScore, enemyFamilies, avoiderFamiliesOf } from './enemyPlanning/perception'
import { buildPlanningEnv } from './enemyPlanning/planningEnv'
import { findRoute } from './enemyPlanning/routeSearch'
import { fitRouteToFamilies } from './enemyPlanning/routeFit'
import { evaluateEnemyShot, compareRank } from './enemyPlanning/evaluate'
import { planRuptorShot, buildRuptorZField } from './enemyPlanning/ruptorPlanner'

// 既存の公開 API（テスト・turn.ts が参照）は enemyPlanning/ へ移した実装を再輸出して維持する
export { AVOIDER_FAMILIES, enemyFlight, planRuptorShot, buildRuptorZField }

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
}

/**
 * 守護型の脅威方向 φ_threat（05b §5.4・#47）：見えている味方のうち最も脅威度の高い者の方向。
 * threatScore（woundFocus/lowHpBias）で選び、その味方を敵から見た角度を返す。見えなければ null。
 */
function threatDirection(enemy: Enemy, allies: Ally[]): number | null {
  const visible = allies.filter((a) => a.hp > 0 && (a.concealed ?? 0) < COMBAT.orbitConcealFull)
  if (visible.length === 0) return null
  const t = visible.reduce((best, a) => (threatScore(a) > threatScore(best) ? a : best))
  return aimAt(enemy.pos, t.pos)
}

/**
 * 守護型の結界 z 場を組む（05b §5.4）。
 * - 通常（一様）：z = sign·zRef（全周一定・|z|=zRef で失速しない）。
 * - 方向づけ（directedAura・#47）：z(x,y) = sign·zRef·cos(φ−φ_threat)。脅威方向 φ_threat で
 *   |z| 最大（=zRef）、そこから離れるほど弱まる。全周で |z|≤zRef を保つため失速自滅しない。
 *   alternatingAura と併用時も sign（guardZSign）を振幅に掛けるだけで振幅≤zRef を維持する。
 * z 場は術者位置 origin を原点として評価される（#52）ため、(x,y) は origin 相対で受ける。
 */
function buildGuardZField(enemy: Enemy, sign: 1 | -1, threatPhi: number | null): ZField {
  if (!enemy.directedAura || threatPhi === null) return constZField(sign * FIELD.zRef)
  const amp = sign * FIELD.zRef
  // (x,y) は origin 相対。その点の方位角 φ と脅威方向の差の余弦で強度を傾ける
  return (x, y) => amp * Math.cos(Math.atan2(y, x) - threatPhi)
}

/**
 * 防御ロール（guardian・#28/05b §5.4）：自分の周りに周回結界（閉じた円）を張る。
 * z は自陣の属性（交互張り個体は guardZSign）で、減速しない最大強度 |z|≤zRef に張る
 * （#31：|z|>zRef だと結界自身が失速して霧散する＝「リング全周で |z|≤zRef」の自壊回避）。
 * directedAura 個体は脅威方向に強度を偏らせた非一様場を張る（#47・全周で |z|≤zRef を維持）。
 * 半径は障害物の素材に触れないものを選ぶ（触れると orbitWallBreak で即霧散するため・05b §5.4）。
 */
function planGuardianOrbit(
  enemy: Enemy,
  allies: Ally[] = [],
  obstacles: Obstacle[] = [],
  teammates: TeamMate[] = [],
  fieldR?: number,
): EnemyPlan {
  const sign = enemy.guardZSign ?? (enemy.element === 'dark' ? -1 : 1)
  const touches = (r: number): boolean => {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const p = { x: enemy.pos.x + r * Math.cos(a), y: enemy.pos.y + r * Math.sin(a) }
      if (obstacles.some((ob) => isSolidAt(ob, p))) return true
    }
    return false
  }
  // 半径 r の結界が囲える味方の数（自分＋余裕をもって内側に入る生存味方・05b §5.4）
  const coverOf = (r: number): number =>
    1 + teammates.filter((t) => t.id !== enemy.id && t.hp > 0 && dist(t.pos, enemy.pos) <= r - 1).length
  // 候補半径：既定 → 縮小2段（壁回避）→ 拡大1段（自分だけでなく味方も囲む・05b §5.4）。
  // 壁に触れない候補のうち、囲える味方が最多のものを選ぶ（同数なら既定寄りの大きい方＝従来動作）。
  const radii = [
    GAME.enemyGuardRadius,
    GAME.enemyGuardRadius * 0.75,
    GAME.enemyGuardRadius * 0.55,
    GAME.enemyGuardRadius * 1.3,
  ]
  let radius = GAME.enemyGuardRadius * 0.55 // 全候補が壁に触れるときの既定（最小）
  let bestCover = -1
  for (const r of radii) {
    if (touches(r)) continue
    const c = coverOf(r)
    if (c > bestCover) {
      bestCover = c
      radius = r
    }
  }
  const threatPhi = threatDirection(enemy, allies)
  const traj: Trajectory = {
    mode: 'polar',
    f: () => radius,
    origin: enemy.pos,
    z: buildGuardZField(enemy, sign, threatPhi),
    fieldR,
  }
  return { trajectory: traj, targetId: '', expectedDamage: 0 }
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
): EnemyPlan[] {
  const count = Math.max(1, enemy.castCount ?? 1)
  if (count === 1) {
    const p = planEnemyShot(enemy, allies, obstacles, standingRings, teammates, fieldR, instability)
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
    const plan = planEnemyShot(variant, pickFrom, obstacles, standingRings, teammates, fieldR, instability)
    if (!plan) continue
    if (plan.targetId) taken.add(plan.targetId)
    plans.push(plan)
  }
  return plans
}

/** 迂回（壁よけ・経路フィット）の取り回しコスト：遠回りなので直進よりわずかに不利（#28）。 */
const MANEUVER = 0.9

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
): EnemyPlan | null {
  const alive = allies.filter((a) => a.hp > 0)
  if (alive.length === 0) return null

  // 防御ロール：自陣（自分＋味方）を守る周回結界を張る（#28/05b §5.4）
  if (enemy.role === 'guardian') return planGuardianOrbit(enemy, allies, obstacles, teammates, fieldR)

  // 崩し手（#42）：狙った対象の近傍で暴発させる専用計画（enemyPlanning/ruptorPlanner）。
  // teammates（敵チーム）を渡し、自爆・味方巻き込みになる極を避けさせる（§12.7）
  if (enemy.role === 'ruptor') {
    return planRuptorShot(enemy, allies, obstacles, undefined, standingRings, fieldR, instability, teammates)
  }

  // 闇の周回で完全に隠れた味方は視認不可＝狙えない（#35）。全員隠れていれば見えないなりに撃つ。
  const visible = alive.filter((a) => (a.concealed ?? 0) < COMBAT.orbitConcealFull)
  const candidates = visible.length > 0 ? visible : alive

  // 火力型（breaker）は障害物を壊して進む＝family 制約なし・clean 優先もしない。
  // 迂回型（attacker）は abs/arc/poly34 のみに絞る（#46・05b §2）。
  const breaker = enemy.role === 'breaker'
  const families = breaker ? enemyFamilies(enemy) : avoiderFamiliesOf(enemy)
  // 経路フィットに使える family（線・波の個体でも、迂回が要る局面では主力一式で回り込む）
  const fitFams = families.filter((f) => AVOIDER_FAMILIES.includes(f))
  const routeFams: readonly EnemyFamily[] = fitFams.length > 0 ? fitFams : AVOIDER_FAMILIES
  const env = obstacles.length > 0 ? buildPlanningEnv(obstacles, fieldR) : null

  // 採点結果（プロパティ経由＝クロージャ代入でも型の絞り込みが崩れない）
  const sel = { best: null as { plan: EnemyPlan; rank: readonly number[] } | null }
  // 火力型の掘削候補（#64）：どの候補も命中しない＝壁が厚いとき、「1番奥まで掘り進める」
  // 候補（停止点が狙いに最も近い＝carve 損失込みで最深到達）を布石として選ぶ。
  // ランプ z（飛行中 |z|≈0＝最大加速）は速度が乗って carve 半径も大きく、自然に最深になる。
  const drill = { best: null as { plan: EnemyPlan; depth: number } | null }
  const trackDrill = (traj: Trajectory, ally: Ally, aimPos: Vec2, ev: ReturnType<typeof evaluateEnemyShot>): void => {
    const last = ev.flight.samples[ev.flight.samples.length - 1]
    if (!last) return
    if (ev.materialArcs.length === 0) return // 素材を削らず失速/逸れた候補は掘削でない
    // unbreakable に当たって止まった候補は、掘っても道が開かない＝対象外
    if (ev.unbreakableArc !== null && last.arcLen >= ev.unbreakableArc - 0.3) return
    const depth = dist(last.pos, aimPos) // 小さいほど奥（狙いの近く）まで届いた
    if (!drill.best || depth < drill.best.depth) {
      drill.best = { plan: { trajectory: traj, targetId: ally.id, expectedDamage: 0 }, depth }
    }
  }
  /** 候補を本番物理で評価し rank で採点する。命中しなければ false（＝攻撃候補にならない）。 */
  const consider = (traj: Trajectory, ally: Ally, aimPos: Vec2, zVal: number, maneuver: number, turnXs?: number[]): boolean => {
    const ev = evaluateEnemyShot(traj, enemy.castInitialSpeed, obstacles, standingRings, { turnXs })
    const hit = firstHit(ev.flight.samples, aimPos, GAME.allyHitbox)
    if (!hit || hit.speed <= 0) {
      if (breaker) trackDrill(traj, ally, aimPos, ev) // 不達でも掘削の布石として記録（#64）
      return false // 失速・不達の候補は捨てる（#31）
    }
    // 破壊不能壁（unbreakable）は削れず必ず弾を止める＝命中前に横切る候補は全ロールで棄却
    if (ev.unbreakableArc !== null && ev.unbreakableArc < hit.arcLen) return false
    const matBefore = ev.materialArcs.filter((a) => a < hit.arcLen).length
    const turnsBefore = ev.turnInMaterialArcs.filter((a) => a < hit.arcLen).length
    // 迂回型は壁内部で曲がる候補を棄却（§9.3：壁の中は入口→出口の直線だけを許す）
    if (!breaker && turnsBefore > 0) return false
    const ringsBefore = ev.oppositeRingArcs.filter((a) => a < hit.arcLen).length
    // 属性・強度の評価：迂回型は命中点の z 場（削り・結界減速込みの実速度 × 実強度＝本番と同じ
    // ダメージ）。火力型はランプ z の到達点＝代表 zVal（06b B.7「直進の火力弾」の設計を保つ：
    // 命中点 z で採点すると「横から回り込んで zPeak ちょうどで当てる」曲線を選んでしまう）
    const hz = breaker ? zVal : zfieldAt(traj, hit.pos)
    const baseDmg = hit.speed * strengthOf(hz) * affinityMultiplier(attributeOf(hz), ally.element) * maneuver
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
      sel.best = { plan: { trajectory: traj, targetId: ally.id, expectedDamage: score }, rank }
    }
    return rank[0] === 0
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
    }
    aims.push({ ally, aimPos, zCands })

    const base = aimAt(enemy.pos, aimPos)
    const hFold = dist(enemy.pos, aimPos) * ABS_H_RATIO
    // 得意関数を全て試す（#28：poly34 の 3〜5 次・abs の折れ点は familyTrajectories が一元展開・#46）
    let cleanHit = false
    for (const fam of families) {
      for (const zc of zCands) {
        for (const traj of familyTrajectories(fam, enemy.pos, base, zc.z, hFold, fieldR)) {
          if (consider(traj, ally, aimPos, zc.zVal, 1)) cleanHit = true
        }
      }
    }
    // 壁よけ（§8/§10）：クリーン命中が無ければ、経路探索→family フィットで回り込む。
    // breaker は壊して進むので使わない（従来どおり）。
    if (!breaker && env && !cleanHit) {
      const route = findRoute(env, enemy.pos, aimPos, 'clean')
      if (route) {
        for (const fit of fitRouteToFamilies(route.points, enemy.pos, routeFams)) {
          for (const zc of zCands) {
            const traj: Trajectory = { mode: 'rotate', g: fit.g, angle: fit.angle, origin: enemy.pos, z: zc.z, fieldR }
            consider(traj, ally, aimPos, zc.zVal, MANEUVER, fit.turnXs)
          }
        }
      }
    }
  }

  // クリーン命中がどの味方にも無いときだけ、直線トンネル（壁削り）の経路を追加で試す（§9.1）
  if (!breaker && env && (!sel.best || sel.best.rank[0] > 0)) {
    for (const { ally, aimPos, zCands } of aims) {
      const route = findRoute(env, enemy.pos, aimPos, 'wallTunnel')
      if (!route) continue
      for (const fit of fitRouteToFamilies(route.points, enemy.pos, routeFams)) {
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
