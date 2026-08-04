// 作図台（関数空間の方眼紙）の描画。React に依存しない純粋な描画関数（#67）。
// 盤面ではないので、横軸は「射線方向の距離」、縦軸は y（または z）。結界 r=f(θ) だけは輪として描く。
import { SAMPLING } from '../data/constants'
import type { Vec2 } from '../game/types'

export const PAD_W = 520
export const PAD_H = 216
export const PAD_TMAX = SAMPLING.rotateXMax
export const PAD_Y_RANGE = 12

export interface PadGeo {
  ox: number
  oy: number
  sx: number
  sy: number
}

export function padGeo(): PadGeo {
  return { ox: 22, oy: PAD_H / 2, sx: (PAD_W - 34) / PAD_TMAX, sy: (PAD_H - 26) / (PAD_Y_RANGE * 2) }
}

/**
 * 結界（極座標）の「1ユニット＝何 px」。方眼紙の縦目盛りと同じ尺度を使うので、
 * r=6 → r=9 のように半径だけを変えても輪の大きさがちゃんと変わる（#67）。
 * 大きすぎる結界だけは枠に収まるよう縮める。
 */
export function polarScale(rmax: number): number {
  const g = padGeo()
  const fit = (Math.min(PAD_W, PAD_H) * 0.42) / Math.max(rmax, 0.01)
  return Math.min(g.sy, fit)
}

export interface PadDraw {
  /** 編集中の関数。結界なら r=f(θ)、それ以外は y=f(x)／z=g(t) */
  f: ((v: number) => number) | null
  /** 結界（極座標 r=f(θ)）か */
  barrier: boolean
  /** z を編集中か（線の色が変わる） */
  onZ: boolean
  /** 射線上の的までの距離 r（縦の破線） */
  rDistance: number
  /** 点モードで打った点（格子点） */
  points: Vec2[]
  /** 多項式フィットの係数（低次→高次・破線）。無ければ null */
  fitted: number[] | null
}

/** 方眼紙・軸・目盛り・r の破線。 */
function drawGrid(ctx: CanvasRenderingContext2D, g: PadGeo, rDistance: number): void {
  const X = (x: number) => g.ox + x * g.sx
  const Y = (y: number) => g.oy - y * g.sy
  ctx.fillStyle = 'rgba(125,143,196,.22)'
  for (let x = 0; x <= PAD_TMAX; x += 2) {
    for (let y = -PAD_Y_RANGE; y <= PAD_Y_RANGE; y += 2) ctx.fillRect(X(x) - 1, Y(y) - 1, 2, 2)
  }
  ctx.strokeStyle = 'rgba(150,162,196,.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(X(0), Y(0))
  ctx.lineTo(X(PAD_TMAX), Y(0))
  ctx.moveTo(X(0), Y(-PAD_Y_RANGE))
  ctx.lineTo(X(0), Y(PAD_Y_RANGE))
  ctx.stroke()
  ctx.fillStyle = 'rgba(150,162,196,.6)'
  ctx.font = '9px monospace'
  ctx.textAlign = 'center'
  for (let x = 10; x <= 40; x += 10) {
    ctx.fillRect(X(x), Y(0) - 3, 1, 6)
    ctx.fillText(String(x), X(x), Y(0) + 13)
  }
  if (rDistance <= PAD_TMAX) {
    ctx.strokeStyle = 'rgba(244,196,48,.45)'
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(X(rDistance), Y(-PAD_Y_RANGE))
    ctx.lineTo(X(rDistance), Y(PAD_Y_RANGE))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,243,196,.8)'
    ctx.textAlign = 'left'
    ctx.fillText('r', X(rDistance) + 3, Y(PAD_Y_RANGE - 1))
  }
}

