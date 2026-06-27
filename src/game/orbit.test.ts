import { describe, it, expect } from 'vitest'
import { buildRing, orbitSweep, ringInterception, type OrbitTarget } from './orbit'
import { dist } from './coords'
import type { Trajectory } from './types'
import { FIELD } from '../data/constants'

// 半径6の円・z 場は一定 zPeak(=5・光・最強)。経路と属性は別物（#30）。
const circle: Trajectory = { mode: 'polar', f: () => 6, z: () => FIELD.zPeak }

describe('リング生成（軌道型の周回）', () => {
  it('円 r=6 のリングは半径6・z=zPeak（光）', () => {
    const ring = buildRing(circle)
    expect(ring.length).toBeGreaterThan(20)
    for (const p of ring.slice(0, 30)) {
      expect(dist(p.pos)).toBeCloseTo(6, 4)
      expect(p.z).toBeCloseTo(FIELD.zPeak, 6)
    }
  })
})

describe('掃射（攻撃・#4/#12）', () => {
  const targets: OrbitTarget[] = [
    { id: 'on', pos: { x: 6, y: 0 }, radius: 1, element: 'dark' }, // リング上
    { id: 'off', pos: { x: 15, y: 0 }, radius: 1, element: 'dark' }, // 遠い
  ]
  it('リングに触れた敵だけにダメージ（反対極は×1.5）', () => {
    const hits = orbitSweep(buildRing(circle), 5, targets)
    const ids = hits.map((h) => h.id)
    expect(ids).toContain('on')
    expect(ids).not.toContain('off')
    const on = hits.find((h) => h.id === 'on')!
    expect(on.damage).toBeCloseTo(5 * 5 * 1.5, 4) // 速度5×強度5(ピーク)×相性1.5
  })
})

describe('迎撃（防御・#4）', () => {
  it('敵弾がリング境界を横切れば迎撃する', () => {
    const enemyPath = [
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]
    const r = ringInterception(buildRing(circle), enemyPath)
    expect(r.crossed).toBe(true)
    expect(dist(r.pos!)).toBeCloseTo(6, 1)
  })

  it('リング内側で完結する敵弾は横切らない', () => {
    const inside = [
      { x: 3, y: 0 },
      { x: 0, y: 0 },
    ]
    expect(ringInterception(buildRing(circle), inside).crossed).toBe(false)
  })
})
