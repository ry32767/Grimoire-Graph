import { describe, it, expect } from 'vitest'
import {
  scaleOf,
  toScreen,
  toMath,
  rotate,
  dist,
  sampleTrajectory,
  validPrefix,
  buildPolyline,
  polylineLength,
  pointAtLength,
  type Viewport,
} from './coords'
import { FIELD } from '../data/constants'
import type { Trajectory } from './types'

const vp: Viewport = { width: 600, height: 400, unitsRadius: FIELD.rField }

describe('座標変換', () => {
  it('原点は画面中央に対応する', () => {
    const s = toScreen({ x: 0, y: 0 }, vp)
    expect(s).toEqual({ x: 300, y: 200 })
  })

  it('toScreen と toMath は往復する', () => {
    const p = { x: 3.5, y: -2.1 }
    const back = toMath(toScreen(p, vp), vp)
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })

  it('y は上下反転する（数学の上 = 画面の上）', () => {
    const s = scaleOf(vp)
    const up = toScreen({ x: 0, y: 1 }, vp)
    expect(up.y).toBeCloseTo(200 - s, 6)
  })
})

describe('回転', () => {
  it('90度回転で (1,0) → (0,1)', () => {
    const r = rotate({ x: 1, y: 0 }, Math.PI / 2)
    expect(r.x).toBeCloseTo(0, 6)
    expect(r.y).toBeCloseTo(1, 6)
  })
})

describe('軌道サンプリング（回転 y=g(x)）', () => {
  const line: Trajectory = { mode: 'rotate', g: (x) => x, angle: 0 }

  it('y=x は対角線上の点を生成する', () => {
    const samples = sampleTrajectory(line)
    expect(samples[0].pos).toEqual({ x: 0, y: 0 })
    const mid = samples.find((s) => Math.abs(s.param - 2) < 1e-6)
    expect(mid?.pos.x).toBeCloseTo(2, 6)
    expect(mid?.pos.y).toBeCloseTo(2, 6)
  })

  it('場外（|pos|>R_field）の点は inField=false', () => {
    const samples = sampleTrajectory(line)
    const outer = samples.find((s) => dist(s.pos) > FIELD.rField)
    expect(outer?.inField).toBe(false)
  })
})

describe('暴発につながる無効点の検出', () => {
  it('1/x は原点(param 0)で発散し valid=false → 有効プレフィックスが空', () => {
    const recip: Trajectory = { mode: 'rotate', g: (x) => 1 / x, angle: 0 }
    const samples = sampleTrajectory(recip)
    expect(samples[0].valid).toBe(false) // 1/0 = Infinity
    expect(validPrefix(samples).length).toBe(0)
  })
})

describe('ポリラインと弧長', () => {
  const line: Trajectory = { mode: 'rotate', g: () => 0, angle: 0 } // x 軸方向

  it('y=0 の軌道は x 軸に沿った直線で、弧長＝x', () => {
    const poly = buildPolyline(sampleTrajectory(line))
    expect(poly[0].pos).toEqual({ x: 0, y: 0 })
    // 場内の最後の点はおよそ R_field
    expect(polylineLength(poly)).toBeGreaterThan(FIELD.rField - 0.2)
    expect(polylineLength(poly)).toBeLessThanOrEqual(FIELD.rField + 1e-6)
  })

  it('pointAtLength は弧長 s の位置を返す', () => {
    const poly = buildPolyline(sampleTrajectory(line))
    const at = pointAtLength(poly, 5)
    expect(at.pos.x).toBeCloseTo(5, 4)
    expect(at.pos.y).toBeCloseTo(0, 4)
    expect(at.atEnd).toBe(false)
  })

  it('s が総長以上なら atEnd=true', () => {
    const poly = buildPolyline(sampleTrajectory(line))
    const at = pointAtLength(poly, 9999)
    expect(at.atEnd).toBe(true)
  })
})

describe('極座標サンプリング', () => {
  it('円 r=5 は半径5の点を生成', () => {
    const circle: Trajectory = { mode: 'polar', f: () => 5 }
    const samples = sampleTrajectory(circle)
    for (const s of samples.slice(0, 50)) {
      expect(dist(s.pos)).toBeCloseTo(5, 6)
    }
  })
})
