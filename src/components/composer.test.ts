import { describe, it, expect } from 'vitest'
import { computePreview } from './composer'
import type { Obstacle, Trajectory } from '../game/types'
import { FIELD } from '../data/constants'

// 原点から +x へまっすぐ進む光弾。減速しない zRef（|z|>zRef は失速して停止位置が壁と無関係になるため・#31）
const straight: Trajectory = { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: () => FIELD.zRef }
// x≈6〜14 を塞ぐ闇の壁
const wall: Obstacle = {
  id: 'w',
  element: 'dark',
  solids: [
    { x: 8, y: 0, r: 2 },
    { x: 10, y: 0, r: 2 },
    { x: 12, y: 0, r: 2 },
  ],
  carves: [],
}

describe('プレビューの障害物クリップ（壁すり抜け表示の防止）', () => {
  it('壁に阻まれる弾の予測軌道は壁の手前/内部で止まり、障害物なしより短い', () => {
    const open = computePreview(straight, 6, [])
    const blocked = computePreview(straight, 6, [wall])
    const lastOpen = open.path[open.path.length - 1].pos.x
    const lastBlocked = blocked.path[blocked.path.length - 1].pos.x
    expect(open.path.length).toBeGreaterThan(0)
    expect(blocked.path.length).toBeGreaterThan(0)
    // 壁で止まる＝予測線が壁を抜けきらない（素通りしない）
    expect(lastBlocked).toBeLessThan(lastOpen)
    expect(lastBlocked).toBeLessThan(14)
  })

  it('障害物が無ければ従来どおり全経路を予測する', () => {
    const open = computePreview(straight, 6, [])
    const noObs = computePreview(straight, 6)
    expect(noObs.path.length).toBe(open.path.length)
  })
})
