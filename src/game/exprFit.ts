// 自由入力式の係数化（数値リテラル→スライダー）と、通過点への最小二乗フィット（射出魔法）。
// すべて純粋関数。React/Canvas に依存しない（#46）。
import type { Trajectory, Vec2 } from './types'
import { compileExpr, parametrizeConstants, substituteParams } from './mathEngine'
import { sampleTrajectory, validFinitePrefix } from './coords'

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

/** 点 p と線分 ab の距離の二乗。 */
function distSqToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const denom = abx * abx + aby * aby
  const t = denom > 0 ? clamp((apx * abx + apy * aby) / denom, 0, 1) : 0
  const dx = a.x + abx * t - p.x
  const dy = a.y + aby * t - p.y
  return dx * dx + dy * dy
}

/** 点 p と折れ線 poly の最短距離の二乗。 */
function minDistSq(p: Vec2, poly: Vec2[]): number {
  let best = Infinity
  for (let i = 1; i < poly.length; i++) {
    const d = distSqToSegment(p, poly[i - 1], poly[i])
    if (d < best) best = d
  }
  return best
}

/** 与えた係数値での「点群と軌道の距離二乗和」。係数が暴発するなら Infinity。 */
function objectiveAt(
  spec: ParamSpec,
  values: ParamValues,
  angle: number,
  origin: Vec2,
  points: Vec2[],
): number {
  const g = buildParamFn(spec, values)
  if (!g) return Infinity
  const traj: Trajectory = { mode: 'rotate', g, angle, origin }
  const poly = validFinitePrefix(sampleTrajectory(traj)).map((s) => s.pos)
  if (poly.length < 2) return Infinity
  let sum = 0
  for (const pt of points) sum += minDistSq(pt, poly)
  return sum
}

/**
 * 通過したい点群に近づくよう係数を最小二乗（距離二乗和）で最適化する（射出魔法のみ）。
 * パターン探索（Hooke–Jeeves）で決定的に解く（乱数なし）。角度・原点は固定。
 * 改善できなければ元の値を返す。
 */
export function fitToPoints(
  spec: ParamSpec,
  values: ParamValues,
  angle: number,
  origin: Vec2,
  points: Vec2[],
): ParamValues {
  if (spec.params.length === 0 || points.length === 0) return values
  const bounds: Record<string, [number, number]> = {}
  const steps: Record<string, number> = {}
  let best: ParamValues = {}
  for (const p of spec.params) {
    best[p.key] = clamp(values[p.key] ?? p.value, p.min, p.max)
    bounds[p.key] = [p.min, p.max]
    steps[p.key] = (p.max - p.min) / 8
  }
  let bestObj = objectiveAt(spec, best, angle, origin, points)
  for (let iter = 0; iter < 240; iter++) {
    let improved = false
    for (const p of spec.params) {
      const k = p.key
      for (const dir of [1, -1]) {
        const trial: ParamValues = { ...best, [k]: clamp(best[k] + dir * steps[k], bounds[k][0], bounds[k][1]) }
        const o = objectiveAt(spec, trial, angle, origin, points)
        if (o < bestObj - 1e-9) {
          best = trial
          bestObj = o
          improved = true
        }
      }
    }
    if (!improved) {
      let allSmall = true
      for (const p of spec.params) {
        steps[p.key] *= 0.5
        if (steps[p.key] > 1e-4) allSmall = false
      }
      if (allSmall) break
    }
  }
  return best
}
