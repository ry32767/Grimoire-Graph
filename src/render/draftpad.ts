// 作図台（関数空間の方眼紙）の描画。React に依存しない純粋な描画関数（#67）。
// 軌道 y=f(x)・属性場 z=g(t) は「横軸＝距離」の方眼紙、
// 結界 r=f(θ) は**極座標の方眼紙**（同心円＝半径の目盛り／放射線＝角度）に描く（#69）。
import { SAMPLING } from '../data/constants'
import type { Vec2 } from '../game/types'

export const PAD_W = 520
export const PAD_H = 216
export const PAD_TMAX = SAMPLING.rotateXMax
export const PAD_Y_RANGE = 12

/** 横軸の目盛りづけ（直交の方眼紙）。 */
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

export const POLAR_NOTE =
  '極座標：同心円 = 半径 r の目盛り（4 きざみ）／放射線 = 角度 θ ・ 点は θ が π/8・r が 1 きざみ'

// ===== 極座標の方眼紙（結界 r=f(θ)） =====

/** 枠に収める半径の上限。**尺度は固定**なので、r を変えれば輪の大きさが必ず変わる（#67/#69）。 */
export const POLAR_R_RANGE = 12
/** 点を吸着させる刻み（角度・半径）。 */
export const POLAR_SNAP_T = Math.PI / 8
export const POLAR_SNAP_R = 1

/** 1 ユニット＝何 px（固定）。 */
export function polarScale(): number {
  return (PAD_H - 26) / 2 / POLAR_R_RANGE
}
/** 極座標の中心（キャンバス座標）。 */
export function polarCenter(): Vec2 {
  return { x: PAD_W / 2, y: PAD_H / 2 }
}
/** (θ, r) → キャンバス座標。 */
export function polarToPad(t: number, r: number): Vec2 {
  const c = polarCenter()
  const s = polarScale()
  return { x: c.x + Math.cos(t) * r * s, y: c.y - Math.sin(t) * r * s }
}
/** キャンバス座標 → 吸着した (θ, r)。θ は [0,2π)。 */
export function padToPolar(px: number, py: number): { t: number; r: number } {
  const c = polarCenter()
  const s = polarScale()
  const dx = px - c.x
  const dy = c.y - py
  const raw = Math.atan2(dy, dx)
  const t = Math.round(((raw + Math.PI * 2) % (Math.PI * 2)) / POLAR_SNAP_T) * POLAR_SNAP_T
  const r = Math.round(Math.hypot(dx, dy) / s / POLAR_SNAP_R) * POLAR_SNAP_R
  return { t: t % (Math.PI * 2), r }
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
  /** 直交の方眼紙の軸。極座標のときは無視する */
  axis: PadAxis
  /** 極座標（結界 r=f(θ)）として描くか */
  polar: boolean
  /** 編集中の関数。y=f(x)／z=g(t)／結界 r=f(θ) */
  f: ((v: number) => number) | null
  /** 線の色を紫にする（z を編集中） */
  onZ: boolean
  /** 射線上の的までの距離 r（縦の破線）。極座標では意味がないので null */
  rDistance: number | null
  /** 点モードで打った点。極座標では x=θ・y=r */
  points: Vec2[]
  /** 多項式フィットの係数（低次→高次・破線）。無ければ null */
  fitted: number[] | null
}

const GOLD = 'rgba(244,196,48,.95)'

/** 方眼紙・軸・目盛り・r の破線（直交）。 */
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

