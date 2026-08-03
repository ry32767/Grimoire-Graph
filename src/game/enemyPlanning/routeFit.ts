// 経路 → family（abs/arc/poly34/harmonic）フィット（修正仕様書 §10）。純粋関数。
// 敵位置を原点・ゴール方向を +x とする局所フレームで、経路の通過点を通る g(x) を作る。
// 回転方式 y=g(x) の g に線形項 b·x を含める：放物線のせん断は放物線、V字はV字のままなので、
// family の形状制約を守ったまま通過点を厳密に通せる（狙い角の近似補正が不要になる）。
// 式の自由度（次数・折れ枚数・積の因子）は敵の強さで決まる（FitComplexity・#70）。
import type { EnemyFamily, Vec2 } from '../types'
import { ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'
import { DEFAULT_FIT_COMPLEXITY, type FitComplexity, type WaveFactor } from './fitComplexity'

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
 * 折れ線を経路長に沿って等間隔へ取り直す（始点・終点は必ず残す）。
 * 分割数は経路長に比例させ、上限 24 点でフィットのコストを抑える。
 */
function resamplePolyline(pts: Vec2[], step = 2.5): Vec2[] {
  const seg: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  }
  const total = seg[seg.length - 1]
  if (total < 1e-6) return pts
  const n = Math.max(2, Math.min(24, Math.round(total / step)))
  const out: Vec2[] = []
  let j = 1
  for (let k = 0; k <= n; k++) {
    const d = (total * k) / n
    while (j < seg.length - 1 && seg[j] < d) j++
    const t = seg[j] - seg[j - 1] > 1e-9 ? (d - seg[j - 1]) / (seg[j] - seg[j - 1]) : 0
    out.push({
      x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t,
      y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t,
    })
  }
  out[out.length - 1] = pts[pts.length - 1]
  return out
}

/**
 * 式に描き出すときの数値整形。**有効桁**で丸める（固定小数で丸めない）。
 * 高次項の係数は 1e-8 のオーダーになることがあり、固定小数だと 0 に潰れて
 * 「評価した軌道」と「式として返した軌道」が食い違う（＝当たると判定したのに当たらない）。
 */
function num(n: number): string {
  return Number(n.toPrecision(8)).toString()
}

/** ワールド点 p を局所フレーム（origin 原点・angle 方向が +x）へ写す。 */
function toLocal(origin: Vec2, angle: number, p: Vec2): Vec2 {
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  const c = Math.cos(-angle)
  const s = Math.sin(-angle)
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

/** 局所 x がほぼ単調増加か（回転方式で表現できる経路か・§10.2）。 */
function isMostlyMonotone(xs: number[]): boolean {
  let maxX = -Infinity
  for (const x of xs) {
    if (x < maxX - RP.monotoneBacktrackEps) return false
    maxX = Math.max(maxX, x)
  }
  return true
}

/** 正規方程式をガウス消去で解く（n は基底の数）。特異なら null。 */
function solveLsq(rows: number[][], ys: number[], weights: number[]): number[] | null {
  const n = rows[0].length
  const A: number[][] = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  for (let r = 0; r < rows.length; r++) {
    const w = weights[r]
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += w * rows[r][i] * rows[r][j]
      A[i][n] += w * rows[r][i] * ys[r]
    }
  }
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-9) return null
    const tmp = A[col]
    A[col] = A[piv]
    A[piv] = tmp
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      for (let c2 = col; c2 <= n; c2++) A[r][c2] -= f * A[col][c2]
    }
  }
  return A.map((row, i) => row[n] / row[i])
}

/** リッジ（正則化）行を最小二乗の行列へ足す：係数 k を 0 へ引き戻す罰則を λ·(k+1)² で掛ける。 */
function pushRidgeRows(rows: number[][], ys: number[], ws: number[], n: number, lambda: number): void {
  for (let k = 0; k < n; k++) {
    const row = new Array<number>(n).fill(0)
    row[k] = 1
    rows.push(row)
    ys.push(0)
    ws.push(lambda * (k + 1) * (k + 1))
  }
}

/** 多項式（正規化基底 u=x/L）の g'(x)=0：3次までは解析解、それ以上は数値検出。 */
function polyTurnXs(coef: number[], L: number): number[] {
  const toX = (u: number): number[] => (u > 0.3 / L && u < 1 ? [u * L] : [])
  if (coef.length === 2) {
    const [c1, c2] = coef
    return Math.abs(c2) > 1e-12 ? toX(-c1 / (2 * c2)) : []
  }
  if (coef.length === 3) {
    const [c1, c2, c3] = coef
    if (Math.abs(c3) > 1e-12) {
      const disc = 4 * c2 * c2 - 12 * c3 * c1
      if (disc < 0) return []
      return [1, -1].flatMap((sign) => toX((-2 * c2 + sign * Math.sqrt(disc)) / (6 * c3)))
    }
    return Math.abs(c2) > 1e-12 ? toX(-c1 / (2 * c2)) : []
  }
  if (coef.length <= 1) return []
  return numericTurnXs((x) => coef.reduce((s, c, k) => s + c * Math.pow(x / L, k + 1), 0), L)
}

