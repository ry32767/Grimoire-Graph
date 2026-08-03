// タイトル画面の背景アニメーション（DC プロトタイプ v3 の _drawTitle）。
// 「式から絵が出ている」ことをそのまま見せる：z(t) の同心円の上を、y=f(x) の軌道に沿って
// 詠唱の光が走り、足元に そのときの y・z の値が出る。
// すべての動きを P∈[0,1) の周期関数にしてあるので、継ぎ目なくループする。描画専用。
import { TOKENS } from './palette'

const LOOP_MS = 8400
const TAU = Math.PI * 2

type Attr = 'light' | 'dark' | 'neutral'
const col = (a: Attr, alpha: number): string =>
  a === 'light' ? `rgba(244,196,48,${alpha})` : a === 'dark' ? `rgba(138,111,214,${alpha})` : `rgba(150,160,180,${alpha})`
const attrOf = (z: number): Attr => (z > 0.35 ? 'light' : z < -0.35 ? 'dark' : 'neutral')

// y は 3 つの正弦波の重ね合わせ、z は飛行距離 s に沿って符号が入れ替わる属性場
const yAt = (x: number) =>
  Math.exp(-0.03 * Math.abs(x)) *
  (3.0 * Math.sin(0.4 * x + 1.2) + 1.3 * Math.sin(0.93 * x - 0.6) + 0.62 * Math.sin(1.7 * x + 2.1))
const zAt = (s: number) => 4.4 * Math.sin(0.2 * s - 0.7) * Math.exp(-0.008 * s)

