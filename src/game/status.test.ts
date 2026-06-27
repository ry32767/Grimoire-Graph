import { describe, it, expect } from 'vitest'
import { makeStatus, addStatus, tickStatuses, maxStatuses } from './status'
import { COMBAT } from '../data/constants'
import type { StatusEffect } from './types'

describe('状態異常の生成（§3.3）', () => {
  it('光 → ひるみ。|z| が強いほど長い', () => {
    const weak = makeStatus('light', 1)
    const strongS = makeStatus('light', 5)
    expect(weak?.kind).toBe('flinch')
    expect(strongS?.kind).toBe('flinch')
    expect(strongS!.remainingTurns).toBeGreaterThan(weak!.remainingTurns)
  })

  it('闇 → 継続ダメージ。総量 |z|×burnScale を burnTurns に分割', () => {
    const burn = makeStatus('dark', 3)
    expect(burn?.kind).toBe('burn')
    expect(burn!.remainingTurns).toBe(COMBAT.burnTurns)
    expect(burn!.magnitude).toBeCloseTo((3 * COMBAT.burnScale) / COMBAT.burnTurns, 6)
  })

  it('中立・強度0は付与しない', () => {
    expect(makeStatus('neutral', 5)).toBeNull()
    expect(makeStatus('light', 0)).toBeNull()
  })
})

describe('状態異常の付与（マージ）', () => {
  it('同種は強い方へ更新してスタックしない', () => {
    let s: StatusEffect[] = []
    s = addStatus(s, { kind: 'burn', magnitude: 2, remainingTurns: 3 })
    s = addStatus(s, { kind: 'burn', magnitude: 4, remainingTurns: 2 })
    expect(s).toHaveLength(1)
    expect(s[0].magnitude).toBe(4)
    expect(s[0].remainingTurns).toBe(3)
  })

  it('異種は併存する', () => {
    let s: StatusEffect[] = []
    s = addStatus(s, makeStatus('light', 3))
    s = addStatus(s, makeStatus('dark', 3))
    expect(s).toHaveLength(2)
  })
})

describe('ターン処理（DoT・ひるみ・持続減衰）', () => {
  it('DoT ダメージを適用し、ひるみを検知し、持続を1減らす', () => {
    const statuses: StatusEffect[] = [
      { kind: 'burn', magnitude: 2, remainingTurns: 3 },
      { kind: 'flinch', magnitude: 4, remainingTurns: 1 },
    ]
    const r = tickStatuses(statuses)
    expect(r.burnDamage).toBe(2)
    expect(r.impaired).toBe(true)
    // burn は rem2 で残り、flinch は rem0 で消える
    expect(r.statuses).toHaveLength(1)
    expect(r.statuses[0].kind).toBe('burn')
    expect(r.statuses[0].remainingTurns).toBe(2)
  })

  it('空なら無害', () => {
    const r = tickStatuses([])
    expect(r.burnDamage).toBe(0)
    expect(r.impaired).toBe(false)
    expect(r.statuses).toHaveLength(0)
  })
})

describe('暴発の両状態異常（§3.5）', () => {
  it('最大強度の光・闇の両方を付与する', () => {
    const s = maxStatuses()
    expect(s.some((x) => x.kind === 'flinch')).toBe(true)
    expect(s.some((x) => x.kind === 'burn')).toBe(true)
  })
})
