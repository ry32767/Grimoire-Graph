import { describe, it, expect } from 'vitest'
import { isSolidAt, carveSpeedLoss, carveRadius, obstacleOverlapsCircle, materialCells } from './obstacle'
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

describe('四角い壁（矩形素材・#56）', () => {
  // 左下 (0,0)・幅10・高さ4 の四角い壁
  const rectWall = (): Obstacle => ({ id: 'r1', element: 'neutral', solids: [], rects: [{ x: 0, y: 0, w: 10, h: 4 }], carves: [] })

  it('矩形の内側は素材、外側は素材でない（角もシャープ）', () => {
    expect(isSolidAt(rectWall(), { x: 5, y: 2 })).toBe(true)
    expect(isSolidAt(rectWall(), { x: 0, y: 0 })).toBe(true) // 角
    expect(isSolidAt(rectWall(), { x: 10, y: 4 })).toBe(true) // 対角
    expect(isSolidAt(rectWall(), { x: -0.01, y: 2 })).toBe(false) // 左外
    expect(isSolidAt(rectWall(), { x: 5, y: 4.01 })).toBe(false) // 上外
  })

  it('矩形でも carve（穴）でくり抜ける', () => {
    const ob: Obstacle = { ...rectWall(), carves: [{ x: 5, y: 2, r: 1 }] }
    expect(isSolidAt(ob, { x: 5, y: 2 })).toBe(false) // 穴の中
    expect(isSolidAt(ob, { x: 8, y: 2 })).toBe(true) // 穴の外だが矩形内
  })

  it('obstacleOverlapsCircle：矩形に重なる円だけ true（最近接点で判定）', () => {
    expect(obstacleOverlapsCircle(rectWall(), { x: 5, y: 2 }, 1)).toBe(true) // 内側
    expect(obstacleOverlapsCircle(rectWall(), { x: 12, y: 2 }, 2.5)).toBe(true) // 右に2だけ離れ、半径2.5で接触
    expect(obstacleOverlapsCircle(rectWall(), { x: 20, y: 2 }, 2)).toBe(false) // 遠い
  })

  it('materialCells：矩形は格子状の代表点に展開される（破片演出用）', () => {
    const cells = materialCells(rectWall())
    expect(cells.length).toBeGreaterThan(0)
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThanOrEqual(10)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeLessThanOrEqual(4)
    }
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

describe('壁の種別ごとの削れやすさ（#40）', () => {
  it('えぐり半径：fragile > normal > tough、unbreakable は 0', () => {
    const p = 60
    expect(carveRadius(p, 'fragile')).toBeGreaterThan(carveRadius(p, 'normal'))
    expect(carveRadius(p, 'normal')).toBeGreaterThan(carveRadius(p, 'tough'))
    expect(carveRadius(p, 'tough')).toBeGreaterThan(0)
    expect(carveRadius(p, 'unbreakable')).toBe(0)
  })

  it('速度損：tough > normal > fragile（頑丈ほど止まりやすい）', () => {
    const loss = (k: Parameters<typeof carveSpeedLoss>[2]) => carveSpeedLoss('neutral', 'neutral', k)
    expect(loss('tough')).toBeGreaterThan(loss('normal'))
    expect(loss('normal')).toBeGreaterThan(loss('fragile'))
  })

  it('種別を省略すると normal と同じ（後方互換）', () => {
    expect(carveRadius(60)).toBe(carveRadius(60, 'normal'))
    expect(carveSpeedLoss('dark', 'light')).toBe(carveSpeedLoss('dark', 'light', 'normal'))
  })
})