/** 結界 r=f(θ) を輪として描く（尺度は固定・#67）。 */
function drawBarrier(ctx: CanvasRenderingContext2D, f: (v: number) => number): void {
  const cx = PAD_W / 2
  const cy = PAD_H / 2
  const poly: { a: number; r: number }[] = []
  let rmax = 0
  let rmin = Number.POSITIVE_INFINITY
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2
    const rr = f(a)
    const v = Number.isFinite(rr) ? Math.abs(rr) : 0
    poly.push({ a, r: v })
    if (v > rmax) rmax = v
    if (v < rmin) rmin = v
  }
  if (!(rmax > 0.01)) return
  const sc = polarScale(rmax)
  // 目安の同心円（半径がひと目で分かるように）
  ctx.strokeStyle = 'rgba(125,143,196,.20)'
  ctx.lineWidth = 1
  for (let r = 4; r <= 16; r += 4) {
    if (r * sc > Math.min(PAD_W, PAD_H) * 0.46) break
    ctx.beginPath()
    ctx.arc(cx, cy, r * sc, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(244,196,48,.95)'
  ctx.lineWidth = 2.2
  ctx.beginPath()
  poly.forEach((p, i) => {
    const px = cx + Math.cos(p.a) * p.r * sc
    const py = cy - Math.sin(p.a) * p.r * sc
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = 'rgba(244,196,48,.10)'
  ctx.fill()
  ctx.fillStyle = 'rgba(255,243,196,.8)'
  ctx.font = '9px monospace'
  ctx.textAlign = 'left'
  ctx.fillText(`半径 ${rmin.toFixed(1)}〜${rmax.toFixed(1)} ・ 同心円は 4 きざみ`, 8, 14)
}

/** 編集中の式そのもののグラフ。 */
function drawCurve(ctx: CanvasRenderingContext2D, g: PadGeo, f: (v: number) => number, onZ: boolean): void {
  const X = (x: number) => g.ox + x * g.sx
  const Y = (y: number) => g.oy - y * g.sy
  ctx.strokeStyle = onZ ? 'rgba(138,111,214,.95)' : 'rgba(244,196,48,.95)'
  ctx.lineWidth = 2.2
  ctx.beginPath()
  let started = false
  for (let x = 0; x <= PAD_TMAX; x += 0.25) {
    const y = f(x)
    if (!Number.isFinite(y) || Math.abs(y) > 60) {
      started = false
      continue
    }
    const px = X(x)
    const py = Y(y)
    if (!started) {
      ctx.moveTo(px, py)
      started = true
    } else ctx.lineTo(px, py)
  }
  ctx.stroke()
}

/** 作図台をまるごと描く。 */
export function drawDraftPad(ctx: CanvasRenderingContext2D, d: PadDraw): void {
  const g = padGeo()
  const X = (x: number) => g.ox + x * g.sx
  const Y = (y: number) => g.oy - y * g.sy
  ctx.clearRect(0, 0, PAD_W, PAD_H)
  ctx.fillStyle = '#07070f'
  ctx.fillRect(0, 0, PAD_W, PAD_H)
  drawGrid(ctx, g, d.rDistance)

  if (d.f) {
    if (d.barrier) drawBarrier(ctx, d.f)
    else drawCurve(ctx, g, d.f, d.onZ)
  }

  // 多項式フィットの曲線（破線）
  if (d.fitted) {
    ctx.strokeStyle = 'rgba(255,255,255,.75)'
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let x = 0; x <= PAD_TMAX; x += 0.4) {
      let y = 0
      for (let i = 0; i < d.fitted.length; i++) y += d.fitted[i] * Math.pow(x, i)
      if (!Number.isFinite(y)) break
      if (x === 0) ctx.moveTo(X(0), Y(y))
      else ctx.lineTo(X(x), Y(y))
    }
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 打った点
  for (const p of d.points) {
    ctx.fillStyle = '#fff3c4'
    ctx.fillRect(X(p.x) - 3.5, Y(p.y) - 3.5, 7, 7)
    ctx.fillStyle = '#0a0a12'
    ctx.fillRect(X(p.x) - 1.5, Y(p.y) - 1.5, 3, 3)
  }
}
