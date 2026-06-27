import { describe, it, expect } from 'vitest'
import { segmentCircleHit, firstHit, firstHitAmong } from './collision'
import { simulateFlight } from './physics'
import type { FlightSample, Trajectory } from './types'

// x 軸上を速度一定で進むサンプル列を作る
function lineSamples(): FlightSample[] {
  const out: FlightSample[] = []
  for (let x = 0; x <= 10; x += 1) out.push({ pos: { x, y: 0 }, speed: 5, arcLen: x, param: x })
  return out
}

describe('線分と円の交差', () => {
  it('円を貫く線分は交差 t を返す', () => {
    const t = segmentCircleHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 1)
    expect(t).not.toBeNull()
    expect(t!).toBeCloseTo(0.4, 6) // x=4 で接触
  })

  it('外れる線分は null', () => {
    const t = segmentCircleHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, 1)
    expect(t).toBeNull()
  })

  it('始点が円内なら 0', () => {
    const t = segmentCircleHit({ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 1)
    expect(t).toBe(0)
  })
})

describe('飛行サンプルの命中判定', () => {
  it('ヒットボックスに最初に触れる点を返す', () => {
    const h = firstHit(lineSamples(), { x: 5, y: 0 }, 1)
    expect(h).not.toBeNull()
    expect(h!.pos.x).toBeCloseTo(4, 6)
    expect(h!.speed).toBeCloseTo(5, 6)
  })

  it('どの対象にも当たらなければ null（外れ）', () => {
    const h = firstHit(lineSamples(), { x: 5, y: 9 }, 1)
    expect(h).toBeNull()
  })

  it('複数対象では最も手前を選ぶ', () => {
    const hit = firstHitAmong(lineSamples(), [
      { id: 'far', pos: { x: 8, y: 0 }, radius: 1 },
      { id: 'near', pos: { x: 3, y: 0 }, radius: 1 },
    ])
    expect(hit?.id).toBe('near')
  })
})

describe('回転/極座標で一貫した当たり判定', () => {
  it('回転（直線）と極座標（円）どちらも (5,0) の対象に当たる', () => {
    const rot: Trajectory = { mode: 'rotate', g: () => 0, angle: 0 } // +x 方向
    const pol: Trajectory = { mode: 'polar', f: () => 5 } // 半径5の円
    const rotFlight = simulateFlight(rot, 5)
    const polFlight = simulateFlight(pol, 5)
    expect(firstHit(rotFlight.samples, { x: 5, y: 0 }, 0.6)).not.toBeNull()
    expect(firstHit(polFlight.samples, { x: 5, y: 0 }, 0.6)).not.toBeNull()
  })
})
