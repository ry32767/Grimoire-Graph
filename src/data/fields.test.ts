import { describe, it, expect } from 'vitest'
import { FIELD_PRESETS, buildField, SHIELD_PRESETS, buildShield } from './fields'
import { attributeOf } from '../game/attribute'

describe('場プリセット（§3.10-C）', () => {
  it('4種類が揃っている', () => {
    expect(FIELD_PRESETS).toHaveLength(4)
  })

  it('平面傾斜：片側が光・反対が闇', () => {
    const f = buildField('plane')
    expect(attributeOf(f(5, 5))).toBe('light')
    expect(attributeOf(f(-5, -5))).toBe('dark')
  })

  it('同心円：中心が闇・外周が光', () => {
    const f = buildField('concentric') // x²+y²-25
    expect(attributeOf(f(0, 0))).toBe('dark') // -25
    expect(attributeOf(f(10, 0))).toBe('light') // +75
  })

  it('双曲：象限で光闇が交互、対角が中立', () => {
    const f = buildField('hyperbolic') // x²-y²
    expect(attributeOf(f(5, 0))).toBe('light')
    expect(attributeOf(f(0, 5))).toBe('dark')
    expect(attributeOf(f(3, 3))).toBe('neutral') // 対角線
  })

  it('未知IDは平面傾斜にフォールバック', () => {
    const f = buildField('does-not-exist')
    expect(typeof f(1, 1)).toBe('number')
  })
})

describe('結界プリセット（§3.10-D）', () => {
  it('円結界・楕円結界が揃っている', () => {
    expect(SHIELD_PRESETS).toHaveLength(2)
  })

  it('buildShield は属性と耐久を持つ Shield を作る', () => {
    const s = buildShield('circle-shield', 'light', 10)
    expect(s.shape).toBe('circle')
    expect(s.params.R).toBeGreaterThan(0)
    expect(s.element).toBe('light')
    expect(s.durability).toBe(10)
    expect(s.maxDurability).toBe(10)
  })
})
