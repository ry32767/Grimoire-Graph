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

  // バグ修正：同一直線上を逆走して正面衝突する2線分（collinear・anti-parallel）を拾えなかった
  it('同一直線上で逆向きに重なる線分は重なり中点を交点とする（正面撃ち返し）', () => {
    const hit = segmentIntersect({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 })
    expect(hit).not.toBeNull()
    expect(hit?.point.x).toBeCloseTo(0, 6)
    expect(hit?.point.y).toBeCloseTo(0, 6)
  })

  it('同一直線だが区間が離れて重ならない平行線分は null', () => {
    expect(segmentIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 })).toBeNull()
  })

  it('同一直線でない平行線分（並走）は null', () => {
    expect(segmentIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 })).toBeNull()
  })

  it('横向きに逆走する2パスは重なり区間の中点で合流する（firstCrossing）', () => {
    // 味方 -12→+12 と敵 +12→-12 が同一直線上を逆走。重なり [-12,12] の中点 0 で合流。
    const meet = firstCrossing(
      [{ x: -12, y: 0 }, { x: 12, y: 0 }],
      [{ x: 12, y: 0 }, { x: -12, y: 0 }],
    )
    expect(meet).not.toBeNull()
    expect(meet?.pos.x).toBeCloseTo(0, 6)
    expect(meet?.pos.y).toBeCloseTo(0, 6)
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

  it('威力の引き算：勝った側は残威力（powerA−powerB）を速度に換算して引き継ぐ', () => {
    // A: 速度10・強度3（威力30） vs B: 速度10・強度2（威力20）
    // → A が勝ち、新威力 = 30−20 = 10。強度3は位置で不変なので新速度 = 10/3
    const r = resolveParry('light', 10, 30, 'dark', 10, 20)
    expect(r.vanishB).toBe(true)
    expect(r.vanishA).toBe(false)
    expect(r.speedA).toBeCloseTo(10 / 3, 6)
    expect(r.speedB).toBe(0)
  })

  it('パリィが発生したら必ずどちらかは消滅する（反対極で両方残ることはない）', () => {
    const cases: [number, number, number, number][] = [
      [8, 20, 6, 15],
      [10, 5, 10, 40],
      [3, 3, 3, 3],
    ]
    for (const [sA, pA, sB, pB] of cases) {
      const r = resolveParry('light', sA, pA, 'dark', sB, pB)
      expect(r.passthrough).toBe(false)
      expect(r.vanishA || r.vanishB).toBe(true)
    }
  })
})
