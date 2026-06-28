// 関数カタログ（§3.10 A/B）・自由入力式の安全評価（mathjs）・サンプル出力（機能1・2）。
import { compileExpr, varsAllowed } from './mathEngine'
import type { Trajectory, Vec2, ZField } from './types'

/** 係数スライダーの定義 */
export interface Coefficient {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

type CoeffMap = Record<string, number>

interface PresetBase {
  id: string
  name: string
  formula: string
  /** チュートリアル／関数解説でそのまま提示する説明文（§3.10） */
  description: string
  coeffs: Coefficient[]
  /** 自由入力で使う関数名／式の手がかり（例: sin, exp, abs） */
  freeName: string
}

/** 回転方式プリセット（直交 y=g(x)） */
export interface RotatePreset extends PresetBase {
  category: 'rotate'
  buildG: (c: CoeffMap) => (x: number) => number
  /** 現在の係数を mathjs で入力できる式に変換（自由入力へコピー用） */
  toExpr: (c: CoeffMap) => string
}

/** 極座標方式プリセット（r=f(θ)） */
export interface PolarPreset extends PresetBase {
  category: 'polar'
  buildF: (c: CoeffMap) => (theta: number) => number
  /** 現在の係数を mathjs 式に変換（θ は t・自由入力へコピー用） */
  toExpr: (c: CoeffMap) => string
}

export type Preset = RotatePreset | PolarPreset

const coeff = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
): Coefficient => ({ key, label, min, max, step, default: def })

/** 数値を mathjs 式向けに短く整形（負号もそのまま使える。係数の刻みを失わない精度） */
const num = (v: number): string => Number(v.toFixed(4)).toString()

// ===== A. 軌道（直交 y=g(x)・狙う角度θで回転） =====

export const ROTATE_PRESETS: RotatePreset[] = [
  {
    id: 'line',
    name: '直線',
    category: 'rotate',
    formula: 'y = a·x + b',
    freeName: 'x（一次式）',
    description: 'まっすぐ飛ぶ基本の術式。狙いを定めやすい。',
    coeffs: [coeff('a', 'a', -6, 6, 0.1, 1), coeff('b', 'b', -18, 18, 0.2, 0)],
    buildG: (c) => (x) => c.a * x + c.b,
    toExpr: (c) => `${num(c.a)}*x + ${num(c.b)}`,
  },
  {
    id: 'parabola',
    name: '放物線',
    category: 'rotate',
    formula: 'y = a·(x−h)² + k',
    freeName: '(x-h)^2（二次式）',
    description: '山なり／谷なりの弧。障害物を山越えできる。',
    coeffs: [
      coeff('a', 'a', -2, 2, 0.05, 0.25),
      coeff('h', 'h', 0, 24, 0.2, 8),
      coeff('k', 'k', -18, 18, 0.2, -6),
    ],
    buildG: (c) => (x) => c.a * (x - c.h) ** 2 + c.k,
    toExpr: (c) => `${num(c.a)}*(x - ${num(c.h)})^2 + ${num(c.k)}`,
  },
  {
    id: 'sine',
    name: 'サイン波',
    category: 'rotate',
    formula: 'y = A·sin(B·x) + C',
    freeName: 'sin',
    description: '波打って飛ぶ。光と闇を交互に帯びる。変異が大きい。',
    coeffs: [
      coeff('A', 'A', 0, 12, 0.1, 6),
      coeff('B', 'B', 0.1, 3, 0.05, 0.6),
      coeff('C', 'C', -9, 9, 0.1, 0),
    ],
    buildG: (c) => (x) => c.A * Math.sin(c.B * x) + c.C,
    toExpr: (c) => `${num(c.A)}*sin(${num(c.B)}*x) + ${num(c.C)}`,
  },
  {
    id: 'exp',
    name: '指数',
    category: 'rotate',
    formula: 'y = a·e^(b·x) + c',
    freeName: 'exp',
    description: '終盤で急上昇。遠くで一気に跳ね上がる。',
    coeffs: [
      coeff('a', 'a', 0, 4, 0.1, 1),
      coeff('b', 'b', -0.8, 0.8, 0.05, 0.2),
      coeff('c', 'c', -9, 9, 0.1, -5),
    ],
    buildG: (c) => (x) => c.a * Math.exp(c.b * x) + c.c,
    toExpr: (c) => `${num(c.a)}*exp(${num(c.b)}*x) + ${num(c.c)}`,
  },
  {
    id: 'abs',
    name: '絶対値',
    category: 'rotate',
    formula: 'y = a·|x−h| + k',
    freeName: 'abs',
    description: 'V字に鋭く折れる。きっかけで方向を変える。',
    coeffs: [
      coeff('a', 'a', -5, 5, 0.1, 1),
      coeff('h', 'h', 0, 24, 0.2, 8),
      coeff('k', 'k', -18, 18, 0.2, -6),
    ],
    buildG: (c) => (x) => c.a * Math.abs(x - c.h) + c.k,
    toExpr: (c) => `${num(c.a)}*abs(x - ${num(c.h)}) + ${num(c.k)}`,
  },
]