/** 極座標の方眼紙：同心円（半径の目盛り・数値つき）と放射線（角度）。 */
function drawPolarGrid(ctx: CanvasRenderingContext2D): void {
  const c = polarCenter()
  const s = polarScale()
  const rim = POLAR_R_RANGE * s
  ctx.save()
  ctx.lineWidth = 1
  for (let r = 4; r <= POLAR_R_RANGE; r += 4) {
    ctx.strokeStyle = r === POLAR_R_RANGE ? 'rgba(125,143,196,.34)' : 'rgba(125,143,196,.22)'
    ctx.beginPath()
    ctx.arc(c.x, c.y, r * s, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(125,143,196,.18)'
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(c.x + Math.cos(a) * rim, c.y - Math.sin(a) * rim)
    ctx.stroke()
  }
  // 同心円の半径を数値で置く（何の円か分かるように）
  ctx.font = '9px monospace'
  ctx.fillStyle = 'rgba(150,162,196,.75)'
  ctx.textAlign = 'center'
  for (let r = 4; r <= POLAR_R_RANGE; r += 4) ctx.fillText(String(r), c.x + r * s, c.y + 10)
  // 角度の目印（枠の内側／横は外側。上端は説明行があるので内へ寄せる）
  ctx.fillStyle = 'rgba(150,162,196,.6)'
  ctx.textAlign = 'left'
  ctx.fillText('θ=0', c.x + rim + 5, c.y + 3)
  ctx.textAlign = 'center'
  ctx.fillText('π/2', c.x + 12, c.y - rim + 9)
  ctx.textAlign = 'right'
  ctx.fillText('π', c.x - rim - 5, c.y + 3)
  ctx.textAlign = 'center'
  ctx.fillText('3π/2', c.x + 14, c.y + rim - 4)
  ctx.restore()
}

/** r=f(θ) を輪として描く。尺度は固定なので半径を変えれば輪の大きさが変わる。 */
function drawPolarCurve(
  ctx: CanvasRenderingContext2D,
  f: (t: number) => number,
  opts: { dashed?: boolean } = {},
): { rmin: number; rmax: number } | null {
  const pts: Vec2[] = []
  let rmin = Number.POSITIVE_INFINITY
  let rmax = 0
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * Math.PI * 2
    const rr = f(a)
    const v = Number.isFinite(rr) ? Math.abs(rr) : 0
    if (v > rmax) rmax = v
    if (v < rmin) rmin = v
    pts.push(polarToPad(a, v))
  }
  if (!(rmax > 0.01)) return null
  ctx.save()
  if (opts.dashed) {
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = 'rgba(255,255,255,.75)'
    ctx.lineWidth = 1.6
  } else {
    ctx.strokeStyle = GOLD
    ctx.lineWidth = 2.2
  }
  ctx.beginPath()
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
  ctx.stroke()
  if (!opts.dashed) {
    ctx.fillStyle = 'rgba(244,196,48,.10)'
    ctx.fill()
  }
  ctx.restore()
  return { rmin, rmax }
}

/** 編集中の式そのもののグラフ（直交）。 */
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
  ctx.strokeStyle = onZ ? 'rgba(138,111,214,.95)' : GOLD
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

/** 打った点（小さな四角）。 */
function drawPoint(ctx: CanvasRenderingContext2D, p: Vec2): void {
  ctx.fillStyle = '#fff3c4'
  ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7)
  ctx.fillStyle = '#0a0a12'
  ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3)
}

/** 係数から多項式の値を作る（低次→高次）。 */
function polyAt(co: number[], x: number): number {
  let y = 0
  for (let i = 0; i < co.length; i++) y += co[i] * Math.pow(x, i)
  return y
}

/** 作図台をまるごと描く。 */
export function drawDraftPad(ctx: CanvasRenderingContext2D, d: PadDraw): void {
  ctx.clearRect(0, 0, PAD_W, PAD_H)
  ctx.fillStyle = '#07070f'
  ctx.fillRect(0, 0, PAD_W, PAD_H)

  if (d.polar) {
    drawPolarGrid(ctx)
    const range = d.f ? drawPolarCurve(ctx, d.f) : null
    if (d.fitted) drawPolarCurve(ctx, (t) => polyAt(d.fitted!, t), { dashed: true })
    for (const p of d.points) drawPoint(ctx, polarToPad(p.x, p.y))
    // 読みは下端に置く（上端は HTML の説明行が重なる）
    ctx.font = '9px monospace'
    ctx.textAlign = 'left'
    if (range) {
      ctx.fillStyle = 'rgba(255,243,196,.8)'
      const over = range.rmax > POLAR_R_RANGE ? `（${POLAR_R_RANGE} より外は枠外）` : ''
      ctx.fillText(`半径 ${range.rmin.toFixed(1)}〜${range.rmax.toFixed(1)}${over}`, 8, PAD_H - 7)
    } else {
      ctx.fillStyle = 'rgba(255,125,94,.85)'
      ctx.fillText('半径が 0 のままです（結界を張れません）', 8, PAD_H - 7)
    }
    return
  }

  const g = padGeo(d.axis)
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
      const y = polyAt(d.fitted, x)
      if (!Number.isFinite(y)) break
      const px = g.ox + x * g.sx
      const py = g.oy - y * g.sy
      if (x === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.setLineDash([])
  }

  for (const p of d.points) drawPoint(ctx, { x: g.ox + p.x * g.sx, y: g.oy - p.y * g.sy })
}
