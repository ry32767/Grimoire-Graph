// 自由入力式の係数化（数値リテラル→スライダー）と、通過点への最小二乗フィット（射出魔法）。
// すべて純粋関数。React/Canvas に依存しない（#46）。
import type { Vec2 } from './types'
import { compileExpr, parametrizeConstants, substituteParams } from './mathEngine'
import { FIELD } from '../data/constants'

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

function costOf(spec: ParamSpec, keys: string[], c: number[], frame: { lx: number; ly: number }[]): number {
  const r = residualsOf(spec, keys, c, frame)
  return r ? sumSq(r) : Infinity
}

/**
 * 発射経路 x∈[0, maxLx+余白] に「極（発散）」があるか（#50）。1/x 型で極が前方にあると弾は
 * そこで暴発してしまうため、そういう係数はフィットで避ける。非有限、または隣接サンプルで
 * 符号反転かつ両側とも大きい（±∞ を跨いだ）点を極とみなす（coords の判定と同趣旨）。
 */
function pathHasPole(spec: ParamSpec, keys: string[], c: number[], maxLx: number, N = 96): boolean {
  const vals: ParamValues = {}
  for (let i = 0; i < keys.length; i++) vals[keys[i]] = c[i]
  const g = buildParamFn(spec, vals)
  if (!g) return true
  const hi = maxLx + 6
  let prev = g(0)
  if (!Number.isFinite(prev)) return true
  for (let k = 1; k <= N; k++) {
    const v = g((hi * k) / N)
    if (!Number.isFinite(v)) return true
    if (Math.sign(v) !== Math.sign(prev) && Math.min(Math.abs(v), Math.abs(prev)) > FIELD.rField) {
      return true
    }
    prev = v
  }
  return false
}

/**
 * 滑らかさの正則化残差（#50）：局所 x=0..maxLx 上の曲率（2階差分）を小さく保つ。
 * 「点は通るが激しく振動する」高周波な過適合を抑え、なめらかな解へ寄せる。
 */
function smoothResiduals(spec: ParamSpec, keys: string[], c: number[], maxLx: number, w: number): number[] | null {
  if (w <= 0) return []
  const vals: ParamValues = {}
  for (let i = 0; i < keys.length; i++) vals[keys[i]] = c[i]
  const g = buildParamFn(spec, vals)
  if (!g) return null
  const N = 16
  const h = maxLx / N
  const out: number[] = []
  for (let k = 1; k < N; k++) {
    const x = h * k
    const v = g(x - h) - 2 * g(x) + g(x + h)
    if (!Number.isFinite(v)) return null
    out.push(w * v)
  }
  return out
}

/**
 * 1回ぶんのレーベンバーグ・マーカート法。初期値 c0 から「データ残差＋滑らかさ正則化」を最小化し、
 * 係数ベクトルを返す（データ適合のコストは呼び側で別途評価）。数値ヤコビアン＋減衰付き正規方程式（決定的）。
 */
function lmRun(
  spec: ParamSpec,
  keys: string[],
  c0: number[],
  lo: number[],
  hi: number[],
  frame: { lx: number; ly: number }[],
  maxLx: number,
  smoothW: number,
): { c: number[] } {
  const n = keys.length
  const resid = (cc: number[]): number[] | null => {
    // 前方に極がある係数は弾が暴発する。LM が極へ踏み込まないよう、ここで無効化して避ける
    if (pathHasPole(spec, keys, cc, maxLx, 36)) return null
    const rd = residualsOf(spec, keys, cc, frame)
    if (!rd) return null
    const rs = smoothResiduals(spec, keys, cc, maxLx, smoothW)
    if (!rs) return null
    return rd.concat(rs)
  }
  let c = c0.map((v, k) => clamp(v, lo[k], hi[k]))
  let r = resid(c)
  if (!r) return { c }
  let cost = sumSq(r)
  let lambda = 1e-3
  for (let iter = 0; iter < 80; iter++) {
    const J: number[][] = r.map(() => new Array(n).fill(0))
    for (let k = 0; k < n; k++) {
      const h = 1e-6 * Math.max(1, Math.abs(c[k]))
      const cc = [...c]
      cc[k] += h
      const r2 = resid(cc)
      if (!r2) continue
      for (let i = 0; i < r.length; i++) J[i][k] = (r2[i] - r[i]) / h
    }
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
    const rNew = resid(cNew)
    const costNew = rNew ? sumSq(rNew) : Infinity
    if (rNew && costNew < cost) {
      c = cNew
      r = rNew
      const improved = cost - costNew
      cost = costNew
      lambda = Math.max(1e-9, lambda * 0.5)
      if (improved < 1e-12) break
    } else {
      lambda *= 4
      if (lambda > 1e8) break
    }
  }
  return { c }
}

/** 係数 c での曲線の「うねり量」（局所 x=0..maxLx の全変動 Σ|Δg|）。小さいほど滑らか。 */
function roughnessOf(spec: ParamSpec, keys: string[], c: number[], maxLx: number): number {
  const vals: ParamValues = {}
  for (let i = 0; i < keys.length; i++) vals[keys[i]] = c[i]
  const g = buildParamFn(spec, vals)
  if (!g) return Infinity
  const N = 48
  let prev = g(0)
  if (!Number.isFinite(prev)) return Infinity
  let tv = 0
  for (let k = 1; k <= N; k++) {
    const v = g((maxLx * k) / N)
    if (!Number.isFinite(v)) return Infinity
    tv += Math.abs(v - prev)
    prev = v
  }
  return tv
}