/** 多重サインに掛ける包絡（積の因子・#70）。exp×cos を掛け合わせても x=0,L では sin 側が 0。 */
function envelopeOf(wf: WaveFactor, L: number): (x: number) => number {
  if (wf.expA === 0 && wf.cosB === 0) return () => 1
  return (x) => Math.exp((wf.expA * x) / L) * (wf.cosB === 0 ? 1 : Math.cos((wf.cosB * Math.PI * x) / L))
}

/** 包絡の式表現（積なしのときは空文字＝従来どおり正弦級数だけを書く）。 */
function envelopeExpr(wf: WaveFactor, L: number): string {
  if (wf.expA === 0 && wf.cosB === 0) return ''
  const parts: string[] = []
  if (wf.expA !== 0) parts.push(`exp(${num(wf.expA / L)}*x)`)
  if (wf.cosB !== 0) parts.push(`cos(${num((wf.cosB * Math.PI) / L)}*x)`)
  return parts.join(' * ')
}

/**
 * 折れ点（|x−h| の h）の候補を経路から拾う（#70）。
 * 経路の局所極値（曲がり角）を「軸から遠い順」に最大 maxFolds 枚選び、x 昇順で返す。
 */
function kinkCandidates(inner: Vec2[], L: number, maxFolds: number): number[] {
  const ext: Vec2[] = []
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
 * 経路（ワールド折れ線）を families の各形へフィットする。単調性を満たさない経路は空を返す。
 * 経由点はフィットの入力であり保証ではない：呼び出し側が本番物理で必ず再検証する（§10.5）。
 * complexity（#70）で式の自由度が決まる：強い敵ほど高次・多重折れ・積の包絡まで試せる。
 */
export function fitRouteToFamilies(
  routePoints: Vec2[],
  origin: Vec2,
  families: readonly EnemyFamily[],
  complexity: FitComplexity = DEFAULT_FIT_COMPLEXITY,
): FitResult[] {
  if (routePoints.length < 2) return []
  const goal = routePoints[routePoints.length - 1]
  const angle = Math.atan2(goal.y - origin.y, goal.x - origin.x)
  // 経路長に沿って等間隔へ取り直す（#69）。A* ＋見通し線ショートカットが返す折れ線は
  // 角の付近に点が密集するので、そのまま最小二乗にかけると「角だけに合わせて全体を外す」
  // 過重みになる。等間隔化すると経路全体へ均等に寄る＝隙間を実際に通る解が得られやすい。
  const resampled = resamplePolyline(routePoints)
  const local = resampled.map((p) => toLocal(origin, angle, p))
  if (!isMostlyMonotone(local.map((p) => p.x))) return []
  const L = local[local.length - 1].x
  if (L < 2) return []
  // 内部経由点（始点0・終点L を除く）。x が近すぎる点は間引く
  const inner = local.slice(1, -1).filter((p, i, arr) => {
    if (p.x < 0.5 || p.x > L - 0.5) return false
    return i === 0 || p.x - arr[i - 1].x > 0.5
  })
  if (inner.length === 0) return []
  const out: FitResult[] = []
  // ゴール拘束（y(L)=0）は通過点より重く扱う＝狙いを外さない
  const rows = [...inner.map((p) => p.x), L]
  const ys = [...inner.map((p) => p.y), 0]
  const ws = [...inner.map(() => 1), 4]

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
  if (families.includes('abs')) {
    const kinks = complexity.absFolds > 1 ? kinkCandidates(inner, L, complexity.absFolds) : []
    if (kinks.length >= 2) {
      // 折れの重ね合わせ（#70）：g(x)=b·x + Σ sⱼ·|x−hⱼ|。折れ点を何枚も重ねると、
      // 柱の列を右へ左へ縫うような「何度も鋭く向きを変える折れ線」を1本の式で表せる。
      // 係数は通過点への最小二乗（ゴール y(L)=0 は重み4で優先）で決める。
      const basis = (x: number): number[] => [x, ...kinks.map((h) => Math.abs(x - h))]
      const coef = solveLsq(rows.map(basis), ys, ws)
      if (coef) {
        const [b, ...slopes] = coef
        out.push({
          family: 'abs',
          g: (x) => b * x + slopes.reduce((s, k, i) => s + k * Math.abs(x - kinks[i]), 0),
          expr: [
            `${num(b)}*x`,
            ...slopes.map((k, i) => `${num(k)}*abs(x - ${num(kinks[i])})`),
          ].join(' + '),
          angle,
          turnXs: kinks,
          goalX: L,
        })
      }
    } else {
      // 折れ1枚（低 LVL・#70）：折れ点 h＝最も軸から離れた経由点。y(h)=ym と y(L)=0 を厳密に解く
      const ext = inner.reduce((best, p) => (Math.abs(p.y) > Math.abs(best.y) ? p : best))
      const h = ext.x
      if (h > 0.5 && h < L - 0.5) {
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
    }
  }
  if (families.includes('poly34')) {
    // 敵の強さで許された次数を順にフィットする（#70：1次→2次→3〜5次→7次）。
    // 高次ほど経路に密着でき、柱の隙間のように「何度も向きを変える」道を1本の式で通せる（#69）。
    // 基底は u=x/L に正規化する：x をそのまま累乗すると 7 次で桁が飛んで正規方程式が解けない。
    for (const deg of complexity.polyDegrees) {
      if (deg < 1) continue
      if (deg > 3 && inner.length < deg - 1) continue
      const pRows = rows.map((x) => Array.from({ length: deg }, (_, k) => Math.pow(x / L, k + 1)))
      const pYs = [...ys]
      const pWs = [...ws]
      // 6次以上だけ平滑化（リッジ）を掛ける：正規方程式の特異化を防ぐための最小限の措置。
      // 5次までは掛けない（掛けると通過点への密着が落ち、実際に隙間を通せる解を取り逃がす）
      if (deg >= 6) pushRidgeRows(pRows, pYs, pWs, deg, RP.polyRidge)
      const coef = solveLsq(pRows, pYs, pWs)
      if (!coef) continue
      const g = (x: number): number => coef.reduce((s, c, k) => s + c * Math.pow(x / L, k + 1), 0)
      const expr = coef
        .map((c, k) => (k === 0 ? `${num(c)}*(x/${num(L)})` : `${num(c)}*(x/${num(L)})^${k + 1}`))
        .join(' + ')
      out.push({ family: 'poly34', g, expr, angle, turnXs: polyTurnXs(coef, L), goalX: L })
    }
  }
  if (families.includes('harmonic')) {
    // 多重サイン（#69）：フーリエ正弦級数 g(x)=Σ cₖ·sin(kπx/L)。
    // 基底が g(0)=g(L)=0 を**厳密に**満たすので、通過点をどれだけ攻めても狙点は必ず通る。
    // 係数 cₖ は通過点への最小二乗＋高周波リッジ（λk²）で決める＝細い隙間を縫いつつ暴れない。
    // さらに強い敵は包絡（exp・cos）を**掛け合わせた**形 g(x)=E(x)·Σ cₖ·sin(kπx/L) も試す（#70）。
    // E(x) は x=0,L で消えない一方 sin 側が 0 なので、積にしても狙点は必ず通る。
    const K = Math.min(complexity.harmonicTerms, inner.length)
    for (const wf of complexity.waveFactors) {
      if (K < 1) break
      const env = envelopeOf(wf, L)
      const basis = (x: number): number[] =>
        Array.from({ length: K }, (_, k) => env(x) * Math.sin(((k + 1) * Math.PI * x) / L))
      const hRows = inner.map((p) => basis(p.x))
      const hYs = inner.map((p) => p.y)
      const hWs = inner.map(() => 1)
      pushRidgeRows(hRows, hYs, hWs, K, RP.harmonicRidge)
      const coef = solveLsq(hRows, hYs, hWs)
      if (!coef) continue
      const g = (x: number): number =>
        env(x) * coef.reduce((s, c, k) => s + c * Math.sin(((k + 1) * Math.PI * x) / L), 0)
      const series = coef.map((c, k) => `${num(c)}*sin(${num(((k + 1) * Math.PI) / L)}*x)`).join(' + ')
      const ev = envelopeExpr(wf, L)
      const expr = ev === '' ? series : `${ev} * (${series})`
      out.push({ family: 'harmonic', g, expr, angle, turnXs: numericTurnXs(g, L), goalX: L })
    }
  }
  return out
}

/** g'(x)=0 の位置を数値で拾う（多重サインは解析解が無いので、傾きの符号反転を探す）。 */
function numericTurnXs(g: (x: number) => number, L: number, steps = 240): number[] {
  const out: number[] = []
  const h = L / steps
  let prev = g(h) - g(0)
  for (let i = 2; i <= steps; i++) {
    const d = g(i * h) - g((i - 1) * h)
    if ((prev > 0 && d < 0) || (prev < 0 && d > 0)) out.push((i - 0.5) * h)
    if (Math.abs(d) > 1e-12) prev = d
  }
  return out
}
