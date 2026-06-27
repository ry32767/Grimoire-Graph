import { describe, it, expect } from 'vitest'
import {
  attributeOf,
  strengthOf,
  affinityMultiplier,
  power,
  computeDamage,
  evalField,
} from './attribute'
import { FIELD, AFFINITY } from '../data/constants'

describe('属性判定（z 符号）', () => {
  it('z>ε は光、z<-ε は闇、|z|<ε は中立', () => {
    expect(attributeOf(2)).toBe('light')
    expect(attributeOf(-2)).toBe('dark')
    expect(attributeOf(0)).toBe('neutral')
    expect(attributeOf(FIELD.epsilon / 2)).toBe('neutral')
    expect(attributeOf(FIELD.epsilon + 0.01)).toBe('light')
  })
})

describe('属性強度（|z| クランプ）', () => {
  it('|z| を返し Smax で上限クランプ', () => {
    expect(strengthOf(3)).toBe(3)
    expect(strengthOf(-3)).toBe(3)
    expect(strengthOf(100)).toBe(FIELD.sMax)
    expect(strengthOf(0)).toBe(0)
  })
})

describe('極性相性（§3.2）', () => {
  it('反対極×1.5・同極×0.5・中立×1.0', () => {
    expect(affinityMultiplier('light', 'dark')).toBe(AFFINITY.opposite)
    expect(affinityMultiplier('dark', 'light')).toBe(AFFINITY.opposite)
    expect(affinityMultiplier('light', 'light')).toBe(AFFINITY.same)
    expect(affinityMultiplier('dark', 'dark')).toBe(AFFINITY.same)
    expect(affinityMultiplier('neutral', 'light')).toBe(AFFINITY.neutral)
    expect(affinityMultiplier('light', 'neutral')).toBe(AFFINITY.neutral)
  })
})

describe('威力とダメージ（機能9）', () => {
  it('威力 = 速度 × 強度', () => {
    expect(power(4, 3)).toBe(12)
    expect(power(4, 100)).toBe(4 * FIELD.sMax) // 強度はクランプ
  })

  it('低速で当たると威力が下がる（単調）', () => {
    expect(power(2, 3)).toBeLessThan(power(8, 3))
  })

  it('最終ダメージ = 威力 × 相性。反対極で増える', () => {
    // z=2(光) で対象が闇 → 反対極 ×1.5
    const vsDark = computeDamage(4, 2, 'dark')
    expect(vsDark.attackAttr).toBe('light')
    expect(vsDark.power).toBe(8)
    expect(vsDark.affinity).toBe(AFFINITY.opposite)
    expect(vsDark.damage).toBe(12)

    // 同じ威力でも対象が光（同極）なら ×0.5
    const vsLight = computeDamage(4, 2, 'light')
    expect(vsLight.damage).toBe(4)
    expect(vsLight.damage).toBeLessThan(vsDark.damage)
  })

  it('ダメージ内訳が揃っている（速度/強度/相性/威力）', () => {
    const b = computeDamage(5, -3, 'light')
    expect(b.speed).toBe(5)
    expect(b.strength).toBe(3)
    expect(b.attackAttr).toBe('dark')
    expect(b.targetAttr).toBe('light')
    expect(b.affinity).toBe(AFFINITY.opposite)
    expect(b.damage).toBe(5 * 3 * AFFINITY.opposite)
  })
})

describe('場の評価', () => {
  it('有限値はそのまま、NaN は 0 に丸める', () => {
    expect(evalField((x, y) => x + y, { x: 1, y: 2 })).toBe(3)
    expect(evalField(() => NaN, { x: 0, y: 0 })).toBe(0)
  })
})
