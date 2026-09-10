import { describe, expect, it } from 'vitest'
import { drawCastSigil, drawSpellImpact, drawSpellWake } from './spellfx'
import { type Viewport } from '../game/coords'

const vp: Viewport = { width: 240, height: 240, unitsRadius: 30 }
const pos = { x: 0, y: 0 }
type Rect = { x: number; y: number; w: number; h: number; color: string; alpha: number }
function recordingContext() {
  const rects: Rect[] = []
  const stack: { fillStyle: string; globalAlpha: number }[] = []
  const ctx = {
    fillStyle: 'initial', globalAlpha: 0.3,
    save() { stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha }) },
    restore() { Object.assign(this, stack.pop()) },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, color: this.fillStyle, alpha: this.globalAlpha })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, stack }
}

describe('魔法陣・着弾の有限なドット演出', () => {
  it.each([-1, 1, 2, NaN])('progress=%s は描画しない', (progress) => {
    const { ctx, rects } = recordingContext()
    drawCastSigil(ctx, vp, pos, 3, progress)
    drawSpellImpact(ctx, vp, pos, progress, -3, 1)
    expect(rects).toEqual([])
  })

  it('同時刻では全く同じ粒配置になり、Canvasの色と不透明度を復元する', () => {
    for (const z of [-3, 0, 3]) {
      const a = recordingContext(), b = recordingContext()
      for (const record of [a, b]) {
        drawCastSigil(record.ctx, vp, pos, z, 0.25)
        drawSpellImpact(record.ctx, vp, pos, 0.45, z, 0.8)
        expect(record.ctx.fillStyle).toBe('initial')
        expect(record.ctx.globalAlpha).toBe(0.3)
        expect(record.stack).toHaveLength(0)
        expect(record.rects.length).toBeGreaterThan(30)
        expect(record.rects.length).toBeLessThan(350)
        for (const rect of record.rects) {
          expect([rect.x, rect.y, rect.w, rect.h].every(Number.isInteger)).toBe(true)
          expect(Math.max(rect.w, rect.h)).toBeLessThanOrEqual(4)
        }
      }
      expect(a.rects).toEqual(b.rects)
    }
  })

  it('威力が上がると着弾が広がるが局所の55px程度に収まる', () => {
    const low = recordingContext(), high = recordingContext()
    drawSpellImpact(low.ctx, vp, pos, 0.95, 3, 0)
    drawSpellImpact(high.ctx, vp, pos, 0.95, 3, 1)
    const extent = (rects: Rect[]) => Math.max(...rects.map((r) => Math.hypot(r.x + r.w / 2 - 120, r.y + r.h / 2 - 120)))
    expect(extent(high.rects)).toBeGreaterThan(extent(low.rects))
    expect(extent(high.rects)).toBeLessThanOrEqual(56)
  })

  it('尾は現在idxより先のサンプルを読み取らず、状態を復元する', () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ pos: { x: i, y: 0 }, z: -3 }))
    Object.defineProperty(points, 7, { get() { throw new Error('未来のサンプル') } })
    const { ctx, rects, stack } = recordingContext()
    drawSpellWake(ctx, vp, points, 6, 1.5, 0.8)
    expect(rects.length).toBeGreaterThan(0)
    expect(stack).toHaveLength(0)
    expect(ctx.fillStyle).toBe('initial')
    expect(ctx.globalAlpha).toBe(0.3)
  })
})
