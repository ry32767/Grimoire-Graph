import { describe, it, expect } from 'vitest'
import { isSolidAt, carveSpeedLoss, carveRadius } from './obstacle'
import { COMBAT } from '../data/constants'
import type { Obstacle } from './types'

const blob = (): Obstacle => ({
  id: 'o1',
  element: 'light',
  solids: [{ x: 0, y: 0, r: 3 }],
  carves: [],
})

describe('障害物の素材判定（solids − carves）', () => {
  it('solid 円の中は素材', () => {
    expect(isSolidAt(blob(), { x: 1, y: 0 })).toBe(true)
  })

  it('solid 円の外は素材でない', () => {
    expect(isSolidAt(blob(), { x: 5, y: 0 })).toBe(false)
  })

  it('えぐられた円（carve）の中は素材でない＝穴', () => {
    const ob: Obstacle = { ...blob(), carves: [{ x: 0, y: 0, r: 1.5 }] }
    expect(isSolidAt(ob, { x: 0, y: 0 })).toBe(false) // 穴の中
    expect(isSolidAt(ob, { x: 2.5, y: 0 })).toBe(true) // 穴の外だが solid 内
  })
})

describe('障害物の削りコスト（§3.7・#1/#16）', () => {
  it('反対極ほど安く削れる（貫通しやすい）', () => {
    expect(carveSpeedLoss('dark', 'light')).toBeLessThan(carveSpeedLoss('light', 'light'))
  })

  it('中立は反対極と同極の中間', () => {
    const opposite = carveSpeedLoss('dark', 'light')
    const neutral = carveSpeedLoss('neutral', 'light')
    const same = carveSpeedLoss('light', 'light')
    expect(neutral).toBeGreaterThan(opposite)
    expect(neutral).toBeLessThan(same)
  })
})

describe('えぐり取る半径（威力依存・#1）', () => {
  it('威力が高いほど半径が大きい', () => {
    expect(carveRadius(60)).toBeGreaterThan(carveRadius(20))
  })

  it('最大半径でキャップされる', () => {
    expect(carveRadius(99999)).toBe(COMBAT.carveMaxRadius)
  })

  it('威力0でも負にはならない', () => {
    expect(carveRadius(0)).toBe(0)
    expect(carveRadius(-10)).toBe(0)
  })
})
