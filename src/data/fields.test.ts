import { describe, it, expect } from 'vitest'
import { SHIELD_PRESETS, buildShield } from './fields'

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

  it('未知IDは円結界にフォールバック', () => {
    const s = buildShield('does-not-exist', 'dark', 5)
    expect(s.shape).toBe('circle')
  })
})
