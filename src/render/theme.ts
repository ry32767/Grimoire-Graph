// Canvas 描画用のカラーパレット（§3.9・CSS トークンと対応）。
import type { Attribute } from '../game/types'
import { FIELD } from '../data/constants'
import { strengthOf } from '../game/attribute'

export const COLORS = {
  bg: '#0d0b14',
  grid: '#26224a',
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

/** 場の値 z を背景タイル色（薄い色分け）に変換する。 */
export function fieldTile(z: number): string {
  const s = strengthOf(z)
  const t = Math.min(s / FIELD.sMax, 1)
  if (Math.abs(z) < FIELD.epsilon) return 'rgba(58,58,70,0.22)'
  if (z > 0) {
    // 光：金。強いほど濃く明るく
    return `rgba(244,196,48,${(0.1 + 0.4 * t).toFixed(3)})`
  }
  // 闇：紫藍。強いほど濃く
  return `rgba(108,86,190,${(0.1 + 0.42 * t).toFixed(3)})`
}

/** 属性の代表色（弾・テキスト用） */
export function attrColor(attr: Attribute): string {
  if (attr === 'light') return COLORS.light1
  if (attr === 'dark') return COLORS.dark1
  return COLORS.neutral
}
