// Canvas 描画用のカラーパレット（DESIGN.md §2・src/render/palette.ts と同一値を参照）。
import type { Attribute } from '../game/types'
import { ARENA, TOKENS } from './palette'

export const COLORS = {
  bg: TOKENS.arenaBg,
  grid: ARENA.gridLine, // 小目盛り（1ユニット）線
  gridMajor: 'rgba(125,143,196,0.16)', // 大目盛り（5ユニット）線＝数えやすさのため濃く
  axis: ARENA.axisLine,
  light1: TOKENS.light,
  light2: TOKENS.lightSoft,
  dark1: TOKENS.dark,
  dark2: TOKENS.darkSoft,
  neutral: '#3a3a46',
  text: TOKENS.text,
  caster: TOKENS.light,
  enemy: '#e85d75',
  enemyDark: '#9c3650',
  ghost: TOKENS.dark,
  obstacle: '#8a7bbf',
} as const

/** 属性の代表色（弾・テキスト用） */
export function attrColor(attr: Attribute): string {
  if (attr === 'light') return COLORS.light1
  if (attr === 'dark') return COLORS.dark1
  return COLORS.neutral
}
