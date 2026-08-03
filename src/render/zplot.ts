// z(t) 断面プロット（DC プロトタイプ v3 の _drawZ）。右レールに常時出す「属性場の読み」。
// t は術者からの距離。中立帯・強度5の目安線・属性色の面・基準速度 v(t)・t=r・極（✕）を重ねる。
// 描画専用（当たり判定・ロジックには関与しない）。値はエンジンの式をそのまま使う。
import { FIELD, SAMPLING } from '../data/constants'
import { attributeOf, strengthOf } from '../game/attribute'
import { acceleration } from '../game/physics'
import { TOKENS } from './palette'

const TMAX = SAMPLING.rotateXMax

function col(z: number, a: number): string {
  const at = attributeOf(z)
  if (at === 'light') return `rgba(244,196,48,${a})`
  if (at === 'dark') return `rgba(138,111,214,${a})`
  return `rgba(150,160,180,${a})`
}

export interface ZPlotInput {
  /** z(t)。式が読めないときは null */
  zAt: ((t: number) => number) | null
  /** 射線上の的までの距離 r（縦の破線） */
  rDistance: number
  /** z(t) が発散する t（極）。無ければ null */
  pole: number | null
}

/** z(t) プロットを 1 枚描く（ctx は原寸へスケール済み・clear 済みであること）。 */
export function drawZPlot(ctx: CanvasRenderingContext2D, w: number, h: number, input: ZPlotInput): void {
  const L = 30
  const R = 8
  const T = 8
  const B = 16
  const PW = w - L - R
  const PH = h - T - B
  ctx.fillStyle = TOKENS.bg
  ctx.fillRect(0, 0, w, h)

  const { zAt } = input
  // 縦軸の目盛りは実際に出る |z| に合わせて広げる（最大 40 で頭打ち）
  let zmax = 6
  const samples: { t: number; z: number }[] = []
  for (let i = 0; i <= 120; i++) {
    const t = (TMAX * i) / 120
    const z = zAt ? zAt(t) : Number.NaN
    samples.push({ t, z })
    if (Number.isFinite(z)) zmax = Math.max(zmax, Math.abs(z))
  }
  zmax = Math.min(zmax, 40)
  const X = (t: number) => L + (PW * t) / TMAX
  const Y = (z: number) => T + PH / 2 - (z / zmax) * (PH / 2)

  // 中立帯
  ctx.fillStyle = 'rgba(150,160,180,.10)'
  ctx.fillRect(L, Y(FIELD.epsilon), PW, Y(-FIELD.epsilon) - Y(FIELD.epsilon))
  // |z|=zPeak（強度が最大になる高さ）
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  for (const g of [FIELD.zPeak, -FIELD.zPeak]) {
    if (Math.abs(g) > zmax) continue
    ctx.strokeStyle = g > 0 ? 'rgba(244,196,48,.3)' : 'rgba(138,111,214,.3)'
    ctx.beginPath()
    ctx.moveTo(L, Y(g))
    ctx.lineTo(L + PW, Y(g))
    ctx.stroke()
  }
  ctx.setLineDash([])
  // 軸
  ctx.strokeStyle = 'rgba(125,143,196,.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(L, Y(0))
  ctx.lineTo(L + PW, Y(0))
  ctx.moveTo(L, T)
  ctx.lineTo(L, T + PH)
  ctx.stroke()
  ctx.fillStyle = TOKENS.textDim
  ctx.font = "9px 'DotGothic16', monospace"
  ctx.textAlign = 'right'
  ctx.fillText(`+${Math.round(zmax)}`, L - 4, T + 8)
  ctx.fillText('0', L - 4, Y(0) + 3)
  ctx.fillText(`-${Math.round(zmax)}`, L - 4, T + PH)
  ctx.textAlign = 'left'
  ctx.fillText('t=0', L + 1, h - 4)
  ctx.textAlign = 'right'
  ctx.fillText(`t=${TMAX}`, L + PW, h - 4)

  if (!zAt) {
    ctx.fillStyle = TOKENS.hpLow
    ctx.font = "11px 'DotGothic16', monospace"
    ctx.textAlign = 'center'
    ctx.fillText('式エラー', L + PW / 2, T + PH / 2)
    return
  }

  // 属性色で軸まで塗る（強度が高いほど濃い）
  for (let i = 1; i < samples.length; i++) {
    const p0 = samples[i - 1]
    const p1 = samples[i]
    if (!Number.isFinite(p0.z) || !Number.isFinite(p1.z)) continue
    const mid = (p0.z + p1.z) / 2
    if (attributeOf(mid) === 'neutral') continue
    ctx.fillStyle = col(mid, 0.1 + (strengthOf(mid) / FIELD.sMax) * 0.28)
    ctx.beginPath()
    ctx.moveTo(X(p0.t), Y(0))
    ctx.lineTo(X(p0.t), Y(p0.z))
    ctx.lineTo(X(p1.t), Y(p1.z))
    ctx.lineTo(X(p1.t), Y(0))
    ctx.closePath()
    ctx.fill()
  }
  // z 曲線
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  for (let i = 1; i < samples.length; i++) {
    const p0 = samples[i - 1]
    const p1 = samples[i]
    if (!Number.isFinite(p0.z) || !Number.isFinite(p1.z)) continue
    ctx.strokeStyle = col(p1.z, 0.95)
    ctx.beginPath()
    ctx.moveTo(X(p0.t), Y(p0.z))
    ctx.lineTo(X(p1.t), Y(p1.z))
    ctx.stroke()
  }

  // 基準 v(t)：z(t) だけから決まる（直線換算）＝撃つ前に読んでよい完全情報
  {
    let acc = 0
    let started = false
    ctx.strokeStyle = 'rgba(238,240,251,.4)'
    ctx.lineWidth = 1.2
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    for (let t = 0; t <= TMAX; t += 0.4) {
      const z = zAt(t)
      if (!Number.isFinite(z)) break
      acc += acceleration(z) * 0.4
      const sp = Math.min(FIELD.maxFlightSpeed, Math.sqrt(Math.max(0, FIELD.fixedSpeed ** 2 + 2 * acc)))
      const px = X(t)
      const py = T + PH - (sp / FIELD.maxFlightSpeed) * PH
      if (!started) {
        ctx.moveTo(px, py)
        started = true
      } else ctx.lineTo(px, py)
      if (sp <= 0.35) break
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(238,240,251,.5)'
    ctx.textAlign = 'left'
    ctx.fillText('v', L + 3, T + 7)
  }

  // t = r（的までの距離）：ここに強度の頂点を合わせるのが z 設計
  if (input.rDistance <= TMAX) {
    const px = X(input.rDistance)
    ctx.strokeStyle = 'rgba(255,243,196,.55)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(px, T)
    ctx.lineTo(px, T + PH)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,243,196,.85)'
    ctx.textAlign = 'center'
    ctx.fillText('t=r', px, T + 7)
    const zr = zAt(input.rDistance)
    if (Number.isFinite(zr)) {
      ctx.beginPath()
      ctx.arc(px, Y(zr), 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 極（発散）＝そこで暴発する
  if (input.pole !== null && input.pole <= TMAX) {
    const px = X(input.pole)
    ctx.strokeStyle = TOKENS.hpLow
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(px - 4, Y(0) - 4)
    ctx.lineTo(px + 4, Y(0) + 4)
    ctx.moveTo(px + 4, Y(0) - 4)
    ctx.lineTo(px - 4, Y(0) + 4)
    ctx.stroke()
  }
}
