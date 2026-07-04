// 経路 → family（abs/arc/poly34）フィット（修正仕様書 §10）。純粋関数。
// 敵位置を原点・ゴール方向を +x とする局所フレームで、経路の通過点を通る g(x) を作る。
// 回転方式 y=g(x) の g に線形項 b·x を含める：放物線のせん断は放物線、V字はV字のままなので、
// family の形状制約を守ったまま通過点を厳密に通せる（狙い角の近似補正が不要になる）。
import type { EnemyFamily, Vec2 } from '../types'
import { ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'

/** フィット結果：g と（呼び出し側が Trajectory に組む）狙い角・解析的な折れ点候補。 */
export interface FitResult {
  family: EnemyFamily
  g: (x: number) => number
  angle: number
  /** 局所フレームでの g'(x)=0（折れ点・極値点）の x（壁内折れ点検査の追加サンプル用） */
  turnXs: number[]
  /** 局所フレームでのゴール x（=経路終点までの距離） */
  goalX: number
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

/** 正規方程式（n≤4）をガウス消去で解く。特異なら null。 */
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

/**
 * 経路（ワールド折れ線）を families の各形へフィットする。単調性を満たさない経路は空を返す。
 * 経由点はフィットの入力であり保証ではない：呼び出し側が本番物理で必ず再検証する（§10.5）。
 */
export function fitRouteToFamilies(
  routePoints: Vec2[],
  origin: Vec2,
  families: readonly EnemyFamily[],
): FitResult[] {
  if (routePoints.length < 2) return []
  const goal = routePoints[routePoints.length - 1]
  const angle = Math.atan2(goal.y - origin.y, goal.x - origin.x)
  const local = routePoints.map((p) => toLocal(origin, angle, p))
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
        angle,
        turnXs: Number.isFinite(turn) && turn > 0.3 && turn < L ? [turn] : [],
        goalX: L,
      })
    }
  }
  if (families.includes('abs')) {
    // 折れ点 h＝最も軸から離れた経由点。y(h)=ym と y(L)=0 を厳密に解く
    const ext = inner.reduce((best, p) => (Math.abs(p.y) > Math.abs(best.y) ? p : best))
    const h = ext.x
    if (h > 0.5 && h < L - 0.5) {
      const s = (-ext.y * L) / (2 * h * (L - h))
      const b = ext.y / h + s
      out.push({ family: 'abs', g: (x) => b * x + s * Math.abs(x - h), angle, turnXs: [h], goalX: L })
    }
  }
  if (families.includes('poly34')) {
    const coef = solveLsq(rows.map((x) => [x, x * x, x * x * x]), ys, ws)
    if (coef) {
      const [b, c, d] = coef
      // g'(x)=b+2cx+3dx²=0 の根（壁内折れ点検査の追加サンプル・§9.3）
      const turnXs: number[] = []
      if (Math.abs(d) > 1e-12) {
        const disc = 4 * c * c - 12 * d * b
        if (disc >= 0) {
          for (const sign of [1, -1]) {
            const x = (-2 * c + sign * Math.sqrt(disc)) / (6 * d)
            if (x > 0.3 && x < L) turnXs.push(x)
          }
        }
      } else if (Math.abs(c) > 1e-12) {
        const x = -b / (2 * c)
        if (x > 0.3 && x < L) turnXs.push(x)
      }
      out.push({ family: 'poly34', g: (x) => b * x + c * x * x + d * x * x * x, angle, turnXs, goalX: L })
    }
  }
  return out
}
