import { describe, it, expect } from 'vitest'
import { detectMisfire, resolveMisfire } from './misfire'
import { dist } from './coords'
import { FIELD, AFFINITY } from '../data/constants'
import type { Trajectory } from './types'

describe('暴発点の検出（§3.5・機能8）', () => {
  it('場内で完結する軌道（円 r=5）は暴発しない', () => {
    const circle: Trajectory = { mode: 'polar', f: () => 5 }
    expect(detectMisfire(circle)).toBeNull()
  })

  it('場外へ出る軌道は outOfField を検出', () => {
    const line: Trajectory = { mode: 'rotate', g: () => 0, angle: 0 }
    const m = detectMisfire(line)
    expect(m?.type).toBe('outOfField')
  })

  it('1/x は原点近傍で発散 → invalid（暴発点は原点付近）', () => {
    const recip: Trajectory = { mode: 'rotate', g: (x) => 1 / x, angle: 0 }
    const m = detectMisfire(recip)
    expect(m?.type).toBe('invalid')
    expect(m?.pos).toEqual({ x: 0, y: 0 })
  })

  it('#3：原点以外で発散する関数も invalid＝暴発（暴発点は画面内＝場内）', () => {
    // 1/(2-x) は x=2 で発散（#9 の例）。暴発点は直前の場内点（画面内・原点以外）になる。
    const pole: Trajectory = { mode: 'rotate', g: (x) => 1 / (2 - x), angle: 0 }
    const m = detectMisfire(pole)
    expect(m?.type).toBe('invalid')
    expect(dist(m!.pos)).toBeLessThanOrEqual(FIELD.rField)
    expect(dist(m!.pos)).toBeGreaterThan(0) // 原点ではない

    // 刻みが極を飛び越える 1/(2.5-x) も「飛んで戻る」検出で暴発に分類
    const pole2: Trajectory = { mode: 'rotate', g: (x) => 1 / (2.5 - x), angle: 0 }
    expect(detectMisfire(pole2)?.type).toBe('invalid')
  })
})

describe('暴発の AoE 解決', () => {
  it('威力=速度×Smax、ダメージ=威力×1.5（常に有利側）', () => {
    const r = resolveMisfire({ type: 'invalid', pos: { x: 5, y: 0 } }, 4, [])
    expect(r.power).toBe(4 * FIELD.sMax)
    expect(r.damage).toBe(4 * FIELD.sMax * AFFINITY.opposite)
  })

  it('光ひるみ＋闇DoT の両状態異常を付与', () => {
    const r = resolveMisfire({ type: 'invalid', pos: { x: 5, y: 0 } }, 4, [])
    expect(r.statuses.some((s) => s.kind === 'flinch')).toBe(true)
    expect(r.statuses.some((s) => s.kind === 'burn')).toBe(true)
  })

  it('AoE 半径内の敵に当たる', () => {
    const r = resolveMisfire({ type: 'invalid', pos: { x: 5, y: 0 } }, 4, [
      { id: 'near', pos: { x: 5.5, y: 0 } }, // 距離0.5 < AoE
      { id: 'far', pos: { x: 10, y: 0 } }, // 距離5 > AoE
    ])
    expect(r.hitIds).toContain('near')
    expect(r.hitIds).not.toContain('far')
  })

  it('原点近傍の暴発は術者を巻き込む（自爆）', () => {
    const selfBlast = resolveMisfire({ type: 'invalid', pos: { x: 0, y: 0 } }, 4, [])
    expect(selfBlast.selfHit).toBe(true)
    const farBlast = resolveMisfire({ type: 'outOfField', pos: { x: 13, y: 0 } }, 4, [])
    expect(farBlast.selfHit).toBe(false)
  })
})
