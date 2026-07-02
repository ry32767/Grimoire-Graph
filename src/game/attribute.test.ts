import { describe, it, expect } from 'vitest'
import {
  attributeOf,
  strengthOf,
  affinityMultiplier,
  power,
  computeDamage,
  zfieldAt,
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

describe('属性強度（山型・|z|=zPeak で最強・#21）', () => {
  it('|z|=zPeak で最大、0 と 2·zPeak で 0、極端値ほど弱い', () => {
    expect(strengthOf(FIELD.zPeak)).toBeCloseTo(FIELD.sMax, 6)
    expect(strengthOf(-FIELD.zPeak)).toBeCloseTo(FIELD.sMax, 6)
    expect(strengthOf(0)).toBe(0)
    expect(strengthOf(2 * FIELD.zPeak)).toBe(0)
    expect(strengthOf(100)).toBe(0) // 極端に大きい値は弱い（クランプではなく山型）
  })

  it('ピークへ近づくほど強い（0→zPeak は単調増加）', () => {
    expect(strengthOf(1)).toBeLessThan(strengthOf(3))
    expect(strengthOf(3)).toBeLessThan(strengthOf(FIELD.zPeak))
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
    expect(power(4, FIELD.zPeak)).toBe(4 * FIELD.sMax) // ピークで最大威力
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

describe('z 場（属性源・#30）', () => {
  it('z 場 z=f(x,y) を位置で評価する。未指定は0、非有限は0', () => {
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: 0, z: (x, y) => x + y }
    expect(zfieldAt(traj, { x: 2, y: 3 })).toBe(5)
    expect(zfieldAt({ mode: 'rotate', g: () => 0, angle: 0 }, { x: 1, y: 1 })).toBe(0) // z場なし
    expect(zfieldAt({ mode: 'rotate', g: () => 0, angle: 0, z: () => NaN }, { x: 0, y: 0 })).toBe(0)
  })

  it('z 場は術者位置（origin）を原点として評価する（#52・軌道と同じ基準）', () => {
    // 術者 (5,5)・z=y。位置 (5,8) は術者から見て y=3 → 3 を返す（絶対 y=8 ではない）
    const traj: Trajectory = {
      mode: 'rotate',
      g: () => 0,
      angle: 0,
      origin: { x: 5, y: 5 },
      z: (_x, y) => y,
    }
    expect(zfieldAt(traj, { x: 5, y: 8 })).toBeCloseTo(3, 6)
    // 術者の足元は常に原点 → z=0
    expect(zfieldAt(traj, { x: 5, y: 5 })).toBeCloseTo(0, 6)
  })

  it('支配属性は経路で強度が最大の点の属性・強度を返す', () => {
    // z=+zPeak 一定 → どこでも光・最強
    const traj: Trajectory = { mode: 'rotate', g: () => 0, angle: 0, z: () => FIELD.zPeak }
    const dom = dominantAttribute(traj, [{ pos: { x: 0, y: 0 } }, { pos: { x: 2, y: 0 } }])
    expect(dom.attr).toBe('light')
    expect(dom.strength).toBeCloseTo(FIELD.sMax, 6)
  })
})
