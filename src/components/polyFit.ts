// 作図台（点入力 → 多項式フィット）の純粋ヘルパー（DC プロトタイプ v3 の _polyFit / _fmtPoly /
// _coefs / _setCoef）。式の文字列処理と最小二乗だけ。エンジンには依存しない。
import type { Vec2 } from '../game/types'

/** 最小二乗で deg 次の多項式係数（低次→高次）を求める。解けなければ null。 */
export function polyFit(points: Vec2[], deg: number): number[] | null {
  const n = Math.min(deg, points.length - 1) + 1
  if (n < 1) return null
  const A: number[][] = []
  const B: number[] = []
  for (let i = 0; i < n; i++) {
    A[i] = []
    let b = 0
    for (let j = 0; j < n; j++) {
      let s = 0
      for (const p of points) s += Math.pow(p.x, i + j)
      A[i][j] = s
    }
    for (const p of points) b += p.y * Math.pow(p.x, i)
    B[i] = b
  }
  // ガウス・ジョルダン（部分ピボット）
  for (let c = 0; c < n; c++) {
    let pv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r
    if (Math.abs(A[pv][c]) < 1e-12) return null
    ;[A[c], A[pv]] = [A[pv], A[c]]
    ;[B[c], B[pv]] = [B[pv], B[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      B[r] -= f * B[c]
    }
  }
  return B.map((b, i) => b / A[i][i])
}

/** 係数（低次→高次）を mathjs が読める式へ整形する。 */
export function formatPoly(coeffs: number[]): string {
  let s = ''
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const v = coeffs[i]
    if (Math.abs(v) < 5e-5) continue
    let num = Math.abs(v).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
    if (num === '') num = '0'
    const term = i === 0 ? num : `${num === '1' ? '' : `${num}*`}${i === 1 ? 'x' : `x^${i}`}`
    s += (v < 0 ? (s ? ' - ' : '-') : s ? ' + ' : '') + term
  }
  return s || '0'
}