/** タイトル背景を 1 フレーム描く（ctx は原寸へスケール済みであること）。 */
export function drawTitleScene(ctx: CanvasRenderingContext2D, w: number, h: number, nowMs: number): void {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = TOKENS.bg
  ctx.fillRect(0, 0, w, h)

  const P = (nowMs % LOOP_MS) / LOOP_MS
  const u = Math.max(22, Math.min(40, w / 28))
  const cx = w * 0.74
  const cy = h * 0.54

  // 方眼と軸
  ctx.lineWidth = 1
  for (let i = -46; i <= 46; i++) {
    const gx = cx + (i * u) / 2
    const gy = cy + (i * u) / 2
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(125,143,196,.10)' : 'rgba(125,143,196,.045)'
    ctx.beginPath()
    ctx.moveTo(gx, 0)
    ctx.lineTo(gx, h)
    ctx.moveTo(0, gy)
    ctx.lineTo(w, gy)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(125,143,196,.30)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(w, cy)
  ctx.moveTo(cx, 0)
  ctx.lineTo(cx, h)
  ctx.stroke()

  // 描く範囲は画面内に収まるよう canvas から決める
  const X1 = Math.min(34, (w - 20 - cx) / (u / 2))
  const X0 = Math.max(-40, (20 - cx) / (u / 2))
  const px = (x: number) => cx + (x * u) / 2
  const py = (x: number) => cy - (yAt(x) * u) / 2

  // z 場（同心円）：半径 t の輪。z の符号がそのまま輪の色になる
  for (let r = 1; r <= 17; r++) {
    const tt = r * 1.8
    const z = zAt(tt)
    const st = Math.min(1, Math.abs(z) / 4.4)
    if (st < 0.06) continue
    const puls = 0.72 + 0.28 * Math.sin(P * TAU - tt * 0.22)
    ctx.strokeStyle = col(attrOf(z), (0.05 + st * 0.2) * puls)
    ctx.lineWidth = 0.7 + st * 2.0
    ctx.beginPath()
    ctx.arc(cx, cy, (tt * u) / 2, 0, TAU)
    ctx.stroke()
  }

  // 主軌道：常にそこにあり、区間ごとに纏う属性の色が変わる
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.7
  for (let x = X0; x < X1; x += 0.4) {
    const z = zAt(x - X0)
    const st = Math.min(1, Math.abs(z) / 4.4)
    ctx.strokeStyle = col(attrOf(z), 0.1 + st * 0.13)
    ctx.beginPath()
    ctx.moveTo(px(x), py(x))
    ctx.lineTo(px(x + 0.4), py(x + 0.4))
    ctx.stroke()
  }

  // 走る詠唱の光を 2 本、位相を半周ずらして流す。両端でフェードするので継ぎ目が出ない
  ctx.globalCompositeOperation = 'lighter'
  for (let g = 0; g < 2; g++) {
    const q = (P + g * 0.5) % 1
    const hx = X0 + (X1 - X0) * q
    const edge = Math.min(1, Math.min(q, 1 - q) / 0.1)
    if (edge <= 0) continue
    for (let s = 0; s < 44; s++) {
      const x = hx - s * 0.5
      if (x < X0) break
      const z = zAt(x - X0)
      const st = Math.min(1, Math.abs(z) / 4.4)
      const a = (1 - s / 44) * (1 - s / 44) * (0.34 + st * 0.34) * edge
      ctx.strokeStyle = col(attrOf(z), a)
      ctx.lineWidth = 1.0 + (1 - s / 44) * (1.4 + st * 1.6)
      ctx.beginPath()
      ctx.moveTo(px(x), py(x))
      ctx.lineTo(px(x + 0.5), py(x + 0.5))
      ctx.stroke()
    }
    const hz = zAt(hx - X0)
    const ha = attrOf(hz)
    const hst = Math.min(1, Math.abs(hz) / 4.4)
    const gr = ctx.createRadialGradient(px(hx), py(hx), 0, px(hx), py(hx), 9 + hst * 8)
    gr.addColorStop(0, col(ha, 0.95 * edge))
    gr.addColorStop(1, col(ha, 0))
    ctx.fillStyle = gr
    ctx.beginPath()
    ctx.arc(px(hx), py(hx), 9 + hst * 8, 0, TAU)
    ctx.fill()
    ctx.fillStyle =
      (ha === 'dark' ? 'rgba(230,222,255,' : ha === 'light' ? 'rgba(255,244,212,' : 'rgba(226,232,244,') +
      edge.toFixed(3) +
      ')'
    ctx.beginPath()
    ctx.arc(px(hx), py(hx), 3.2 + hst * 1.6, 0, TAU)
    ctx.fill()
  }
  ctx.restore()

  // 先行する光の足元に、いま計算されている y・z を出す
  const lx = X0 + (X1 - X0) * P
  const ledge = Math.min(1, Math.min(P, 1 - P) / 0.1)
  if (ledge > 0.02) {
    const lz = zAt(lx - X0)
    const la = attrOf(lz)
    ctx.save()
    ctx.globalAlpha = ledge
    ctx.strokeStyle = 'rgba(244,196,48,.40)'
    ctx.setLineDash([2, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px(lx), cy)
    ctx.lineTo(px(lx), py(lx))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = "11px 'DotGothic16', monospace"
    const txt = `y ${yAt(lx).toFixed(2)}   z ${lz >= 0 ? '+' : ''}${lz.toFixed(1)} ${
      la === 'light' ? '光' : la === 'dark' ? '闇' : '中立'
    }`
    const right = px(lx) + 8 + ctx.measureText(txt).width > w - 14
    ctx.textAlign = right ? 'right' : 'left'
    ctx.fillStyle = col(la, 0.95)
    ctx.fillText(txt, px(lx) + (right ? -10 : 8), py(lx) - 10)
    ctx.restore()
  }

  // 式そのものを盤の上に置く
  ctx.save()
  ctx.textAlign = 'right'
  ctx.font = "11px 'DotGothic16', monospace"
  ctx.fillStyle = 'rgba(244,196,48,.78)'
  ctx.fillText('y = e^(-0.03x) · (3 sin0.4x + 1.3 sin0.93x + 0.62 sin1.7x)', w - 22, h - 74)
  ctx.fillStyle = 'rgba(180,164,255,.72)'
  ctx.fillText('z(t) = 4.4 sin(0.20t - 0.7) · e^(-0.008t)', w - 22, h - 54)
  ctx.restore()

  // 左からのビネット（文字を読ませる）
  const g2 = ctx.createLinearGradient(0, 0, w, 0)
  g2.addColorStop(0, 'rgba(6,6,12,.97)')
  g2.addColorStop(0.42, 'rgba(6,6,12,.86)')
  g2.addColorStop(0.72, 'rgba(6,6,12,.18)')
  g2.addColorStop(1, 'rgba(6,6,12,0)')
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, w, h)
}
