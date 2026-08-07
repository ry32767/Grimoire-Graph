// 経路 → family（abs/arc/poly34/harmonic）フィット（修正仕様書 §10）。純粋関数。
// 敵位置を原点・ゴール方向を +x とする局所フレームで、経路の通過点を通る g(x) を作る。
// 回転方式 y=g(x) の g に線形項 b·x を含める：放物線のせん断は放物線、V字はV字のままなので、
// family の形状制約を守ったまま通過点を厳密に通せる（狙い角の近似補正が不要になる）。
// 式の自由度（次数・折れ枚数・積の因子・**係数の可動域**）は敵の強さで決まる（FitComplexity・#70/#76）。
import type { EnemyFamily, Vec2 } from '../types'
import { ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'
import { DEFAULT_FIT_COMPLEXITY, type FitComplexity } from './fitComplexity'
import {
  envelopeExpr,
  envelopeOf,
  isMostlyMonotoneXs,
  num,
  numericTurnXs,
  polyTurnXs,
  pushRidgeRows,
  resamplePolyline,
  solveLsq,
  toLocal,
} from './fitMath'

/** フィットの通過点（局所フレーム・w＝最小二乗の重み）。 */
export interface FitPoint {
  x: number
  y: number
  w: number
}

/** 局所フレームへ写した経路（原点＝敵位置・+x＝ゴール方向）。 */
export interface LocalRoute {
  /** ワールドでの +x 軸の向き */
  angle: number
  /** ゴールまでの局所 x */
  L: number
  /** 内部通過点（始点・終点を除く。x 昇順） */
  inner: FitPoint[]
}

/** フィット結果：g と（呼び出し側が Trajectory に組む）狙い角・解析的な折れ点候補。 */
export interface FitResult {
  family: EnemyFamily
  g: (x: number) => number
  /**
   * g と同じ形の mathjs 式（局所 x の式・#69）。味方の「おすすめ術式」が自由入力欄へ
   * そのまま転記できるようにする（軌道は sampleTrajectory 側で g(0) を引いて平行移動される
   * ため、式は g そのものを書けばよい）。
   */
  expr: string
  angle: number
  /** 局所フレームでの g'(x)=0（折れ点・極値点）の x（壁内折れ点検査の追加サンプル用） */
  turnXs: number[]
  /** 局所フレームでのゴール x（=経路終点までの距離） */
  goalX: number
}

/**
 * 折れ点（|x−h| の h）の候補を経路から拾う（#70）。
 * 経路の局所極値（曲がり角）を「軸から遠い順」に最大 maxFolds 枚選び、x 昇順で返す。
 */
function kinkCandidates(inner: FitPoint[], L: number, maxFolds: number): number[] {
  const ext: FitPoint[] = []
  for (let i = 0; i < inner.length; i++) {
    // 両端は y=0（始点・ゴール）として扱う＝経路の端の曲がりも極値として拾える
    const prev = i > 0 ? inner[i - 1].y : 0
    const next = i < inner.length - 1 ? inner[i + 1].y : 0
    if ((inner[i].y - prev) * (next - inner[i].y) <= 0) ext.push(inner[i])
  }
  const pool = ext.length > 0 ? ext : inner
  return pool
    .slice()
    .sort((a, b) => Math.abs(b.y) - Math.abs(a.y))
    .slice(0, Math.max(1, maxFolds))
    .map((p) => p.x)
    .filter((h) => h > 0.5 && h < L - 0.5)
    .sort((a, b) => a - b)
}

/**
 * ワールドの折れ線を局所フレームへ写す（#69）。A* ＋見通し線ショートカットが返す折れ線は
 * 角の付近に点が密集するので、経路長で等間隔へ取り直してから写す（角だけに合わせて全体を外す
 * 過重みを避ける）。回転方式で表せない（局所 x が後退する）経路・短すぎる経路は null。
 */
export function toLocalRoute(routePoints: Vec2[], origin: Vec2): LocalRoute | null {
  if (routePoints.length < 2) return null
  const goal = routePoints[routePoints.length - 1]
  const angle = Math.atan2(goal.y - origin.y, goal.x - origin.x)
  const local = resamplePolyline(routePoints).map((p) => toLocal(origin, angle, p))
  if (!isMostlyMonotoneXs(local.map((p) => p.x))) return null
  const L = local[local.length - 1].x
  if (L < 2) return null
  // 内部経由点（始点0・終点L を除く）。x が近すぎる点は間引く
  const inner = local
    .slice(1, -1)
    .filter((p, i, arr) => {
      if (p.x < 0.5 || p.x > L - 0.5) return false
      return i === 0 || p.x - arr[i - 1].x > 0.5
    })
    .map((p) => ({ x: p.x, y: p.y, w: 1 }))
  if (inner.length === 0) return null
  return { angle, L, inner }
}

/**
 * 局所フレームの通過点を families の各形へフィットする（§10）。
 * 経由点はフィットの入力であり保証ではない：呼び出し側が本番物理で必ず再検証する（§10.5）。
 * complexity（#70/#76）で式の自由度が決まる：強い敵ほど高次・多重の折れ・積の包絡、そして
 * **より大きな係数**（ridgeScales）まで合わせられる。
 */
export function fitLocalRoute(
  route: LocalRoute,
  families: readonly EnemyFamily[],
  complexity: FitComplexity = DEFAULT_FIT_COMPLEXITY,
): FitResult[] {
  const { angle, L, inner } = route
  if (inner.length === 0) return []
  const out: FitResult[] = []
  // ゴール拘束（y(L)=0）は通過点より重く扱う＝狙いを外さない
  const rows = [...inner.map((p) => p.x), L]
  const ys = [...inner.map((p) => p.y), 0]
  const ws = [...inner.map((p) => p.w), 4]
  const scales = complexity.ridgeScales.length > 0 ? complexity.ridgeScales : [1]

  if (families.includes('arc')) {
    const coef = solveLsq(rows.map((x) => [x, x * x]), ys, ws)
    if (coef) {
      const [b, a] = coef
      const turn = Math.abs(a) > 1e-9 ? -b / (2 * a) : NaN
      out.push({
        family: 'arc',
        g: (x) => b * x + a * x * x,
        expr: `${num(b)}*x + ${num(a)}*x^2`,
        angle,
        turnXs: Number.isFinite(turn) && turn > 0.3 && turn < L ? [turn] : [],
        goalX: L,
      })
    }
  }
  if (families.includes('abs')) fitAbs(out, inner, rows, ys, ws, L, angle, complexity)
  if (families.includes('poly34')) fitPoly(out, inner.length, rows, ys, ws, L, angle, complexity, scales)
  if (families.includes('harmonic')) fitHarmonic(out, inner, L, angle, complexity, scales)
  return out
}

/** 折れ（abs）：折れ点を重ねた g(x)=b·x + Σ sⱼ·|x−hⱼ|（低 LVL は 1 枚の V 字を厳密解で）。 */
function fitAbs(
  out: FitResult[],
  inner: FitPoint[],
  rows: number[],
  ys: number[],
  ws: number[],
  L: number,
  angle: number,
  cx: FitComplexity,
): void {
  const kinks = cx.absFolds > 1 ? kinkCandidates(inner, L, cx.absFolds) : []
  if (kinks.length >= 2) {
    // 折れの重ね合わせ（#70）：折れ点を何枚も重ねると、柱の列を右へ左へ縫うような
    // 「何度も鋭く向きを変える折れ線」を1本の式で表せる。係数は通過点への最小二乗で決める。
    const basis = (x: number): number[] => [x, ...kinks.map((h) => Math.abs(x - h))]
    const coef = solveLsq(rows.map(basis), ys, ws)
    if (!coef) return
    const [b, ...slopes] = coef
    out.push({
      family: 'abs',
      g: (x) => b * x + slopes.reduce((s, k, i) => s + k * Math.abs(x - kinks[i]), 0),
      expr: [`${num(b)}*x`, ...slopes.map((k, i) => `${num(k)}*abs(x - ${num(kinks[i])})`)].join(' + '),
      angle,
      turnXs: kinks,
      goalX: L,
    })
    return
  }
  // 折れ1枚（低 LVL・#70）：折れ点 h＝最も軸から離れた経由点。y(h)=ym と y(L)=0 を厳密に解く
  const ext = inner.reduce((best, p) => (Math.abs(p.y) > Math.abs(best.y) ? p : best))
  const h = ext.x
  if (h <= 0.5 || h >= L - 0.5) return
  const s = (-ext.y * L) / (2 * h * (L - h))
  const b = ext.y / h + s
  out.push({
    family: 'abs',
    g: (x) => b * x + s * Math.abs(x - h),
    expr: `${num(b)}*x + ${num(s)}*abs(x - ${num(h)})`,
    angle,
    turnXs: [h],
    goalX: L,
  })
}

/**
 * 多項式（正規化基底 u=x/L）：敵の強さで許された次数を順にフィットする（#70）。
 * 高次ほど経路に密着でき、柱の隙間のように「何度も向きを変える」道を1本の式で通せる（#69）。
 * 6次以上だけ弱い正則化を掛ける（正規方程式の特異化を防ぐため）。その強さ＝係数の可動域も
 * 敵の強さで決まる（ridgeScales・#76）＝強い敵ほど大きな係数を振り切って使える。
 */
function fitPoly(
  out: FitResult[],
  innerCount: number,
  rows: number[],
  ys: number[],
  ws: number[],
  L: number,
  angle: number,
  cx: FitComplexity,
  scales: readonly number[],
): void {
  for (const deg of cx.polyDegrees) {
    if (deg < 1) continue
    if (deg > 3 && innerCount < deg - 1) continue
    // リッジを使わない次数（≤5）は係数の可動域が元から無制限＝倍率違いは同じ解になるので1回だけ
    for (const scale of deg >= 6 ? scales : [1]) {
      const pRows = rows.map((x) => Array.from({ length: deg }, (_, k) => Math.pow(x / L, k + 1)))
      const pYs = [...ys]
      const pWs = [...ws]
      if (deg >= 6) pushRidgeRows(pRows, pYs, pWs, deg, RP.polyRidge * scale)
      const coef = solveLsq(pRows, pYs, pWs)
      if (!coef) continue
      const g = (x: number): number => coef.reduce((s, c, k) => s + c * Math.pow(x / L, k + 1), 0)
      const expr = coef
        .map((c, k) => (k === 0 ? `${num(c)}*(x/${num(L)})` : `${num(c)}*(x/${num(L)})^${k + 1}`))
        .join(' + ')
      out.push({ family: 'poly34', g, expr, angle, turnXs: polyTurnXs(coef, L), goalX: L })
    }
  }
}

/**
 * 多重サイン（#69）：フーリエ正弦級数 g(x)=Σ cₖ·sin(kπx/L)。
 * 基底が g(0)=g(L)=0 を**厳密に**満たすので、通過点をどれだけ攻めても狙点は必ず通る。
 * 係数 cₖ は通過点への最小二乗＋高周波リッジ（λk²）で決める。λ に掛ける倍率（ridgeScales・#76）を
 * 敵の強さで変えることで、なめらかな解と**係数を振り切って隙間へ密着した解**の両方を候補にできる。
 * さらに強い敵は包絡（exp・cos）を**掛け合わせた**形 E(x)·Σ cₖ·sin(kπx/L) も試す（#70）。
 */
function fitHarmonic(
  out: FitResult[],
  inner: FitPoint[],
  L: number,
  angle: number,
  cx: FitComplexity,
  scales: readonly number[],
): void {
  const K = Math.min(cx.harmonicTerms, inner.length)
  if (K < 1) return
  for (const wf of cx.waveFactors) {
    const env = envelopeOf(wf, L)
    const basis = (x: number): number[] =>
      Array.from({ length: K }, (_, k) => env(x) * Math.sin(((k + 1) * Math.PI * x) / L))
    for (const scale of scales) {
      const hRows = inner.map((p) => basis(p.x))
      const hYs = inner.map((p) => p.y)
      const hWs = inner.map((p) => p.w)
      pushRidgeRows(hRows, hYs, hWs, K, RP.harmonicRidge * scale)
      const coef = solveLsq(hRows, hYs, hWs)
      if (!coef) continue
      const g = (x: number): number =>
        env(x) * coef.reduce((s, c, k) => s + c * Math.sin(((k + 1) * Math.PI * x) / L), 0)
      const series = coef.map((c, k) => `${num(c)}*sin(${num(((k + 1) * Math.PI) / L)}*x)`).join(' + ')
      const ev = envelopeExpr(wf, L)
      out.push({
        family: 'harmonic',
        g,
        expr: ev === '' ? series : `${ev} * (${series})`,
        angle,
        turnXs: numericTurnXs(g, L),
        goalX: L,
      })
    }
  }
}

/**
 * 経路（ワールド折れ線）を families の各形へフィットする。単調性を満たさない経路は空を返す。
 * 局所フレームへの写像＋フィットの薄いラッパ（再フィット＝制約投影は routeRepair.ts が行う）。
 */
export function fitRouteToFamilies(
  routePoints: Vec2[],
  origin: Vec2,
  families: readonly EnemyFamily[],
  complexity: FitComplexity = DEFAULT_FIT_COMPLEXITY,
): FitResult[] {
  const local = toLocalRoute(routePoints, origin)
  return local ? fitLocalRoute(local, families, complexity) : []
}
