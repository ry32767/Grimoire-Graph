// 敵AI（#2・#17）：敵ごとの「得意関数（系統）」で攻撃を最適化する。純粋関数。
// 各敵は family（直線/弧/波/渦）を持ち、AI は狙い角と形状係数の候補から、
// 狙う味方へ最大ダメージを与える軌道を選ぶ（軌跡型は陣営有利＝強属性で展開）。
import type { Ally, Enemy, EnemyFamily, EnemyRole, Flight, Obstacle, Trajectory, Vec2, ZField } from './types'
import { sampleTrajectory, validPrefix, pathTermination, dist } from './coords'
import { simulatePath } from './physics'
import { firstHit } from './collision'
import { isSolidAt } from './obstacle'
import { attributeOf, strengthOf, affinityMultiplier, zfieldAt } from './attribute'
import { ringEncloses, ringAverageAttr, type RingPoint } from './orbit'
import { constZField } from './zfields'
import { COMBAT, FIELD, GAME, RUPTOR } from '../data/constants'

/** 闇の周回1重あたり、敵が見誤る距離（ユニット・#35）。ヒットボックスより大きく外す。 */
const CONCEAL_JITTER = 3.5

/** 文字列IDから安定した方向ベクトルを作る（隠れた味方の見かけ位置をずらす・#35）。 */
function idDir(id: string): Vec2 {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997
  const ang = (h / 997) * Math.PI * 2
  return { x: Math.cos(ang), y: Math.sin(ang) }
}

/**
 * 敵が認識する味方位置（#35/#39）。闇の周回で隠れているほど真の位置から離れて見える。
 * ブレ幅は囲む円の半径に連動した RMSE（concealRmse・1重=半径/2、2重=半径）。
 * 方向は id 由来で安定（純粋関数を保つ＝同ターンの再評価で揺らがない）。RMSE 未設定の旧データは重数×既定幅。
 */
function perceivedPos(ally: Ally): Vec2 {
  const conceal = ally.concealed ?? 0
  if (conceal <= 0) return ally.pos
  const mag = ally.concealRmse && ally.concealRmse > 0 ? ally.concealRmse : conceal * CONCEAL_JITTER
  const d = idDir(ally.id)
  return { x: ally.pos.x + d.x * mag, y: ally.pos.y + d.y * mag }
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
}

/** exp 系統の指数の伸び係数（#43：終盤で鋭く跳ね上がる）。 */
const EXP_K = 0.13
/** poly34 系統の 3 次曲線の零点調整（g(x)=shape·(x³−POLY_C·x)＝±√POLY_C で軸を跨ぐ S 字）。 */
const POLY_C = 140

/** 敵位置 from から to を向く基準角。 */
function aimAt(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

/** family＋狙い角＋形状係数から敵の軌道を組み立てる（origin=敵位置・z 場つき）。 */
function buildEnemyTrajectory(
  family: EnemyFamily,
  origin: Vec2,
  angle: number,
  shape: number,
  z: ZField,
): Trajectory {
  switch (family) {
    case 'line':
      return { mode: 'rotate', g: () => 0, angle, origin, z }
    case 'arc':
      // 緩い放物の弧（左右に曲がる）
      return { mode: 'rotate', g: (x) => shape * x * x, angle, origin, z }
    case 'wave':
      // 波打って進む（shape=振幅）
      return { mode: 'rotate', g: (x) => shape * Math.sin(0.45 * x), angle, origin, z }
    case 'spiral':
      // 渦巻き（shape=巻きの強さ）。狙い角ぶん回す
      return { mode: 'polar', f: (t) => shape * (t + angle), origin, z }
    case 'exp':
      // 指数（#43）：序盤はほぼ直進し、終盤で鋭く横へ跳ね上がる
      return { mode: 'rotate', g: (x) => shape * (Math.exp(EXP_K * x) - 1), angle, origin, z }
    case 'poly34':
      // 3次（#43）：S字・こぶを作る高自由度の捻れ曲線
      return { mode: 'rotate', g: (x) => shape * (x * x * x - POLY_C * x), angle, origin, z }
  }
}

/** family ごとの形状係数候補。 */
function shapeCandidates(family: EnemyFamily): number[] {
  switch (family) {
    case 'line':
      return [0]
    case 'arc':
      return [-0.09, -0.04, 0.04, 0.09]
    case 'wave':
      return [1.5, 3]
    case 'spiral':
      return [0.7, 1.1]
    case 'exp':
      return [-0.8, -0.35, 0.35, 0.8]
    case 'poly34':
      return [-0.004, -0.002, 0.002, 0.004]
  }
}

// ===== 壁を避ける軌道生成（#28：通過点を選び、それを通る近似曲線＝多項式を作る） =====

/** ローカル系（origin 起点・angle 方向）の (x, y) を数学座標へ写す。x=進行方向, y=横。 */
function localToWorld(origin: Vec2, angle: number, x: number, y: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: origin.x + x * c - y * s, y: origin.y + x * s + y * c }
}

