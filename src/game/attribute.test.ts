import { describe, it, expect } from 'vitest'
import {
  attributeOf,
  strengthOf,
  affinityMultiplier,
  power,
  computeDamage,
  trajectoryZ,
  dominantAttribute,
} from './attribute'
import { FIELD, AFFINITY } from '../data/constants'
import type { Trajectory } from './types'

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

describe('軌道の z 値（属性源・新モデル）', () => {
  it('回転は g(x)、極座標は f(θ) を返す。NaN は 0', () => {
    expect(trajectoryZ({ mode: 'rotate', g: (x) => x * 2, angle: 0 }, 3)).toBe(6)
    expect(trajectoryZ({ mode: 'polar', f: (t) => t }, 1.5)).toBe(1.5)
    expect(trajectoryZ({ mode: 'rotate', g: () => NaN, angle: 0 }, 0)).toBe(0)
  })

  it('支配属性は経路で |z| が最大の点の属性・強度を返す', () => {
    const traj: Trajectory = { mode: 'rotate', g: (x) => x, angle: 0 } // z=x → 光
    const dom = dominantAttribute(traj, [{ param: 0 }, { param: 2 }, { param: 4 }])
    expect(dom.attr).toBe('light')
    expect(dom.strength).toBe(4)
  })
})
