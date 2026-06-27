// 属性の場（§3.10-C）と結界（§3.10-D）のプリセット定義。
// 場はステージごとにシステムが設定する（プレイヤーは選べない）。
import type { Field, Shield, Attribute } from '../game/types'

/** 場プリセット */
export interface FieldPreset {
  id: string
  name: string
  formula: string
  /** 光/闇/中立の出方の説明 */
  description: string
  build: (p: Record<string, number>) => Field
  defaults: Record<string, number>
}

export const FIELD_PRESETS: FieldPreset[] = [
  {
    id: 'plane',
    name: '平面傾斜',
    formula: 'f = a·x + b·y',
    description: '片側が光、反対が闇。中立は一直線の帯。',
    build: (p) => (x, y) => p.a * x + p.b * y,
    defaults: { a: 0.5, b: 0.5 },
  },
  {
    id: 'concentric',
    name: '同心円',
    formula: 'f = x²+y² − c',
    description: '中心が闇、外周が光（c で半径）。中立は円環。',
    build: (p) => (x, y) => x * x + y * y - p.c,
    defaults: { c: 25 },
  },
  {
    id: 'checker',
    name: '市松（波）',
    formula: 'f = sin(a·x)·sin(b·y)',
    description: '光闇が網目状に交互。中立帯が格子状に走る（加速ルート向き）。',
    build: (p) => (x, y) => Math.sin(p.a * x) * Math.sin(p.b * y),
    defaults: { a: 0.6, b: 0.6 },
  },
  {
    id: 'hyperbolic',
    name: '双曲',
    formula: 'f = x² − y²',
    description: '4象限で光闇が交互。中立は対角線。',
    build: () => (x, y) => x * x - y * y,
    defaults: {},
  },
]

/** id から場を構築（既定係数）。見つからなければ平面傾斜。 */
export function buildField(id: string, params?: Record<string, number>): Field {
  const preset = FIELD_PRESETS.find((p) => p.id === id) ?? FIELD_PRESETS[0]
  return preset.build({ ...preset.defaults, ...params })
}

/** 結界プリセット（§3.10-D） */
export interface ShieldPreset {
  id: string
  name: string
  formula: string
  description: string
  shape: 'circle' | 'ellipse'
  defaultParams: { R?: number; a?: number; b?: number }
}

export const SHIELD_PRESETS: ShieldPreset[] = [
  {
    id: 'circle-shield',
    name: '円結界',
    formula: 'x² + y² = R²',
    description: '全方向を均等に守る。',
    shape: 'circle',
    defaultParams: { R: 4 },
  },
  {
    id: 'ellipse-shield',
    name: '楕円結界',
    formula: 'x²/a² + y²/b² = 1',
    description: '特定方向に厚く張れる。',
    shape: 'ellipse',
    defaultParams: { a: 5, b: 3 },
  },
]

/** 結界プリセットから Shield を生成する */
export function buildShield(
  presetId: string,
  element: Attribute,
  durability: number,
): Shield {
  const preset = SHIELD_PRESETS.find((p) => p.id === presetId) ?? SHIELD_PRESETS[0]
  return {
    shape: preset.shape,
    params: { ...preset.defaultParams },
    element,
    durability,
    maxDurability: durability,
  }
}
