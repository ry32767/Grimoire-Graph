// 作図台（関数空間の方眼紙）の描画。React に依存しない純粋な描画関数（#67）。
// 盤面ではない。軌道 y=f(x) は「横軸＝射線方向の距離」、結界 r=f(θ) は「横軸＝角度 θ」として、
// どちらも**同じ普通のグラフ**として描く（輪では点を打てず、係数も読み取りにくいため・#68）。
import { SAMPLING } from '../data/constants'
import type { Vec2 } from '../game/types'

export const PAD_W = 520
export const PAD_H = 216
export const PAD_TMAX = SAMPLING.rotateXMax
export const PAD_Y_RANGE = 12

/** 横軸の目盛りづけ。y（距離）と結界（角度 θ）で切り替える。 */
export interface PadAxis {
  /** 横軸の最大値 */
  max: number
  /** 方眼の点を打つ間隔 */
  dot: number
  /** 目盛りラベル */
  ticks: { at: number; text: string }[]
  /** 打つ点を吸着させる刻み */
  snap: number
  /** 軸の説明（作図台の下の一行） */
  note: string
}

export const AXIS_DISTANCE: PadAxis = {
  max: PAD_TMAX,
  dot: 2,
  ticks: [10, 20, 30, 40].map((v) => ({ at: v, text: String(v) })),
  snap: 1,
  note: '横軸 = 射線方向の距離 ・ 点は格子点に吸着する（敵は格子に乗らない）',
}

export const AXIS_THETA: PadAxis = {
  max: Math.PI * 2,
  dot: Math.PI / 8,
  ticks: [
    { at: Math.PI / 2, text: 'π/2' },
    { at: Math.PI, text: 'π' },
    { at: (Math.PI * 3) / 2, text: '3π/2' },
    { at: Math.PI * 2, text: '2π' },
  ],
  snap: Math.PI / 8,
  note: '横軸 = 角度 θ（0〜2π）・縦軸 = 半径 r ・ 点は π/8 きざみに吸着する',
}

export interface PadGeo {
  ox: number
  oy: number
  sx: number
  sy: number
}

export function padGeo(axis: PadAxis): PadGeo {
  return { ox: 22, oy: PAD_H / 2, sx: (PAD_W - 34) / axis.max, sy: (PAD_H - 26) / (PAD_Y_RANGE * 2) }
}

export interface PadDraw {
  axis: PadAxis
  /** 編集中の関数。y=f(x)／z=g(t)／結界 r=f(θ) */
  f: ((v: number) => number) | null
  /** 線の色を紫にする（z を編集中） */
  onZ: boolean
  /** 射線上の的までの距離 r（縦の破線）。角度軸では意味がないので null */
  rDistance: number | null
  /** 点モードで打った点 */
  points: Vec2[]
  /** 多項式フィットの係数（低次→高次・破線）。無ければ null */
  fitted: number[] | null
}

/** 方眼紙・軸・目盛り・r の破線。 */
function drawGrid(ctx: CanvasRenderingContext2D, g: PadGeo, axis: PadAxis, rDistance: number | null): void {
  const X = (x: number) => g.ox + x * g.sx
  const Y = (y: number) => g.oy - y * g.sy
  ctx.fillStyle = 'rgba(125,143,196,.22)'
  for (let x = 0; x <= axis.max + 1e-9; x += axis.dot) {
    for (let y = -PAD_Y_RANGE; y <= PAD_Y_RANGE; y += 2) ctx.fillRect(X(x) - 1, Y(y) - 1, 2, 2)
  }
  ctx.strokeStyle = 'rgba(150,162,196,.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(X(0), Y(0))
  ctx.lineTo(X(axis.max), Y(0))
  ctx.moveTo(X(0), Y(-PAD_Y_RANGE))
  ctx.lineTo(X(0), Y(PAD_Y_RANGE))
  ctx.stroke()
  ctx.fillStyle = 'rgba(150,162,196,.6)'
  ctx.font = '9px monospace'
  ctx.textAlign = 'center'
  for (const t of axis.ticks) {
    ctx.fillRect(X(t.at), Y(0) - 3, 1, 6)
    ctx.fillText(t.text, X(t.at), Y(0) + 13)
  }
  if (rDistance !== null && rDistance <= axis.max) {
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

/** 編集中の式そのもののグラフ。 */
function drawCurve(
  ctx: CanvasRenderingContext2D,
  g: PadGeo,
  axis: PadAxis,
  f: (v: number) => number,
  onZ: boolean,
): void {
  const X = (x: number) => g.ox + x * g.sx
  const Y = (y: number) => g.oy - y * g.sy
  const step = axis.max / 200
  ctx.strokeStyle = onZ ? 'rgba(138,111,214,.95)' : 'rgba(244,196,48,.95)'
  ctx.lineWidth = 2.2
  ctx.beginPath()
  let started = false
  for (let x = 0; x <= axis.max + 1e-9; x += step) {
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
  const g = padGeo(d.axis)
  const X = (x: number) => g.ox + x * g.sx
  const Y = (y: number) => g.oy - y * g.sy
  ctx.clearRect(0, 0, PAD_W, PAD_H)
  ctx.fillStyle = '#07070f'
  ctx.fillRect(0, 0, PAD_W, PAD_H)
  drawGrid(ctx, g, d.axis, d.rDistance)

  if (d.f) drawCurve(ctx, g, d.axis, d.f, d.onZ)

  // 多項式フィットの曲線（破線）
  if (d.fitted) {
    ctx.strokeStyle = 'rgba(255,255,255,.75)'
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1.6
    ctx.beginPath()
    const step = d.axis.max / 120
    for (let x = 0; x <= d.axis.max + 1e-9; x += step) {
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
