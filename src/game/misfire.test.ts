import { describe, it, expect } from 'vitest'
import { detectMisfire, resolveMisfire } from './misfire'
import { dist } from './coords'
import { FIELD, AFFINITY, COMBAT } from '../data/constants'
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

  it('#30：z 場（属性関数）がエラーになる点でも暴発する（軌道は有効でも）', () => {
    // 軌道は直進で場内有効。z 場が局所 x>8 で非有限（NaN）になる → その手前で暴発。
    const traj: Trajectory = {
      mode: 'rotate',
      g: () => 0,
      angle: 0,
      z: (x) => (x > 8 ? NaN : 5),
    }
    const m = detectMisfire(traj)
    expect(m?.type).toBe('invalid')
    expect(dist(m!.pos)).toBeGreaterThan(0) // 原点ではなく、エラー手前の場内点
    expect(dist(m!.pos)).toBeLessThanOrEqual(FIELD.rField)
  })

  it('#30：z 場の極（1/x 型の符号反転発散）も暴発に分類する', () => {
    // z = 1/(x-10) は world x=10 で発散。直進軌道がそこを跨ぐと暴発。
    const traj: Trajectory = {
      mode: 'rotate',
      g: () => 0,
      angle: 0,
      z: (x) => 1 / (x - 10),
    }
    expect(detectMisfire(traj)?.type).toBe('invalid')
  })

  it('#30：正常な z 場（一定）では暴発しない', () => {
    const traj: Trajectory = { mode: 'polar', f: () => 5, z: () => 5 }
    expect(detectMisfire(traj)).toBeNull()
  })
})

describe('暴発の AoE 解決', () => {
  it('威力は常に最大（Smax×maxFlightSpeed）・速度に依らず一定、ダメージ=威力×1.5', () => {
    const maxPower = FIELD.sMax * FIELD.maxFlightSpeed
    for (const sp of [0, 4, 12, 24, 100]) {
      const r = resolveMisfire({ type: 'invalid', pos: { x: 5, y: 0 } }, sp, [])
      expect(r.power).toBe(maxPower) // 速度に依らず常に最大
      expect(r.damage).toBe(maxPower * AFFINITY.opposite) // 常に有利側（×1.5）
    }
  })

  it('光・闇の両属性を最大強度（Smax）で付与する', () => {
    const r = resolveMisfire({ type: 'invalid', pos: { x: 5, y: 0 } }, 4, [])
    const flinch = r.statuses.find((s) => s.kind === 'flinch')
    const burn = r.statuses.find((s) => s.kind === 'burn')
    expect(flinch).toBeTruthy()
    expect(burn).toBeTruthy()
    // ひるみ（光）は最大強度 Smax 由来、継続ダメージ（闇）も Smax 由来で最長ターン
    expect(flinch!.magnitude).toBe(FIELD.sMax)
    expect(burn!.magnitude).toBe((FIELD.sMax * COMBAT.burnScale) / COMBAT.burnTurns)
    expect(burn!.remainingTurns).toBe(COMBAT.burnTurns)
  })

  it('AoE 半径内の敵に当たる', () => {
    const r = resolveMisfire({ type: 'invalid', pos: { x: 5, y: 0 } }, 4, [
      { id: 'near', pos: { x: 5.5, y: 0 } }, // 距離0.5 < AoE
      { id: 'far', pos: { x: 13, y: 0 } }, // 距離8 > AoE（#29 で半径5へ拡大）
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
