import { describe, it, expect } from 'vitest'
import {
  acceleration,
  simulateFlight,
  simulateWithLosses,
  simulatePath,
  buildSpeedProfile,
  speedAtLength,
  sampleAtLength,
} from './physics'
import { FIELD } from '../data/constants'
import type { Trajectory } from './types'

// 新モデル：z は関数値。g=()=>0 は中立（最大加速）、g=()=>Smax は強属性（加速0）。
const lineNeutral: Trajectory = { mode: 'rotate', g: () => 0, angle: 0 }
const lineStrong: Trajectory = { mode: 'rotate', g: () => FIELD.sMax, angle: 0 }

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
  it('中立（関数値0）の弾は加速して速度が上がる', () => {
    expect(simulateFlight(lineNeutral, 5).endSpeed).toBeGreaterThan(5)
  })

  it('強属性（関数値=Smax）の弾は加速しない（速度ほぼ一定）', () => {
    expect(simulateFlight(lineStrong, 5).endSpeed).toBeCloseTo(5, 4)
  })

  it('中立のほうが強属性より終端速度が大きい（単調性）', () => {
    expect(simulateFlight(lineNeutral, 5).endSpeed).toBeGreaterThan(
      simulateFlight(lineStrong, 5).endSpeed,
    )
  })

  it('速度は終端速度 maxFlightSpeed でクランプされる', () => {
    expect(simulateFlight(lineNeutral, 5).endSpeed).toBeLessThanOrEqual(FIELD.maxFlightSpeed + 1e-9)
  })

  it('弧長が進むほど速度が増える（速度プロファイル）', () => {
    const profile = buildSpeedProfile(lineNeutral, 5)
    expect(speedAtLength(profile, 1)).toBeLessThan(speedAtLength(profile, 5))
    expect(speedAtLength(profile, 5)).toBeLessThan(speedAtLength(profile, 10))
  })
})

describe('速度減衰イベントと消滅', () => {
  it('大きな減衰で速度 0 → 消滅（vanished）', () => {
    const f = simulateWithLosses(lineNeutral, 5, [{ arcLen: 1, deltaV: 100 }])
    expect(f.end).toBe('vanished')
    expect(f.endSpeed).toBe(0)
    expect(f.samples[f.samples.length - 1].speed).toBe(0)
  })

  it('減衰イベントは下流の速度を下げる', () => {
    // 強属性帯（加速なし）：初速5 → 減衰2 → 以後3で一定
    const f = simulateWithLosses(lineStrong, 5, [{ arcLen: 1, deltaV: 2 }])
    expect(f.end).not.toBe('vanished')
    expect(f.endSpeed).toBeCloseTo(3, 4)
  })

  it('命中点（ある弧長以下）の速度を取得できる', () => {
    const at = sampleAtLength(simulateFlight(lineNeutral, 5), 5)
    expect(at).not.toBeNull()
    expect(at!.speed).toBeGreaterThan(5)
  })
})

describe('明示パス（敵弾）の z は zAt で与える', () => {
  const path = [
    { x: 8, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 0 },
  ]
  it('中立(z=0)は加速、強属性(z=Smax)は加速しない', () => {
    const neutral = simulatePath(path, 4, () => 0).endSpeed
    const strong = simulatePath(path, 4, () => FIELD.sMax).endSpeed
    expect(neutral).toBeGreaterThan(strong)
    expect(strong).toBeCloseTo(4, 4)
  })
})

describe('原点近傍で即発散する式', () => {
  it('1/x は飛べずに無効終端（暴発はターン側で処理）', () => {
    const recip: Trajectory = { mode: 'rotate', g: (x) => 1 / x, angle: 0 }
    const f = simulateFlight(recip, 5)
    expect(f.samples).toHaveLength(0)
    expect(f.end).toBe('invalid')
    expect(f.endPos).toEqual({ x: 0, y: 0 })
  })
})
