// 自由入力式の係数化（数値リテラル→スライダー）と、通過点への最小二乗フィット（射出魔法）。
// すべて純粋関数。React/Canvas に依存しない（#46）。
import type { Vec2 } from './types'
import { compileExpr, parametrizeConstants, substituteParams } from './mathEngine'

/** 自動検出した係数（スライダー1本ぶん）。 */
export interface DetectedParam {
  /** テンプレート内の記号（p0, p1, …） */
  key: string
  /** 表示名（c₁, c₂, …） */
  label: string
  /** 初期値（元の式の数値リテラル） */
  value: number
  min: number
  max: number
  step: number
}

/** 係数化された式（テンプレート＋検出係数＋変数名）。 */
export interface ParamSpec {
  /** 数値を p0,p1,… に置換したテンプレート式 */
  template: string
  params: DetectedParam[]
  varName: 'x' | 't'
}

/** スライダーの刻みを「キリのよい」値に丸める。 */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 0.01
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]
  for (const s of steps) if (raw <= s) return s
  return Math.ceil(raw)
}

/** 数値リテラル v を中心に、両側へ余裕を持たせたスライダー範囲を決める。 */
function rangeFor(v: number): { min: number; max: number; step: number } {
  const span = Math.max(Math.abs(v) * 2, 4)
  const min = Math.round((v - span) * 100) / 100
  const max = Math.round((v + span) * 100) / 100
  return { min, max, step: niceStep((max - min) / 200) }
}

/**
 * 式から係数（数値リテラル）を検出する。検出できなければ（不正式）null。
 * 数値が無い式（例 `x` のみ）は params 空で返す（テンプレート＝元式）。
 */
export function detectParams(expr: string, varName: 'x' | 't' = 'x'): ParamSpec | null {
  const pc = parametrizeConstants(expr)
  if (!pc) return null
  const params: DetectedParam[] = pc.originals.map((v, i) => {
    const r = rangeFor(v)
    return { key: `p${i}`, label: `c${i + 1}`, value: v, ...r }
  })
  return { template: pc.template, params, varName }
}

/** 係数値マップ（key→値）。未指定は初期値を使う。 */
export type ParamValues = Record<string, number>

/** spec の初期係数値マップ。 */
export function initialValues(spec: ParamSpec): ParamValues {
  const m: ParamValues = {}
  for (const p of spec.params) m[p.key] = p.value
  return m
}

/** 係数値を埋めて自由入力式の文字列にする（表示・評価用）。 */
export function renderExpr(spec: ParamSpec, values: ParamValues): string {
  if (spec.params.length === 0) return spec.template
  const arr = spec.params.map((p) => values[p.key] ?? p.value)
  return substituteParams(spec.template, arr) ?? spec.template
}

/**
 * テンプレート＋係数値から1変数関数 f(v) を作る。コンパイル不能なら null。
 * 評価が非有限／例外なら NaN（サンプリングで暴発扱い）。
 */
export function buildParamFn(
  spec: ParamSpec,
  values: ParamValues,
): ((v: number) => number) | null {
  const compiled = compileExpr(spec.template)
  if (!compiled) return null
  const scope: Record<string, number> = {}
  for (const p of spec.params) scope[p.key] = values[p.key] ?? p.value
  return (v: number): number => {
    scope[spec.varName] = v
    try {
      const r = compiled.evalWith(scope)
      return typeof r === 'number' && Number.isFinite(r) ? r : NaN
    } catch {
      return NaN
    }
  }
}

// ===== 通過点フィット（射出魔法・回転 y=g(x) のみ） =====

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * 各通過点を術者基準で **−angle 回転（逆変換）** した局所座標 (lx, ly)。
 *
 * 回転軌道は world = origin + Rot(angle)·(x, g(x)−g(0)) なので、点を逆回転すると軌道に乗る条件は
 * **g(lx) − g(0) = ly**。残差 r = g(lx) − g(0) − ly（局所フレームの縦ずれ＝狙い方向に直交するずれ）を
 * 最小化する。多項式など係数に線形な式ではこの残差が線形になり、最小二乗が安定して解ける。
 */
function localFrame(angle: number, origin: Vec2, points: Vec2[]): { lx: number; ly: number }[] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return points.map((p) => {
    const dx = p.x - origin.x
    const dy = p.y - origin.y
    return { lx: cos * dx + sin * dy, ly: -sin * dx + cos * dy }
  })
}

