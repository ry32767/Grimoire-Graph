import { describe, it, expect } from 'vitest'
import { segmentIntersect, firstCrossing, resolveParry } from './parry'

describe('交差判定', () => {
  it('交差する線分は交点を返す', () => {
    const hit = segmentIntersect({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 })
    expect(hit?.point.x).toBeCloseTo(0, 6)
    expect(hit?.point.y).toBeCloseTo(0, 6)
  })

  it('交差しない線分は null', () => {
    expect(segmentIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull()
  })

  it('2パスの最初の交差を返す', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]
    const b = [
      { x: 2, y: -1 },
      { x: 2, y: 1 },
    ]
    const c = firstCrossing(a, b)
    expect(c?.pos.x).toBeCloseTo(2, 6)
  })
})

describe('パリィ解決（§3.8）', () => {
  it('同極（光×光）はすり抜け、速度そのまま', () => {
    const r = resolveParry('light', 8, 20, 'light', 6, 15)
    expect(r.passthrough).toBe(true)
    expect(r.speedA).toBe(8)
    expect(r.speedB).toBe(6)
  })

  it('一方が中立ならすり抜け', () => {
    const r = resolveParry('neutral', 8, 20, 'dark', 6, 15)
    expect(r.passthrough).toBe(true)
  })

  it('反対極（光×闇）は速度を削り合う', () => {
    const r = resolveParry('light', 8, 20, 'dark', 6, 15)
    expect(r.passthrough).toBe(false)
    expect(r.speedA).toBeLessThan(8)
    expect(r.speedB).toBeLessThan(6)
  })

  it('速度0になった側は消滅。撃ち勝てば相手だけ消える', () => {
    // A の威力が大きく B を消滅させ、A は生き残る
    const r = resolveParry('light', 10, 100, 'dark', 3, 1)
    expect(r.vanishB).toBe(true)
    expect(r.vanishA).toBe(false)
    expect(r.speedA).toBeGreaterThan(0)
  })

  it('両者0なら完全相殺', () => {
    const r = resolveParry('light', 2, 100, 'dark', 2, 100)
    expect(r.vanishA).toBe(true)
    expect(r.vanishB).toBe(true)
  })
})