// ===== B. 軌道（極座標 r=f(θ)・全方向） =====

export const POLAR_PRESETS: PolarPreset[] = [
  {
    id: 'circle',
    name: '円',
    category: 'polar',
    formula: 'r = R',
    freeName: 'R（定数）',
    description: '一定半径で全周をなめる。結界の基本形にも。',
    coeffs: [coeff('R', 'R', 2, 28, 0.5, 11)],
    buildF: (c) => () => c.R,
    toExpr: (c) => `${num(c.R)}`,
  },
  {
    id: 'spiral',
    name: 'らせん',
    category: 'polar',
    formula: 'r = a·θ',
    freeName: 'a*θ',
    description: '渦巻き状に外へ。全方向を順に薙ぐ。',
    coeffs: [coeff('a', 'a', 0.2, 4, 0.1, 1.4)],
    buildF: (c) => (t) => c.a * t,
    toExpr: (c) => `${num(c.a)}*t`,
  },
  {
    id: 'rose',
    name: 'バラ曲線',
    category: 'polar',
    formula: 'r = a·cos(k·θ)',
    freeName: 'cos',
    description: '花びら状に複数方向へ同時に伸びる。光と闇を交互に帯びる。',
    coeffs: [coeff('a', 'a', 2, 24, 0.5, 12), coeff('k', 'k', 2, 6, 1, 4)],
    buildF: (c) => (t) => c.a * Math.cos(c.k * t),
    toExpr: (c) => `${num(c.a)}*cos(${num(c.k)}*t)`,
  },
  {
    id: 'limacon',
    name: 'リマソン',
    category: 'polar',
    formula: 'r = a + b·cos(θ)',
    freeName: 'cos',
    description: 'ハート／くぼみ形。片側に強く張り出す。',
    coeffs: [coeff('a', 'a', 1, 15, 0.5, 6), coeff('b', 'b', 1, 15, 0.5, 6)],
    buildF: (c) => (t) => c.a + c.b * Math.cos(t),
    toExpr: (c) => `${num(c.a)} + ${num(c.b)}*cos(t)`,
  },
]

export const ALL_PRESETS: Preset[] = [...ROTATE_PRESETS, ...POLAR_PRESETS]

/** 係数の既定値マップを作る */
export function defaultCoeffs(preset: Preset): CoeffMap {
  const m: CoeffMap = {}
  for (const c of preset.coeffs) m[c.key] = c.default
  return m
}

/** プリセット＋係数＋（回転時の）角度＋術者位置から Trajectory を組み立てる（#14） */
export function buildTrajectory(
  preset: Preset,
  coeffs: CoeffMap,
  angle: number,
  origin?: Vec2,
): Trajectory {
  if (preset.category === 'rotate') {
    return { mode: 'rotate', g: preset.buildG(coeffs), angle, origin }
  }
  return { mode: 'polar', f: preset.buildF(coeffs), origin }
}

// ===== 自由入力式の安全評価（mathjs のみ・eval 禁止） =====

/**
 * 自由入力式をパースして f(v) を返す。変数名は varName（回転=x／極座標=t＝θ・#19）。
 * 構文エラー・許可外ノード・未知変数なら null（UI は直前の有効関数を維持）。
 * 評価が実数でない（複素数など）／非有限／例外時は NaN を返す（→ サンプリングで暴発扱い）。
 */
export function parseExpression(
  expr: string,
  varName: 'x' | 't' = 'x',
): ((v: number) => number) | null {
  const compiled = compileExpr(expr)
  if (!compiled || !varsAllowed(compiled.vars, [varName])) return null
  // スコープは使い回す（1サンプルごとのオブジェクト生成を避ける）
  const scope: Record<string, number> = {}
  return (v: number): number => {
    scope[varName] = v
    try {
      const r = compiled.evalWith(scope)
      return typeof r === 'number' && Number.isFinite(r) ? r : NaN
    } catch {
      return NaN
    }
  }
}

/**
 * z 場の自由入力式 f(x,y) をパースして ZField を返す（#30：2変数）。
 * 構文エラー・許可外ノード・未知変数なら null（UI は直前の有効関数を維持）。
 * 非実数/非有限/例外時は 0 を返す（中立扱い）。x,y に依存しない定数式も許可する。
 */
export function parseZExpression(expr: string): ZField | null {
  const compiled = compileExpr(expr)
  if (!compiled || !varsAllowed(compiled.vars, ['x', 'y'])) return null
  const scope: Record<string, number> = {}
  return (x: number, y: number): number => {
    scope.x = x
    scope.y = y
    try {
      const r = compiled.evalWith(scope)
      return typeof r === 'number' && Number.isFinite(r) ? r : 0
    } catch {
      return 0
    }
  }
}

// ===== サンプル出力（機能2） =====

export interface SamplePoint {
  x: number
  y: number
}

/** 軌道関数のサンプル出力（既定 f(0), f(2), f(5)） */
export function sampleOutputs(
  g: (x: number) => number,
  xs: number[] = [0, 2, 5],
): SamplePoint[] {
  return xs.map((x) => ({ x, y: g(x) }))
}