/** 係数ベクトルでの残差ベクトル（局所フレーム）。評価不能なら null。 */
function residualsOf(
  spec: ParamSpec,
  keys: string[],
  c: number[],
  frame: { lx: number; ly: number }[],
): number[] | null {
  const vals: ParamValues = {}
  for (let i = 0; i < keys.length; i++) vals[keys[i]] = c[i]
  const g = buildParamFn(spec, vals)
  if (!g) return null
  const g0 = g(0)
  if (!Number.isFinite(g0)) return null
  const r: number[] = []
  for (const f of frame) {
    const gy = g(f.lx) - g0
    if (!Number.isFinite(gy)) return null
    r.push(gy - f.ly)
  }
  return r
}

function sumSq(v: number[]): number {
  let s = 0
  for (const x of v) s += x * x
  return s
}

/** 連立一次方程式 A x = b を部分ピボット付きガウス消去で解く（n は小さい・係数 ≤ 8 個）。 */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r
    if (Math.abs(m[piv][col]) < 1e-12) return null
    ;[m[col], m[piv]] = [m[piv], m[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = m[r][col] / m[col][col]
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

/**
 * 通過したい点群に近づくよう係数を**最小二乗（レーベンバーグ・マーカート法）**で最適化する（射出魔法のみ）。
 * 局所フレーム残差の数値ヤコビアンを用い、多項式の桁違いな係数感度（x⁴ と x など）にも収束する。
 * 角度・術者位置は固定。係数はスライダー範囲でクランプ。改善できなければ元の値を返す（決定的・乱数なし）。
 */
export function fitToPoints(
  spec: ParamSpec,
  values: ParamValues,
  angle: number,
  origin: Vec2,
  points: Vec2[],
): ParamValues {
  const keys = spec.params.map((p) => p.key)
  const n = keys.length
  if (n === 0 || points.length === 0) return values
  const lo = spec.params.map((p) => p.min)
  const hi = spec.params.map((p) => p.max)
  const frame = localFrame(angle, origin, points)
  let c = spec.params.map((p) => clamp(values[p.key] ?? p.value, p.min, p.max))
  let r = residualsOf(spec, keys, c, frame)
  if (!r) return values
  let cost = sumSq(r)
  let lambda = 1e-3
  for (let iter = 0; iter < 80; iter++) {
    // 数値ヤコビアン J（m×n）を前進差分で作る
    const J: number[][] = r.map(() => new Array(n).fill(0))
    for (let k = 0; k < n; k++) {
      const h = 1e-6 * Math.max(1, Math.abs(c[k]))
      const cc = [...c]
      cc[k] += h
      const r2 = residualsOf(spec, keys, cc, frame)
      if (!r2) continue
      for (let i = 0; i < r.length; i++) J[i][k] = (r2[i] - r[i]) / h
    }
    // 正規方程式 (JᵀJ + λ·diag) δ = −Jᵀr
    const JtJ: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    const Jtr = new Array(n).fill(0)
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let s = 0
        for (let i = 0; i < r.length; i++) s += J[i][a] * J[i][b]
        JtJ[a][b] = s
      }
      let s = 0
      for (let i = 0; i < r.length; i++) s += J[i][a] * r[i]
      Jtr[a] = s
    }
    const damped = JtJ.map((row, a) => row.map((v, b) => (a === b ? v + lambda * (v + 1e-9) : v)))
    const delta = solveLinear(
      damped,
      Jtr.map((v) => -v),
    )
    if (!delta) {
      lambda *= 4
      if (lambda > 1e8) break
      continue
    }
    const cNew = c.map((v, k) => clamp(v + delta[k], lo[k], hi[k]))
    const rNew = residualsOf(spec, keys, cNew, frame)
    const costNew = rNew ? sumSq(rNew) : Infinity
    if (rNew && costNew < cost) {
      c = cNew
      r = rNew
      const improved = cost - costNew
      cost = costNew
      lambda = Math.max(1e-9, lambda * 0.5)
      if (improved < 1e-10) break // 収束
    } else {
      lambda *= 4
      if (lambda > 1e8) break // これ以上下がらない
    }
  }
  const out: ParamValues = {}
  for (let i = 0; i < n; i++) out[keys[i]] = c[i]
  return out
}
