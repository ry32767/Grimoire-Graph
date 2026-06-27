import { describe, it, expect } from 'vitest'
import {
  acceleration,
  simulateFlight,
  simulateWithLosses,
  buildSpeedProfile,
  speedAtLength,
  sampleAtLength,
} from './physics'
import { FIELD } from '../data/constants'
import type { Field, Trajectory } from './types'

const line: Trajectory = { mode: 'rotate', g: () => 0, angle: 0 } // x 軸方向の直線
const neutral: Field = () => 0 // どこでも中立 → 最大加速
const strong: Field = () => FIELD.sMax // どこでも強属性 → 加速 0

describe('加速度場（§3.4）', () => {
  it('|z|≈0 で aMax、|z|≥zRef で 0', () => {
    expect(acceleration(0)).toBeCloseTo(FIELD.aMax, 6)
    expect(acceleration(FIELD.zRef)).toBeCloseTo(0, 6)
    expect(acceleration(FIELD.zRef + 10)).toBeCloseTo(0, 6)
  })

  it('|z| が大きいほど加速度は小さい（単調減少）', () => {
    expect(acceleration(1)).toBeGreaterThan(acceleration(2))
    expect(acceleration(2)).toBeGreaterThan(acceleration(4))
  })
})

describe('運動量・速度の積分更新', () => {
  it('中立帯を通ると加速して速度が上がる', () => {
    const f = simulateFlight(line, 5, neutral)
    expect(f.endSpeed).toBeGreaterThan(5)
  })

  it('強属性帯では加速しない（速度ほぼ一定）', () => {
    const f = simulateFlight(line, 5, strong)
    expect(f.endSpeed).toBeCloseTo(5, 4)
  })

  it('中立帯のほうが強属性帯より終端速度が大きい（単調性）', () => {
    const n = simulateFlight(line, 5, neutral).endSpeed
    const s = simulateFlight(line, 5, strong).endSpeed
    expect(n).toBeGreaterThan(s)
  })

  it('速度は終端速度 maxFlightSpeed でクランプされる', () => {
    const f = simulateFlight(line, 5, neutral)
    expect(f.endSpeed).toBeLessThanOrEqual(FIELD.maxFlightSpeed + 1e-9)
  })

  it('弧長が進むほど速度が増える（速度プロファイル）', () => {
    const profile = buildSpeedProfile(line, 5, neutral)
    const v1 = speedAtLength(profile, 1)
    const v5 = speedAtLength(profile, 5)
    const v10 = speedAtLength(profile, 10)
    expect(v1).toBeLessThan(v5)
    expect(v5).toBeLessThan(v10)
  })
})

describe('速度減衰イベントと消滅', () => {
  it('大きな減衰で速度 0 → 消滅（vanished）', () => {
    const f = simulateWithLosses(line, 5, neutral, [{ arcLen: 1, deltaV: 100 }])
    expect(f.end).toBe('vanished')
    expect(f.endSpeed).toBe(0)
    expect(f.samples[f.samples.length - 1].speed).toBe(0)
  })

  it('減衰イベントは下流の速度を下げる', () => {
    // 強属性帯（加速なし）：初速5 → 減衰2 → 以後3で一定
    const f = simulateWithLosses(line, 5, strong, [{ arcLen: 1, deltaV: 2 }])
    expect(f.end).not.toBe('vanished')
    expect(f.endSpeed).toBeCloseTo(3, 4)
  })

  it('命中点（ある弧長以下）の速度を取得できる', () => {
    const f = simulateFlight(line, 5, neutral)
    const at = sampleAtLength(f, 5)
    expect(at).not.toBeNull()
    expect(at!.speed).toBeGreaterThan(5)
  })
})

describe('原点近傍で即発散する式', () => {
  it('1/x は飛べずに無効終端（暴発はターン側で処理）', () => {
    const recip: Trajectory = { mode: 'rotate', g: (x) => 1 / x, angle: 0 }
    const f = simulateFlight(recip, 5, neutral)
    expect(f.samples).toHaveLength(0)
    expect(f.end).toBe('invalid')
    expect(f.endPos).toEqual({ x: 0, y: 0 })
  })
})
