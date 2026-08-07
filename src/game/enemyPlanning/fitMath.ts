// 経路フィットの下請け数学（最小二乗・正則化・整形・折れ点検出）。純粋関数。
// routeFit.ts（family ごとのフィット）から切り出したユーティリティで、ゲームの意味は持たない。
import type { Vec2 } from '../types'
import { ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'
import type { WaveFactor } from './fitComplexity'

/**
 * 折れ線を経路長に沿って等間隔へ取り直す（始点・終点は必ず残す）。
 * 分割数は経路長に比例させ、上限 24 点でフィットのコストを抑える。
 */
export function resamplePolyline(pts: Vec2[], step = 2.5): Vec2[] {
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
export function num(n: number): string {
  return Number(n.toPrecision(8)).toString()
}

/** ワールド点 p を局所フレーム（origin 原点・angle 方向が +x）へ写す。 */
export function toLocal(origin: Vec2, angle: number, p: Vec2): Vec2 {
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  const c = Math.cos(-angle)
  const s = Math.sin(-angle)
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

/** 局所フレームの点 p をワールドへ戻す（toLocal の逆写像）。 */
export function toWorld(origin: Vec2, angle: number, p: Vec2): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: origin.x + p.x * c - p.y * s, y: origin.y + p.x * s + p.y * c }
}

/** 局所 x がほぼ単調増加か（回転方式 y=g(x) で表現できる経路か・§10.2）。 */
export function isMostlyMonotoneXs(xs: number[]): boolean {
  let maxX = -Infinity
  for (const x of xs) {
    if (x < maxX - RP.monotoneBacktrackEps) return false
    maxX = Math.max(maxX, x)
  }
  return true
}

/** 正規方程式をガウス消去で解く（n は基底の数）。特異なら null。 */
export function solveLsq(rows: number[][], ys: number[], weights: number[]): number[] | null {
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

/**
 * リッジ（正則化）行を最小二乗の行列へ足す：係数 k を 0 へ引き戻す罰則を λ·(k+1)² で掛ける。
 * λ が小さいほど**係数の可動域が広い**（#76）。λ=0 なら罰則なし＝係数は自由に振り切れる。
 */
export function pushRidgeRows(rows: number[][], ys: number[], ws: number[], n: number, lambda: number): void {
  if (lambda <= 0) return
  for (let k = 0; k < n; k++) {
    const row = new Array<number>(n).fill(0)
    row[k] = 1
    rows.push(row)
    ys.push(0)
    ws.push(lambda * (k + 1) * (k + 1))
  }
}

/** 多項式（正規化基底 u=x/L）の g'(x)=0：3次までは解析解、それ以上は数値検出。 */
export function polyTurnXs(coef: number[], L: number): number[] {
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

/** g'(x)=0 の位置を数値で拾う（多重サインは解析解が無いので、傾きの符号反転を探す）。 */
export function numericTurnXs(g: (x: number) => number, L: number, steps = 240): number[] {
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

/** 多重サインに掛ける包絡（積の因子・#70）。exp×cos を掛け合わせても x=0,L では sin 側が 0。 */
export function envelopeOf(wf: WaveFactor, L: number): (x: number) => number {
  if (wf.expA === 0 && wf.cosB === 0) return () => 1
  return (x) => Math.exp((wf.expA * x) / L) * (wf.cosB === 0 ? 1 : Math.cos((wf.cosB * Math.PI * x) / L))
}

/** 包絡の式表現（積なしのときは空文字＝従来どおり正弦級数だけを書く）。 */
export function envelopeExpr(wf: WaveFactor, L: number): string {
  if (wf.expA === 0 && wf.cosB === 0) return ''
  const parts: string[] = []
  if (wf.expA !== 0) parts.push(`exp(${num(wf.expA / L)}*x)`)
  if (wf.cosB !== 0) parts.push(`cos(${num((wf.cosB * Math.PI) / L)}*x)`)
  return parts.join(' * ')
}