/**
 * 多スタート LM。現在値に加え各係数をレンジ全体に振った初期値から最適化し、
 * **点に十分近い解の中で最も滑らかな（うねりの少ない）もの**を選ぶ（#50）。
 * これで sin の周波数や高次多項式が「点は通るが激しく振動する」過適合を避けつつ、
 * sin・指数・1/x など非凸な関数にも対応する（決定的・乱数なし）。
 */
function multiStartLM(spec: ParamSpec, current: ParamValues, frame: { lx: number; ly: number }[]): number[] {
  const keys = spec.params.map((p) => p.key)
  const lo = spec.params.map((p) => p.min)
  const hi = spec.params.map((p) => p.max)
  const cur = spec.params.map((p) => clamp(current[p.key] ?? p.value, p.min, p.max))
  const K = 12
  const starts: number[][] = [cur]
  for (let idx = 0; idx < keys.length; idx++) {
    for (let k = 0; k < K; k++) {
      const v = lo[idx] + ((hi[idx] - lo[idx]) * (k + 0.5)) / K
      const s = [...cur]
      s[idx] = v
      starts.push(s)
    }
  }
  const maxLx = Math.max(1, ...frame.map((f) => f.lx))
  const smoothW = 0.04 // 滑らかさ正則化の重み（データ適合を主、振動を従に）
  // 各スタートを LM（データ＋滑らかさ）で最適化し、選別はデータ適合コストで行う。
  // ただし前方に極（発散）がある係数は弾が暴発するので除外（cost=∞）。
  const results = starts.map((st) => {
    const c = lmRun(spec, keys, st, lo, hi, frame, maxLx, smoothW).c
    const cost = pathHasPole(spec, keys, c, maxLx) ? Infinity : costOf(spec, keys, c, frame)
    return { c, cost }
  })
  let bestCost = Infinity
  for (const r of results) if (r.cost < bestCost) bestCost = r.cost
  if (!Number.isFinite(bestCost)) return cur
  // 「平均ずれ ~0.8 ユニット」までを十分近いと見なし、その中で最も滑らかな解を採る
  const tol = 0.8 * 0.8 * frame.length
  let best = cur
  let bestRough = Infinity
  for (const r of results) {
    if (!Number.isFinite(r.cost) || r.cost > bestCost + tol) continue
    const rough = roughnessOf(spec, keys, r.c, maxLx)
    if (rough < bestRough - 1e-9) {
      bestRough = rough
      best = r.c
    }
  }
  return best
}

const norm2pi = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

/** 角度 ang での「点を打った順＝発射方向に沿って単調」になっていない度合い（小さいほど順序通り）。 */
function orderViolation(origin: Vec2, points: Vec2[], ang: number): number {
  const cos = Math.cos(ang)
  const sin = Math.sin(ang)
  const lx = points.map((p) => cos * (p.x - origin.x) + sin * (p.y - origin.y))
  let v = 0
  for (let i = 1; i < lx.length; i++) v += Math.max(0, lx[i - 1] - lx[i]) // 順番に増えてほしい
  for (const x of lx) if (x < 0) v += -x * 0.5 // 術者の後ろ（届かない）も避ける
  return v
}

/**
 * 打った順に通すための発射方向 θ を選ぶ（#50）。現在の向きで既に順序通りならそれを使い、
 * そうでなければ全周を粗く探索して「順序の崩れ」が最小の向きを採る（同点は点の広がりが大きい方）。
 */
function chooseAngle(origin: Vec2, points: Vec2[], current: number): number {
  if (points.length < 2) {
    const p = points[0]
    return norm2pi(Math.atan2(p.y - origin.y, p.x - origin.x))
  }
  if (orderViolation(origin, points, current) < 1e-6) return current
  let bestAng = current
  let bestV = Infinity
  let bestSpread = -Infinity
  const STEPS = 720
  for (let i = 0; i < STEPS; i++) {
    const ang = (i / STEPS) * 2 * Math.PI
    const v = orderViolation(origin, points, ang)
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const lx = points.map((p) => cos * (p.x - origin.x) + sin * (p.y - origin.y))
    const spread = Math.max(...lx) - Math.min(...lx)
    if (v < bestV - 1e-9 || (Math.abs(v - bestV) < 1e-9 && spread > bestSpread)) {
      bestV = v
      bestSpread = spread
      bestAng = ang
    }
  }
  return bestAng
}

/** フィット結果：係数値と、打った順に通すために選んだ発射方向 θ（#46/#50）。 */
export interface FitResult {
  values: ParamValues
  angle: number
}

/**
 * 通過したい点群に「打った順に」近づくよう、発射方向 θ と係数を最適化する（射出魔法のみ・#46/#50）。
 * 多スタート LM で sin・指数・1/x など一般の関数にも対応。角度・術者位置のうち θ は順序を満たすよう選び直す。
 * 改善できなければ元の値を返す（決定的・乱数なし）。
 */
export function fitToPoints(
  spec: ParamSpec,
  values: ParamValues,
  angle: number,
  origin: Vec2,
  points: Vec2[],
): FitResult {
  const keys = spec.params.map((p) => p.key)
  if (keys.length === 0 || points.length === 0) return { values, angle }
  const fitAngle = chooseAngle(origin, points, angle)
  const frame = localFrame(fitAngle, origin, points)
  const best = multiStartLM(spec, values, frame)
  const out: ParamValues = {}
  for (let i = 0; i < keys.length; i++) out[keys[i]] = best[i]
  return { values: out, angle: fitAngle }
}
