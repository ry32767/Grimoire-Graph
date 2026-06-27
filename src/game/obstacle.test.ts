import { describe, it, expect } from 'vitest'
import {
  obstacleSpeedLoss,
  obstacleDurabilityDamage,
  applyObstacleHit,
} from './obstacle'
import type { Obstacle } from './types'

const obstacle = (durability: number): Obstacle => ({
  id: 'o1',
  pos: { x: 5, y: 0 },
  hitboxRadius: 1,
  element: 'light',
  durability,
  maxDurability: durability,
})

describe('障害物の速度損（§3.7）', () => {
  it('反対極ほど速度損が小さい（貫通しやすい）', () => {
    const opposite = obstacleSpeedLoss('dark', 'light') // 反対極
    const same = obstacleSpeedLoss('light', 'light') // 同極
    expect(opposite).toBeLessThan(same)
  })
})

describe('障害物耐久の削り（極性相性）', () => {
  it('反対極ほど耐久を大きく削る', () => {
    const opposite = obstacleDurabilityDamage(10, 'dark', 'light')
    const same = obstacleDurabilityDamage(10, 'light', 'light')
    expect(opposite).toBeGreaterThan(same)
  })
})

describe('障害物衝突の解決（破壊／貫通）', () => {
  it('耐久を削り、速度損を返す', () => {
    const r = applyObstacleHit(obstacle(100), 10, 'dark')
    expect(r.obstacle.durability).toBeLessThan(100)
    expect(r.speedLoss).toBeGreaterThan(0)
    expect(r.destroyed).toBe(false)
  })

  it('耐久0で破壊され、以後は素通り（速度損0）', () => {
    const r1 = applyObstacleHit(obstacle(5), 100, 'dark') // 大威力で破壊
    expect(r1.destroyed).toBe(true)
    expect(r1.obstacle.durability).toBe(0)
    const r2 = applyObstacleHit(r1.obstacle, 100, 'dark') // 破壊済み
    expect(r2.speedLoss).toBe(0)
  })
})