/**
 * 通過点 (x_i, y_i) を全て通る多項式 g(x) を作る（ラグランジュ補間・#28）。
 * 点数 n でちょうど (n−1) 次の曲線になり、機械らしい複雑な軌跡が生まれる。x は相異なる前提。
 */
function fitPolynomial(points: { x: number; y: number }[]): (x: number) => number {
  return (x: number) => {
    let y = 0
    for (let i = 0; i < points.length; i++) {
      let term = points[i].y
      for (let j = 0; j < points.length; j++) {
        if (j === i) continue
        const denom = points[i].x - points[j].x
        if (Math.abs(denom) < 1e-9) return NaN
        term *= (x - points[j].x) / denom
      }
      y += term
    }
    return y
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 壁を避けて aimPos へ届く候補軌道（#28）。直線が最初に素材へ触れる地点を迂回起点に取り、
 * そこを横へ膨らませる通過点を選んで近似曲線を引く。単一の弓なりと S 字（より複雑）を出す。
 * 障害物が無ければ空（迂回不要）。breaker（壁を壊す）には呼び出し側が渡さない。
 */
function avoiderTrajectories(origin: Vec2, aimPos: Vec2, z: ZField, obstacles: Obstacle[]): Trajectory[] {
  if (obstacles.length === 0) return []
  const angle = aimAt(origin, aimPos)
  const L = dist(origin, aimPos)
  if (L < 4) return []
  // 直線（局所 y=0）で最初に素材へ触れる局所 x（迂回の起点）。無ければ中央。
  let xb = L * 0.5
  for (let x = 0.5; x <= L; x += 0.5) {
    if (obstacles.some((o) => isSolidAt(o, localToWorld(origin, angle, x, 0)))) {
      xb = x
      break
    }
  }
  const out: Trajectory[] = []
  const mid = clamp(xb, 1.5, L - 1.5)
  // 単一の弓なり：迂回起点を横へ膨らませて壁の脇/上を抜ける
  for (const off of [4, 7, 10, -4, -7, -10]) {
    const g = fitPolynomial([{ x: 0, y: 0 }, { x: mid, y: off }, { x: L, y: 0 }])
    out.push({ mode: 'rotate', g, angle, origin, z })
  }
  // S 字：2つの通過点で複雑に回り込む（#28：独特な軌跡）
  const xa = clamp(xb * 0.7, 1.5, L - 3)
  const xc = clamp(xb * 1.2, xa + 1.5, L - 1.5)
  if (xc > xa) {
    for (const off of [6, 9, -6, -9]) {
      const g = fitPolynomial([{ x: 0, y: 0 }, { x: xa, y: off }, { x: xc, y: -off * 0.7 }, { x: L, y: 0 }])
      out.push({ mode: 'rotate', g, angle, origin, z })
    }
  }
  return out
}

/** 敵の軌道から path と飛行を作る（z は軌道の z 場を位置で評価・#28）。 */
export function enemyFlight(traj: Trajectory, speed: number): { path: Vec2[]; flight: Flight } {
  const path = validPrefix(sampleTrajectory(traj)).map((s) => s.pos)
  const flight = simulatePath(path, speed, (i) => zfieldAt(traj, path[Math.min(i, path.length - 1)]))
  return { path, flight }
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

/** 敵が実際に使う得意関数の系統一覧（#28：family＋families を重複なくまとめる）。 */
function enemyFamilies(enemy: Enemy): EnemyFamily[] {
  if (!enemy.families || enemy.families.length === 0) return [enemy.family]
  return Array.from(new Set([enemy.family, ...enemy.families]))
}

/**
 * 防御ロール（guardian・#28/05b §5.4）：自分の周りに周回結界（閉じた円）を張る。
 * z は自陣の属性（交互張り個体は guardZSign）で、減速しない最大強度 |z|=zRef に張る
 * （#31：|z|>zRef だと結界自身が失速して霧散する＝「リング全周で |z|≤zRef」の自壊回避）。
 * 半径は障害物の素材に触れないものを選ぶ（触れると orbitWallBreak で即霧散するため・05b §5.4）。
 */
function planGuardianOrbit(enemy: Enemy, obstacles: Obstacle[] = []): EnemyPlan {
  const sign = enemy.guardZSign ?? (enemy.element === 'dark' ? -1 : 1)
  const zVal = sign * FIELD.zRef
  // 大きい順に試し、リング上のどの点も素材に触れない半径を選ぶ（全て触れるなら最小で張る）
  const radii = [GAME.enemyGuardRadius, GAME.enemyGuardRadius * 0.75, GAME.enemyGuardRadius * 0.55]
  let radius = radii[radii.length - 1]
  for (const r of radii) {
    let touches = false
    for (let i = 0; i < 24 && !touches; i++) {
      const a = (i / 24) * Math.PI * 2
      const p = { x: enemy.pos.x + r * Math.cos(a), y: enemy.pos.y + r * Math.sin(a) }
      touches = obstacles.some((ob) => isSolidAt(ob, p))
    }
    if (!touches) {
      radius = r
      break
    }
  }
  const traj: Trajectory = {
    mode: 'polar',
    f: () => radius,
    origin: enemy.pos,
    z: constZField(zVal),
  }
  return { trajectory: traj, targetId: '', expectedDamage: 0 }
}

// ===== 崩し手（ruptor・#42／05b §4）：z 場に極を仕込み、対象の近傍で暴発させる =====

/**
 * ruptor の z 場（05b §4）：狙点 target で g=0 になる「接近方向の符号付き距離」g に極を仕込む。
 * z(x,y) = zBase×極性 + k/g(x,y)。接近側（g<0）では極の寄与が基礎 z と同符号になるよう k の符号を選び、
 * 飛行区間は属性が読める通常の光/闇弾として振る舞う。狙点を跨ぐと z の符号が大きく反転し、
 * 既存の極判定（coords.applyZValidity）がそのまま暴発（z 場エラー・04-magic §4.3）として検出する。
 */
export function buildRuptorZField(origin: Vec2, target: Vec2, polarity: 1 | -1): ZField {
  const dx = target.x - origin.x
  const dy = target.y - origin.y
  const L = Math.hypot(dx, dy) || 1
  const ux = dx / L
  const uy = dy / L
  const base = RUPTOR.zBase * polarity
  const k = -RUPTOR.poleK * polarity // 接近側（g<0）で k/g が base と同符号になる
  return (x, y) => {
    const g = (x - target.x) * ux + (y - target.y) * uy
    return base + k / g
  }
}

/** ruptor が狙う味方の優先度（attacker の woundFocus/lowHpBias と同じ考え方・05-enemies §5.4b）。 */
function threatScore(a: Ally): number {
  const woundFocus = 1 + (1 - a.hp / a.maxHp) * 0.5
  const lowHpBias = 1 + Math.max(0, (60 - a.hp) / 60) * 0.25
  return woundFocus * lowHpBias
}

/**
 * 崩し手の攻撃計画（#42・05b §4）。通常の最大ダメージ探索は使わず、
 * 「狙う対象の近傍に z 場の極（暴発点）が来る」軌道を、迂回型と同じ family（line 不可）から選ぶ。
 * aimOverride を渡すとその位置を狙う（ボス断末魔の分散ターゲティングに使う・#45）。
 */
export function planRuptorShot(
  enemy: Enemy,
  allies: Ally[],
  obstacles: Obstacle[] = [],
  aimOverride?: { pos: Vec2; targetId: string },
): EnemyPlan | null {
  const alive = allies.filter((a) => a.hp > 0)
  if (alive.length === 0) return null
  // 隠蔽の扱いは attacker と同じ（#35）：完全に隠れた味方は狙えず、見かけ位置で計画する
  const visible = alive.filter((a) => (a.concealed ?? 0) < COMBAT.orbitConcealFull)
  const candidates = visible.length > 0 ? visible : alive
  const target = candidates.reduce((best, a) => (threatScore(a) > threatScore(best) ? a : best))

  // 弾の極性は自陣の element（無属性なら対象の反対極）
  const polarity: 1 | -1 =
    enemy.element === 'light' ? 1 : enemy.element === 'dark' ? -1 : target.element === 'light' ? -1 : 1

  /**
   * 指定の狙点に極を仕込み、最良の軌道を探す。
   * 「極に到達して暴発する（ruptured）」かつ「途中で壁の素材に触れない（clear）」候補を最優先し、
   * その中で暴発点が狙点に最も近いものを選ぶ（暴発型の立ち回りは迂回型と同じ・05b §5.3）。
   */
  const searchAim = (aim: Vec2): { traj: Trajectory; d: number; rank: number; end: Vec2 } | null => {
    const z = buildRuptorZField(enemy.pos, aim, polarity)
    // 迂回型と同じ制約：line は使えない（05b §2）。曲率のある family から選ぶ
    const fams = enemyFamilies(enemy).filter((f) => f !== 'line')
    if (fams.length === 0) fams.push('arc')
    const base = aimAt(enemy.pos, aim)
    let best: { traj: Trajectory; d: number; rank: number; end: Vec2 } | null = null
    const consider = (traj: Trajectory) => {
      const { path, flight } = enemyFlight(traj, enemy.castInitialSpeed)
      if (path.length < 2 || flight.end === 'vanished') return // 失速する候補は捨てる
      const end = path[path.length - 1]
      const d = dist(end, aim)
      const ruptured = pathTermination(sampleTrajectory(traj)).end === 'invalid'
      // 経路が素材に触れると弾が削られ極に届かないことがある → 触れない候補を優先
      const clear = !path.some((p) => obstacles.some((ob) => isSolidAt(ob, p)))
      const rank = (ruptured ? 2 : 0) + (clear ? 1 : 0)
      if (!best || rank > best.rank || (rank === best.rank && d < best.d)) {
        best = { traj, d, rank, end }
      }
    }
    for (const fam of fams) {
      const aimOffsets = fam === 'spiral' ? [0] : [-0.28, -0.14, 0, 0.14, 0.28]
      for (const off of aimOffsets) {
        for (const shape of shapeCandidates(fam)) {
          consider(buildEnemyTrajectory(fam, enemy.pos, base + off, shape, z))
        }
      }
    }
    // 障害物があれば迂回軌道も試す（迂回型と同じ立ち回り・05b §5.3）
    for (const traj of avoiderTrajectories(enemy.pos, aim, z, obstacles)) consider(traj)
    return best
  }

  // 障害物狙いの個体（第4面デモ・#42）：壁の素材（unbreakable 以外）の「面の手前」に暴発点を置く。
  // 敵から近い順にいくつかのディスクを試し、確実に暴発できる（rank=3）狙いを選ぶ。
  if (!aimOverride && enemy.ruptorTarget === 'obstacles') {
    const discs: { pos: Vec2; r: number; d: number }[] = []
    for (const ob of obstacles) {
      if ((ob.kind ?? 'normal') === 'unbreakable') continue
      for (const disc of ob.solids) {
        discs.push({ pos: { x: disc.x, y: disc.y }, r: disc.r, d: dist(enemy.pos, { x: disc.x, y: disc.y }) })
      }
    }
    discs.sort((a, b) => a.d - b.d)
    let fallback: { traj: Trajectory; d: number; rank: number; end: Vec2 } | null = null
    for (const disc of discs.slice(0, 6)) {
      // 極（g の零点）は中心でなく壁「面」の近傍（05b §4）＝素材の外に出るまで敵側へ引く
      const L = disc.d || 1
      const pt = (t: number): Vec2 => ({
        x: enemy.pos.x + (disc.pos.x - enemy.pos.x) * t,
        y: enemy.pos.y + (disc.pos.y - enemy.pos.y) * t,
      })
      let t = Math.max(0, (L - disc.r) / L)
      while (t > 0 && obstacles.some((ob) => isSolidAt(ob, pt(t)))) t -= 0.4 / L
      const aim = pt(Math.max(0, t - 1.2 / L))
      const found = searchAim(aim)
      if (found && found.rank >= 3) {
        return { trajectory: found.traj, targetId: '', expectedDamage: 0, misfirePos: found.end }
      }
      if (found && (!fallback || found.rank > fallback.rank)) fallback = found
    }
    if (fallback) {
      const fb: { traj: Trajectory; d: number; rank: number; end: Vec2 } = fallback
      return { trajectory: fb.traj, targetId: '', expectedDamage: 0, misfirePos: fb.rank >= 2 ? fb.end : null }
    }
    // 壁が全て崩れた等：以後は通常の味方狙いへフォールバック
  }

  const aimPos = aimOverride?.pos ?? perceivedPos(target)
  const targetId = aimOverride?.targetId ?? target.id
  const best = searchAim(aimPos)
  if (!best) return null
  return {
    trajectory: best.traj,
    targetId,
    expectedDamage: 0,
    misfirePos: best.rank >= 2 ? best.end : null, // rank≥2 ＝極に到達して暴発する候補
  }
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
): EnemyPlan[] {
  const count = Math.max(1, enemy.castCount ?? 1)
  if (count === 1) {
    const p = planEnemyShot(enemy, allies, obstacles, standingRings)
    return p ? [p] : []
  }
  const pool: EnemyRole[] =
    enemy.patternPool && enemy.patternPool.length > 0 ? enemy.patternPool : [enemy.role ?? 'attacker']
  const alive = allies.filter((a) => a.hp > 0)
  const taken = new Set<string>()
  const plans: EnemyPlan[] = []
  for (let i = 0; i < count; i++) {
    const variant: Enemy = { ...enemy, role: pool[i % pool.length], castCount: 1 }
    const remaining = alive.filter((a) => !taken.has(a.id))
    const pickFrom = remaining.length > 0 ? remaining : alive
    const plan = planEnemyShot(variant, pickFrom, obstacles, standingRings)
    if (!plan) continue
    if (plan.targetId) taken.add(plan.targetId)
    plans.push(plan)
  }
  return plans
}

/**
 * 敵の攻撃を計画する：狙う味方×（狙い角×形状）の候補から、最大ダメージの軌道を選ぶ。
 * どの候補も命中見込みがなければ、最もHPの低い味方へ直進で牽制する。
 */
export function planEnemyShot(
  enemy: Enemy,
  allies: Ally[],
  obstacles: Obstacle[] = [],
  standingRings: RingPoint[][] = [],
): EnemyPlan | null {
  const alive = allies.filter((a) => a.hp > 0)
  if (alive.length === 0) return null

  // 防御ロール：自陣を守る周回結界を張る（#28）
  if (enemy.role === 'guardian') return planGuardianOrbit(enemy, obstacles)

  // 崩し手（#42）：狙った対象の近傍で暴発させる専用計画
  if (enemy.role === 'ruptor') return planRuptorShot(enemy, allies, obstacles)

  // 闇の周回で完全に隠れた味方は視認不可＝狙えない（#35）。全員隠れていれば見えないなりに撃つ。
  const visible = alive.filter((a) => (a.concealed ?? 0) < COMBAT.orbitConcealFull)
  const candidates = visible.length > 0 ? visible : alive

  // 壁を貫くロール（breaker）は障害物のペナルティを受けない（#28：壁を破壊して届かせる）
  const breaker = enemy.role === 'breaker'
  const families = enemyFamilies(enemy)

  let best: EnemyPlan | null = null
  // 候補軌道を1つ評価して best を更新する（#28：直進系も迂回系も同じ採点）。
  // maneuver は迂回の取り回しコスト（1=直進・<1=遠回り）。同条件なら直進/貫通が勝つ。
  const consider = (traj: Trajectory, ally: Ally, aimPos: Vec2, bAttr: ReturnType<typeof attributeOf>, bStr: number, maneuver: number) => {
    const { flight } = enemyFlight(traj, enemy.castInitialSpeed)
    const hit = firstHit(flight.samples, aimPos, GAME.allyHitbox)
    if (!hit || hit.speed <= 0) return // 失速して届かない（速度0）候補は捨てる（#31）
    // 障害物（素材）が手前にあると弾が削れる＝評価を下げる（breaker は貫くので無視）
    let penalty = 1
    if (!breaker) {
      for (const sm of flight.samples) {
        if (sm.arcLen >= hit.arcLen) break
        if (obstacles.some((ob) => isSolidAt(ob, sm.pos))) {
          penalty = 0.55
          break
        }
      }
    }
    const baseDmg = hit.speed * bStr * affinityMultiplier(bAttr, ally.element) * penalty * maneuver
    // とどめを刺せる相手を最優先、次に手負い（割合）を優先
    const killBonus = baseDmg >= ally.hp ? 2.2 : 1
    const woundFocus = 1 + (1 - ally.hp / ally.maxHp) * 0.5
    // 絶対HPが低い相手をわずかに優先（同割合なら低HPを狙う）
    const lowHpBias = 1 + Math.max(0, (60 - ally.hp) / 60) * 0.25
    const score = baseDmg * killBonus * woundFocus * lowHpBias
    if (!best || score > best.expectedDamage) {
      best = { trajectory: traj, targetId: ally.id, expectedDamage: score }
    }
  }

  // 迂回（壁よけ）の取り回しコスト：遠回りなので直進よりわずかに不利（#28）
  const MANEUVER = 0.9
  for (const ally of candidates) {
    // 隠れている味方は見かけの位置（ずれた位置）で狙う＝命中評価もそこに対して行う（#35）
    const aimPos = perceivedPos(ally)
    const base = aimAt(enemy.pos, aimPos)
    // 攻撃の z 場は対象の弱点（反対極）を、強さ違い（zPeak/zRef）で試す（#28/#31：届く威力を最大化）
    let zCands = attackZCandidates(enemy, ally.element)
    // 迂回型の高難度個体（05b §5.2）：狙う相手が結界に守られていれば、
    // 結界の平均属性と同極の z に合わせてすり抜ける（同極は透過＝04-magic §4.6）。
    // 固有の castZField を持つ個体でも、すり抜けが可能な局面ではそちらを優先する
    if (enemy.slipThrough && standingRings.length > 0) {
      const enclosing = standingRings.find((ring) => ring.length >= 3 && ringEncloses(ring, aimPos))
      if (enclosing) {
        const ringAttr = ringAverageAttr(enclosing)
        if (ringAttr !== 'neutral') {
          const sign = ringAttr === 'light' ? 1 : -1
          zCands = ATTACK_Z_MAGS.map((m) => ({ z: constZField(sign * m), zVal: sign * m }))
        }
      }
    }
    // 得意関数を1～2個すべて試す（#28：複数関数を組み合わせて戦う）
    for (const fam of families) {
      const shapes = shapeCandidates(fam)
      const aimOffsets = fam === 'spiral' ? [0] : [-0.28, -0.14, 0, 0.14, 0.28]
      for (const off of aimOffsets) {
        for (const shape of shapes) {
          for (const zc of zCands) {
            const traj = buildEnemyTrajectory(fam, enemy.pos, base + off, shape, zc.z)
            consider(traj, ally, aimPos, attributeOf(zc.zVal), strengthOf(zc.zVal), 1)
          }
        }
      }
    }
    // 壁よけ（#28）：通過点を選んで近似曲線で回り込む。breaker は壊して進むので使わない。
    if (!breaker) {
      for (const zc of zCands) {
        for (const traj of avoiderTrajectories(enemy.pos, aimPos, zc.z, obstacles)) {
          consider(traj, ally, aimPos, attributeOf(zc.zVal), strengthOf(zc.zVal), MANEUVER)
        }
      }
    }
  }
  if (best) return best

  // 命中見込みなし：最もHPが低い味方へ直進で牽制（見える相手・見かけ位置へ・#35）。
  // 牽制弾も失速しないよう、減速しない zRef（反対極）で撃つ（#31）。
  const target = candidates.reduce((lo, a) => (a.hp < lo.hp ? a : lo))
  const fallbackZ = enemy.castZField ?? constZField((target.element === 'light' ? -1 : 1) * FIELD.zRef)
  return {
    trajectory: buildEnemyTrajectory('line', enemy.pos, aimAt(enemy.pos, perceivedPos(target)), 0, fallbackZ),
    targetId: target.id,
    expectedDamage: 0,
  }
}
