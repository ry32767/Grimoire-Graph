// 結界（§3.10-D）のプリセット定義。
// ※ 属性モデル変更（弾の関数値 z で属性が決まる）に伴い、ステージ固定の場プリセットは廃止。
import type { Shield, Attribute } from '../game/types'

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
