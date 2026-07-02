// Canvas 描画用のカラーパレット（§3.9・CSS トークンと対応）。
import type { Attribute } from '../game/types'

export const COLORS = {
  bg: '#0d0b14',
  grid: '#221e40', // 小目盛り（1ユニット）線
  gridMajor: '#332d5e', // 大目盛り（5ユニット）線＝数えやすさのため濃く
  axis: '#3a3470',
  light1: '#f4c430',
  light2: '#fff8e1',
  dark1: '#7b5cc4',
  dark2: '#1e2a6b',
  neutral: '#3a3a46',
  text: '#fff8e1',
  caster: '#ffe9a8',
  enemy: '#e85d75',
  enemyDark: '#9c3650',
  ghost: '#9c7bd8',
  obstacle: '#8a7bbf',
} as const

/** 属性の代表色（弾・テキスト用） */
export function attrColor(attr: Attribute): string {
  if (attr === 'light') return COLORS.light1
  if (attr === 'dark') return COLORS.dark1
  return COLORS.neutral
}
