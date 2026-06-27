import { describe, it, expect } from 'vitest'
import { isLoop, classifyTrajectory } from './loop'
import type { Trajectory } from './types'

describe('ループ判定（#12：発射型/軌道型）', () => {
  it('回転 y=g(x) は常に開＝発射型', () => {
    const line: Trajectory = { mode: 'rotate', g: (x) => x, angle: 0 }
    expect(isLoop(line)).toBe(false)
    expect(classifyTrajectory(line)).toBe('projectile')
    const para: Trajectory = { mode: 'rotate', g: (x) => 0.3 * x * x - 2, angle: 0 }
    expect(classifyTrajectory(para)).toBe('projectile')
  })

  it('円 r=R は閉曲線＝軌道型', () => {
    const circle: Trajectory = { mode: 'polar', f: () => 6 }
    expect(isLoop(circle)).toBe(true)
    expect(classifyTrajectory(circle)).toBe('orbit')
  })

  it('バラ曲線・リマソンは軌道型', () => {
    const rose: Trajectory = { mode: 'polar', f: (t) => 8 * Math.cos(4 * t) }
    const limacon: Trajectory = { mode: 'polar', f: (t) => 4 + 4 * Math.cos(t) }
    expect(classifyTrajectory(rose)).toBe('orbit')
    expect(classifyTrajectory(limacon)).toBe('orbit')
  })

  it('らせん r=a·θ は開＝発射型', () => {
    const spiral: Trajectory = { mode: 'polar', f: (t) => 1 * t }
    expect(isLoop(spiral)).toBe(false)
    expect(classifyTrajectory(spiral)).toBe('projectile')
  })
})
