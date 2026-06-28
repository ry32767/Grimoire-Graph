// z 場プリセット（#30/#21）：属性の高さ z=f(x,y) を位置から決める関数群。
// 軌道（経路）とは独立。符号で属性、|z| が zPeak に近いほど強い（attribute.strengthOf）。
import type { Coefficient } from './functions'
import type { ZField } from './types'

type CoeffMap = Record<string, number>

/** z 場プリセット定義 */
export interface ZPreset {
  id: string
  name: string
  /** 式の見た目（パネル表示用） */
  formula: string
  /** 説明（狙い方の手がかり） */
  description: string
  coeffs: Coefficient[]
  build: (c: CoeffMap) => ZField
  /** 係数を f(x,y) 自由入力式に変換（コピー用） */
  toExpr: (c: CoeffMap) => string
}

const coeff = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  def: number,
): Coefficient => ({ key, label, min, max, step, default: def })

const num = (v: number): string => Number(v.toFixed(4)).toString()

// V=zPeak=5 を基準に、最強(±5)へ合わせやすい範囲にする。
export const ZFIELD_PRESETS: ZPreset[] = [
  {
    id: 'const',
    name: '一定',
    formula: 'z = c',
    description: 'どこでも同じ属性。c=+5 で最強の光、c=−5 で最強の闇（|z|=5が最強）。',
    coeffs: [coeff('c', 'c', -8, 8, 0.5, 5)],
    build: (c) => () => c.c,
    toExpr: (c) => `${num(c.c)}`,
  },
  {
    id: 'gradY',
    name: '縦勾配',
    formula: 'z = a·y + b',
    description: '高さ y で属性が変わる。手前は弱く、奥で強属性…などを作れる。',
    coeffs: [coeff('a', 'a', -0.6, 0.6, 0.05, 0.3), coeff('b', 'b', -6, 6, 0.5, 0)],
    build: (c) => (_x, y) => c.a * y + c.b,
    toExpr: (c) => `${num(c.a)}*y + ${num(c.b)}`,
  },
  {
    id: 'gradX',
    name: '横勾配',
    formula: 'z = a·x + b',
    description: '左右 x で属性が変わる。狙った横位置で |z|=5 に乗せると強い。',
    coeffs: [coeff('a', 'a', -0.6, 0.6, 0.05, 0.3), coeff('b', 'b', -6, 6, 0.5, 0)],
    build: (c) => (x) => c.a * x + c.b,
    toExpr: (c) => `${num(c.a)}*x + ${num(c.b)}`,
  },
  {
    id: 'radial',
    name: '放射',
    formula: 'z = a·√(x²+y²) + b',
    description: '中心からの距離で属性が変わる。一定の輪の上で最強属性に乗せられる。',
    coeffs: [coeff('a', 'a', -0.6, 0.6, 0.05, 0.3), coeff('b', 'b', -6, 6, 0.5, 0)],
    build: (c) => (x, y) => c.a * Math.hypot(x, y) + c.b,
    toExpr: (c) => `${num(c.a)}*sqrt(x^2 + y^2) + ${num(c.b)}`,
  },
]

export function findZPreset(id: string): ZPreset | undefined {
  return ZFIELD_PRESETS.find((p) => p.id === id)
}

/** 係数の既定値マップ。 */
export function defaultZCoeffs(preset: ZPreset): CoeffMap {
  const m: CoeffMap = {}
  for (const c of preset.coeffs) m[c.key] = c.default
  return m
}

/** 定数 z 場（敵やおすすめで使う簡便版）。 */
export function constZField(c: number): ZField {
  return () => c
}
