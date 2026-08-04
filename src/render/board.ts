// 盤面（アリーナ）の描画プリミティブ。
// DC プロトタイプ v3（docs/ゲームUIプロトタイプ検討/Graph Mage Battle v3.dc.html の _drawBoard 系）の
// 見せ方をそのまま持ち込んだ層。スプライト（敵・術者・障害物・弾）は従来どおり draw.ts を使い、
// ここでは「方眼／z 場の同心円／射線／プレビュー帯／結界リング／闇幕／衝撃波」を受け持つ。
//
// **ゲームロジックは一切持たない**：属性・強度・加速度は src/game の純粋関数をそのまま読むだけ。
import type { Attribute, Enemy, Vec2, ZPoint } from '../game/types'
import { toScreen, scaleOf, type Viewport } from '../game/coords'
import { attributeOf, strengthOf } from '../game/attribute'
import { acceleration } from '../game/physics'
import { FIELD, SAMPLING } from '../data/constants'

/** 射線ローカル軸の長さ（coords.ts の回転サンプリングと同じ規則）。 */
function rayReach(fieldR: number): number {
  return Math.max(SAMPLING.rotateXMax, 1.6 * fieldR)
}

/** 盤面の属性色（プロトタイプ v3 の col()）。金＝光・紫＝闇・鈍色＝中立。 */
export function attrRgba(attr: Attribute, alpha = 1): string {
  if (attr === 'light') return `rgba(244,198,90,${alpha})`
  if (attr === 'dark') return `rgba(149,125,255,${alpha})`
  return `rgba(150,160,180,${alpha})`
}

/** z からそのまま属性色を引く。 */
export function zRgba(z: number, alpha = 1): string {
  return attrRgba(attributeOf(z), alpha)
}

const FONT = (px: number, bold = false): string =>
  `${bold ? '700 ' : ''}${px}px 'DotGothic16', monospace`

// ===== 方眼・軸 =====

/**
 * 方眼（1マス=2ユニット・10ごとに濃く）。プロトタイプは canvas を透明にして親の
 * background を透かすが、こちらは背景も塗る。軸・目盛りは z 場の上に重ねるので別関数。
 */
export function drawBoardGrid(ctx: CanvasRenderingContext2D, vp: Viewport, bg: string): void {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, vp.width, vp.height)

  const R = vp.unitsRadius
  ctx.save()
  ctx.lineWidth = 1
  for (let g = -R; g <= R; g += 2) {
    const a = toScreen({ x: g, y: -R }, vp)
    const b = toScreen({ x: g, y: R }, vp)
    const c = toScreen({ x: -R, y: g }, vp)
    const d = toScreen({ x: R, y: g }, vp)
    ctx.strokeStyle = Math.round(g) % 10 === 0 ? 'rgba(120,132,168,.20)' : 'rgba(120,132,168,.085)'
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()
  }
  ctx.restore()
}

/** 軸・5ごとの目盛り数値・場外境界（z 場の同心円より上に重ねて必ず読めるようにする）。 */
export function drawBoardAxes(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const R = vp.unitsRadius
  ctx.save()
  // 軸
  const o = toScreen({ x: 0, y: 0 }, vp)
  const xl = toScreen({ x: -R, y: 0 }, vp)
  const xr = toScreen({ x: R, y: 0 }, vp)
  const yb = toScreen({ x: 0, y: -R }, vp)
  const yt = toScreen({ x: 0, y: R }, vp)
  ctx.strokeStyle = 'rgba(150,162,196,.5)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(xl.x, o.y)
  ctx.lineTo(xr.x, o.y)
  ctx.moveTo(o.x, yb.y)
  ctx.lineTo(o.x, yt.y)
  ctx.stroke()

  // 5 ごとの目盛りと数値（グラフとして「どこを狙っているか」を数で読ませる）
  ctx.fillStyle = 'rgba(150,162,196,.55)'
  ctx.font = FONT(9)
  ctx.textAlign = 'center'
  for (let g = -R; g <= R; g += 5) {
    if (!g) continue
    const p = toScreen({ x: g, y: 0 }, vp)
    ctx.fillRect(p.x, o.y - 3, 1, 6)
    ctx.fillText(String(g), p.x, o.y + 13)
    const q = toScreen({ x: 0, y: g }, vp)
    ctx.fillRect(o.x - 3, q.y, 6, 1)
    ctx.textAlign = 'right'
    ctx.fillText(String(g), o.x - 6, q.y + 3)
    ctx.textAlign = 'center'
  }

  // 場外境界
  ctx.strokeStyle = 'rgba(90,98,136,.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(o.x, o.y, R * scaleOf(vp), 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// ===== z 場：術者中心の同心円（z(t)・半径が飛行距離 t）=====

export interface ZFieldRingsOptions {
  /** 術者の位置（同心円の中心） */
  casterPos: Vec2
  /** z(t)：t＝術者からの飛行距離 */
  zOfT: (t: number) => number
  /** 狙っている対象（t=r の白破線と距離ラベルを出す）。無ければ描かない */
  targetPos?: Vec2 | null
}

/**
 * z(t) を盤面に全開示する同心円場（プロトタイプ v3 の _drawZField）。
 * 属性色×強度で輪を重ね、強度 5 の輪・失速点・t=r（狙う敵までの距離）を名指しで示す。
 * **完全情報はここだけ**：当たるかどうかは撃つまで分からない、という設計の要。
 */
export function drawZFieldRings(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  opts: ZFieldRingsOptions,
): void {
  const { casterPos, zOfT, targetPos } = opts
  const s = scaleOf(vp)
  const R = vp.unitsRadius
  const c = toScreen(casterPos, vp)
  const o = toScreen({ x: 0, y: 0 }, vp)
  // 術者が場の端にいても反対の縁まで届くよう、場の直径ぶんまで描く
  const tMax = Math.max(rayReach(R), R + Math.hypot(casterPos.x, casterPos.y) + 2)
  const step = Math.max(1, Math.ceil(7 / Math.max(1, s)))

  ctx.save()
  ctx.beginPath()
  ctx.arc(o.x, o.y, R * s, 0, Math.PI * 2)
  ctx.clip()

  let sp: number = FIELD.fixedSpeed
  let stall: number | null = null
  let peakDone = false
  for (let t = 0; t <= tMax; t += step) {
    const z = zOfT(t)
    if (!Number.isFinite(z)) break
    sp = Math.max(0, Math.min(FIELD.maxFlightSpeed, sp + acceleration(z) * (step / Math.max(1, sp || 1))))
    const at = attributeOf(z)
    const st = strengthOf(z)
    if (at !== 'neutral' && t > 0) {
      ctx.strokeStyle = attrRgba(at, 0.1 + (st / FIELD.sMax) * 0.34)
      ctx.lineWidth = Math.min(0.7 + (st / FIELD.sMax) * 2.1, Math.max(1, step * s * 0.45))
      ctx.beginPath()
      ctx.arc(c.x, c.y, t * s, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (st >= FIELD.sMax - 0.15) {
      ctx.strokeStyle = attrRgba(at, 0.8)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(c.x, c.y, t * s, 0, Math.PI * 2)
      ctx.stroke()
      if (!peakDone) {
        peakDone = true
        ctx.fillStyle = attrRgba(at, 0.95)
        ctx.font = FONT(10)
        ctx.textAlign = 'left'
        ctx.fillText(`強度${FIELD.sMax}`, c.x + t * s + 4, c.y - 2)
      }
    }
    if (stall === null && sp <= 0.35) stall = t
  }

  // 失速（そこで止まる＝届かない）
  if (stall !== null) {
    ctx.strokeStyle = 'rgba(149,125,255,.85)'
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(c.x, c.y, stall * s, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(195,182,255,.95)'
    ctx.font = FONT(10)
    ctx.textAlign = 'center'
    ctx.fillText(`失速 t=${stall.toFixed(0)}`, c.x, c.y - stall * s - 5)
  }

  // t=r（狙う対象までの距離）
  if (targetPos) {
    const r = Math.hypot(targetPos.x - casterPos.x, targetPos.y - casterPos.y)
    ctx.strokeStyle = 'rgba(255,255,255,.5)'
    ctx.setLineDash([2, 5])
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(c.x, c.y, r * s, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    const e = toScreen(targetPos, vp)
    ctx.fillStyle = 'rgba(240,244,255,.9)'
    ctx.font = FONT(10)
    ctx.textAlign = 'left'
    ctx.fillText(`t=r ${r.toFixed(1)}`, e.x + 13, e.y + 4)
  }
  ctx.restore()
}

// ===== 射線のローカル座標系・狙いの矢印 =====

/** f(x) が住む軸（術者から θ 方向へ伸びる金の破線）と 10 ごとの目盛り。 */
export function drawRayAxis(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  casterPos: Vec2,
  angle: number,
): void {
  const s = scaleOf(vp)
  const c = toScreen(casterPos, vp)
  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.rotate(-angle)
  ctx.strokeStyle = 'rgba(244,198,90,.20)'
  ctx.setLineDash([3, 5])
  ctx.lineWidth = 1
  const reach = rayReach(vp.unitsRadius)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(reach * s, 0)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(244,198,90,.35)'
  for (let tx = 10; tx <= reach - 8; tx += 10) ctx.fillRect(tx * s, -3, 1, 6)
  ctx.restore()
}

/** 狙いの向き（術者から伸びる金の矢印・画面 40px 固定）。 */
export function drawAimArrow(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  casterPos: Vec2,
  angle: number,
): void {
  const c = toScreen(casterPos, vp)
  const L = 40
  const ex = c.x + Math.cos(angle) * L
  const ey = c.y - Math.sin(angle) * L
  ctx.save()
  ctx.strokeStyle = 'rgba(244,198,90,.9)'
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(c.x, c.y)
  ctx.lineTo(ex, ey)
  ctx.stroke()
  ctx.fillStyle = 'rgba(244,198,90,.95)'
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - Math.cos(angle - 0.5) * 8, ey + Math.sin(angle - 0.5) * 8)
  ctx.lineTo(ex - Math.cos(angle + 0.5) * 8, ey + Math.sin(angle + 0.5) * 8)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

// ===== プレビュー軌道（作成フェーズ）=====

/** プレビュー1点。arcLen は術者からの弧長（撃つ前に見せる長さの打ち切りに使う）。 */
export interface PreviewPoint {
  pos: Vec2
  z: number
  speed: number
  arcLen: number
}

/** ZPoint 列からプレビュー点列を作る（弧長を積分するだけ・ロジックには触らない）。 */
export function toPreviewPoints(path: ZPoint[]): PreviewPoint[] {
  const out: PreviewPoint[] = []
  let acc = 0
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    if (i > 0) acc += Math.hypot(p.pos.x - path[i - 1].pos.x, p.pos.y - path[i - 1].pos.y)
    out.push({ pos: p.pos, z: p.z, speed: p.speed ?? 0, arcLen: acc })
  }
  return out
}

/** 撃つ前に見せる弧長（プロトタイプ v3）。これ以上は「撃つまで分からない」。 */
export const PREVIEW_STUB_ARC = 3.4

/**
 * プレビュー軌道のリボン表現（プロトタイプ v3）。
 * 速度で太さと明るさが変わる帯＋一定間隔の法線ヒゲ（その点の z の符号と強さ）。
 * full=false（既定）では弧長 PREVIEW_STUB_ARC までの短い出だしだけを見せる。
 */
export function drawPreviewRibbon(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: PreviewPoint[],
  full = false,
): void {
  const pts = full ? points : points.filter((p) => p.arcLen <= PREVIEW_STUB_ARC)
  if (pts.length < 2) return
  ctx.save()
  // 法線ヒゲ：z の符号で左右へ、強度で長さが伸びる
  for (let i = 2; i < pts.length - 1; i += 4) {
    const p = pts[i]
    const q = pts[i + 1] ?? pts[i]
    if (Math.abs(p.z) < FIELD.epsilon) continue
    const st = strengthOf(p.z)
    const P = toScreen(p.pos, vp)
    const Q = toScreen(q.pos, vp)
    const dx = Q.x - P.x
    const dy = Q.y - P.y
    const m = Math.hypot(dx, dy) || 1
    const nx = -dy / m
    const ny = dx / m
    const len = Math.min(16, 2 + Math.abs(p.z) * 2.2) * (p.z > 0 ? 1 : -1)
    ctx.strokeStyle = zRgba(p.z, 0.18 + (st / FIELD.sMax) * 0.5)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(P.x, P.y)
    ctx.lineTo(P.x + nx * len, P.y + ny * len)
    ctx.stroke()
  }
  // 帯：速いほど太く明るい
  ctx.lineCap = 'round'
  for (let i = 1; i < pts.length; i++) {
    const P = toScreen(pts[i - 1].pos, vp)
    const Q = toScreen(pts[i].pos, vp)
    const sn = Math.max(0, Math.min(1, pts[i].speed / FIELD.maxFlightSpeed))
    ctx.strokeStyle = zRgba(pts[i].z, 0.3 + sn * 0.7)
    ctx.lineWidth = 1.4 + sn * 3.4
    ctx.beginPath()
    ctx.moveTo(P.x, P.y)
    ctx.lineTo(Q.x, Q.y)
    ctx.stroke()
  }
  ctx.restore()
}

/** 前ターンの軌跡（残像）。属性色でごく薄く残す。 */
export function drawTurnTrails(ctx: CanvasRenderingContext2D, vp: Viewport, trails: ZPoint[][]): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.2
  for (const ts of trails) {
    for (let i = 1; i < ts.length; i++) {
      const P = toScreen(ts[i - 1].pos, vp)
      const Q = toScreen(ts[i].pos, vp)
      ctx.strokeStyle = zRgba(ts[i - 1].z, 0.1)
      ctx.beginPath()
      ctx.moveTo(P.x, P.y)
      ctx.lineTo(Q.x, Q.y)
      ctx.stroke()
    }
  }
  ctx.restore()
}

// ===== 結界（周回リング）=====

/** リングの粒の位置を持ち越すための状態（フレーム間で保持する）。 */
export type RingPhaseStore = Record<string, number[]>

/**
 * 結界＝周回リング（プロトタイプ v3 の _drawRing）。
 * 帯そのものが速度を語り（速い区間ほど明るく太い）、粒は**その場の速度**で流れるので
 * 遅い区間で詰まり速い区間で伸びる。上端に「v平均・|z|・威力」を読みとして出す。
 */
export function drawOrbitRing(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  ring: ZPoint[],
  role: 'ally' | 'enemy',
  store: RingPhaseStore,
  quiet = false,
): void {
  const n = ring.length
  if (n < 3) return
  const VM = FIELD.maxFlightSpeed
  let vmax = 0
  let vmin = Infinity
  let zpk = 0
  let pw = 0
  let tot = 0
  let seg = 0
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const sp = p.speed ?? 0
    const st = strengthOf(p.z)
    if (sp > vmax) vmax = sp
    if (sp < vmin) vmin = sp
    if (Math.abs(p.z) > Math.abs(zpk)) zpk = p.z
    if (sp * st > pw) pw = sp * st
    tot += sp
    const q = ring[(i + 1) % n]
    seg += Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y)
  }
  const mean = tot / n
  const segLen = Math.max(1e-4, seg / n)

  // 帯
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    const sp = p.speed ?? 0
    const f = Math.max(0, Math.min(1, sp / VM))
    const P = toScreen(p.pos, vp)
    const Q = toScreen(q.pos, vp)
    const st = strengthOf(p.z)
    ctx.strokeStyle = zRgba(p.z, 0.14 + f * 0.72)
    ctx.lineWidth = 1 + f * 2.6 + (st / FIELD.sMax) * 1.2
    ctx.beginPath()
    ctx.moveTo(P.x, P.y)
    ctx.lineTo(Q.x, Q.y)
    ctx.stroke()
  }
  ctx.restore()

  // 流れる粒
  const key = `${role}:${n}:${Math.round(ring[0].pos.x * 10)},${Math.round(ring[0].pos.y * 10)}`
  const cnt = Math.min(16, Math.max(6, Math.round(n / 9)))
  let ps = store[key]
  if (!ps || ps.length !== cnt) {
    ps = []
    for (let k = 0; k < cnt; k++) ps.push((k * n) / cnt)
    store[key] = ps
  }
  const dt = 0.033
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let k = 0; k < cnt; k++) {
    const i0 = Math.floor(ps[k]) % n
    const p = ring[i0]
    const sp = p.speed ?? 0
    ps[k] = (ps[k] + (sp * dt) / segLen) % n
    if (sp <= 0.02) continue
    const P = toScreen(p.pos, vp)
    const at = attributeOf(p.z)
    const st = strengthOf(p.z)
    const f = Math.max(0, Math.min(1, sp / VM))
    const r = 1.6 + f * 2.2 + (st / FIELD.sMax) * 1.1
    // 尾（速いほど長い）
    const back = Math.max(1, Math.round(2 + f * 10))
    for (let b = 1; b <= back; b++) {
      const j = ((i0 - b) % n + n) % n
      const T = toScreen(ring[j].pos, vp)
      const Tn = toScreen(ring[(j + 1) % n].pos, vp)
      ctx.strokeStyle = attrRgba(at, (1 - b / back) * 0.3 * (0.3 + f))
      ctx.lineWidth = r * 0.7
      ctx.beginPath()
      ctx.moveTo(T.x, T.y)
      ctx.lineTo(Tn.x, Tn.y)
      ctx.stroke()
    }
    const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, r * 3.2)
    g.addColorStop(0, attrRgba(at, 0.95))
    g.addColorStop(0.45, attrRgba(at, 0.3))
    g.addColorStop(1, attrRgba(at, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(P.x, P.y, r * 3.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = at === 'light' ? '#fff4d4' : at === 'dark' ? '#e2daff' : '#eef1f9'
    ctx.beginPath()
    ctx.arc(P.x, P.y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  if (quiet) return

  // 読み取り値：速度・|z|・威力
  let top = ring[0]
  for (const p of ring) if (p.pos.y > top.pos.y) top = p
  const lp = toScreen(top.pos, vp)
  ctx.save()
  ctx.font = FONT(9.5)
  ctx.textAlign = 'center'
  ctx.fillStyle = zRgba(zpk, 0.9)
  const spread = vmax - vmin > 0.4 ? `（${vmin.toFixed(1)}〜${vmax.toFixed(1)}）` : ''
  ctx.fillText(
    `v${mean.toFixed(1)}${spread} ・ |z|${Math.abs(zpk).toFixed(1)} ・ 威力${Math.round(pw)}`,
    lp.x,
    lp.y - 9,
  )
  if (vmax <= 0.02) {
    ctx.fillStyle = 'rgba(255,125,94,.9)'
    ctx.fillText('失速（自滅）', lp.x, lp.y - 20)
  }
  ctx.restore()
}

// ===== 闇結界の視認阻害 =====

export interface DarkRing {
  ring: ZPoint[]
  owner: 'ally' | 'enemy'
}

/**
 * 闇の結界に囲まれた範囲は相手から見えなくなる（プロトタイプ v3 の _drawConceal）。
 * 1重＝闇の幕＋粗いドットのざらつき（見づらいが形は分かる）／
 * 2重に重なった範囲＝完全な黒＋「視認不能」。境界は破線＋見出しで明示する。
 */
export function drawDarkVeil(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  rings: DarkRing[],
  phase: number,
): void {
  if (rings.length === 0) return
  const path = (r: DarkRing) => {
    ctx.beginPath()
    r.ring.forEach((p, i) => {
      const P = toScreen(p.pos, vp)
      if (i === 0) ctx.moveTo(P.x, P.y)
      else ctx.lineTo(P.x, P.y)
    })
    ctx.closePath()
  }
  const box = (r: DarkRing) => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const p of r.ring) {
      const P = toScreen(p.pos, vp)
      if (P.x < x0) x0 = P.x
      if (P.y < y0) y0 = P.y
      if (P.x > x1) x1 = P.x
      if (P.y > y1) y1 = P.y
    }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
  }

  for (const r of rings) {
    const b = box(r)
    ctx.save()
    path(r)
    ctx.clip()
    ctx.fillStyle = r.owner === 'enemy' ? 'rgba(7,5,16,.62)' : 'rgba(9,6,20,.5)'
    ctx.fill()
    ctx.fillStyle = 'rgba(46,30,86,.5)'
    const st = 5
    const off = (Math.floor(phase * 2) % 2) * st
    for (let y = b.y0 - st; y < b.y1 + st; y += st) {
      const shift = Math.round((y - b.y0) / st) % 2 ? st / 2 : 0
      for (let x = b.x0 - st + shift + (off % st); x < b.x1 + st; x += st) {
        ctx.fillRect(Math.round(x), Math.round(y), 2, 2)
      }
    }
    ctx.restore()
  }

  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      ctx.save()
      path(rings[i])
      ctx.clip()
      path(rings[j])
      ctx.clip()
      ctx.fillStyle = '#04030a'
      ctx.fillRect(0, 0, vp.width, vp.height)
      ctx.restore()
      const a = box(rings[i])
      const b = box(rings[j])
      const mx = (a.cx + b.cx) / 2
      const my = (a.cy + b.cy) / 2
      if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < (a.x1 - a.x0) / 2 + (b.x1 - b.x0) / 2) {
        ctx.save()
        ctx.textAlign = 'center'
        ctx.font = FONT(11, true)
        ctx.strokeStyle = '#04030a'
        ctx.lineWidth = 3.5
        ctx.strokeText('視認不能', mx, my + 4)
        ctx.fillStyle = '#c3b6ff'
        ctx.fillText('視認不能', mx, my + 4)
        ctx.restore()
      }
    }
  }

  for (const r of rings) {
    const b = box(r)
    ctx.save()
    path(r)
    ctx.strokeStyle = 'rgba(150,110,210,.6)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.lineDashOffset = -phase * 6
    ctx.stroke()
    ctx.setLineDash([])
    ctx.textAlign = 'center'
    ctx.font = FONT(10, true)
    const lb = r.owner === 'enemy' ? '敵の闇幕' : '闇幕 — 相手から見えにくい'
    ctx.strokeStyle = '#04030a'
    ctx.lineWidth = 3.5
    ctx.strokeText(lb, b.cx, b.y0 - 6)
    ctx.fillStyle = 'rgba(195,182,255,.9)'
    ctx.fillText(lb, b.cx, b.y0 - 6)
    ctx.restore()
  }
}

// ===== 飛翔中の演出 =====

/** 通ってきた道（属性色・古いほど薄い）＋一定間隔の燐光。 */
export function drawFlightPath(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pts: PreviewPoint[],
  upto: number,
  phase: number,
  sizeFrac: (speed: number, z: number) => number,
): void {
  if (upto < 1) return
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 1; i <= upto; i++) {
    const A = pts[i - 1]
    const B = pts[i]
    if (!A || !B) break
    const age = 1 - (upto - i) / Math.max(1, upto)
    const P = toScreen(A.pos, vp)
    const Q = toScreen(B.pos, vp)
    ctx.strokeStyle = zRgba(A.z, 0.1 + age * 0.3)
    ctx.lineWidth = 0.9 + sizeFrac(A.speed, A.z) * 2.2
    ctx.beginPath()
    ctx.moveTo(P.x, P.y)
    ctx.lineTo(Q.x, Q.y)
    ctx.stroke()
  }
  // 道に落ちた燐光（ゆっくり明滅して残る）
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 6; i <= upto; i += 10) {
    const A = pts[i]
    if (!A) break
    const P = toScreen(A.pos, vp)
    const fr = sizeFrac(A.speed, A.z)
    const tw = 0.45 + 0.55 * Math.sin(phase * 1.6 + i * 0.7)
    ctx.fillStyle = zRgba(A.z, 0.16 * tw * (0.4 + fr))
    ctx.beginPath()
    ctx.arc(P.x, P.y, 1.2 + fr * 2.6, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 発射の閃光（詠唱の瞬間・術者位置から広がる輪）。progress 0→1。 */
export function drawLaunchFlash(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pos: Vec2,
  z: number,
  progress: number,
): void {
  const P = toScreen(pos, vp)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = zRgba(z, (1 - progress) * 0.7)
  ctx.lineWidth = 2.4 * (1 - progress) + 0.6
  ctx.beginPath()
  ctx.arc(P.x, P.y, 4 + progress * 22, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** 速度に応じた火花を尾に散らす。 */
export function drawSpeedSparks(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pts: PreviewPoint[],
  idx: number,
  phase: number,
  frac: number,
): void {
  if (frac <= 0.12) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (let s = 0; s < 3; s++) {
    const j = Math.max(0, idx - 2 - s * 2)
    const b = pts[j]
    if (!b) break
    const B = toScreen(b.pos, vp)
    const a = (1 - s / 3) * 0.5 * frac
    const rr = 1 + frac * 2.2 * (1 - s / 3)
    const wob = Math.sin(phase * 3 + s * 2.1) * rr * 1.4
    ctx.fillStyle = zRgba(b.z, a)
    ctx.beginPath()
    ctx.arc(B.x + wob, B.y - wob, rr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 着弾の衝撃波（対象の位置から広がる白い輪）。progress 0→1。 */
export function drawImpactShockwave(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pos: Vec2,
  progress: number,
): void {
  const P = toScreen(pos, vp)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = `rgba(255,240,210,${((1 - progress) * 0.55).toFixed(3)})`
  ctx.lineWidth = 3 * (1 - progress) + 0.6
  ctx.beginPath()
  ctx.arc(P.x, P.y, 6 + progress * 30, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/**
 * 結界と魔法が相殺した瞬間（パリィ）。二重の衝撃波＋光闇の破片＋「相殺」の文字で必ず目に入るようにする。
 * progress 0→1（900ms 相当）。
 */
export function drawParryBurst(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pos: Vec2,
  power: number,
  progress: number,
): void {
  if (progress >= 1) return
  const TAU = Math.PI * 2
  const P = toScreen(pos, vp)
  const pw = Math.min(1, power / 140)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  for (let k = 0; k < 2; k++) {
    const q = Math.min(1, Math.max(0, (progress - k * 0.16) / 0.84))
    if (q <= 0) continue
    ctx.strokeStyle = `rgba(255,246,224,${((1 - q) * (1 - q) * 0.9).toFixed(3)})`
    ctx.lineWidth = (5 - k * 2.2) * (1 - q) + 0.8
    ctx.beginPath()
    ctx.arc(P.x, P.y, 9 + pw * 22 + q * (44 + pw * 66), 0, TAU)
    ctx.stroke()
  }
  const cr = (15 + pw * 24) * (1 - progress)
  if (cr > 0) {
    const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, cr)
    g.addColorStop(0, `rgba(255,255,255,${(0.95 * (1 - progress)).toFixed(3)})`)
    g.addColorStop(0.45, `rgba(255,232,180,${(0.45 * (1 - progress)).toFixed(3)})`)
    g.addColorStop(1, 'rgba(255,232,180,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(P.x, P.y, cr, 0, TAU)
    ctx.fill()
  }
  const n = 12 + Math.round(pw * 10)
  const w0 = 1 - progress
  for (let s = 0; s < n; s++) {
    const a = (s / n) * TAU + pos.x * 0.7 + pos.y * 0.3
    const len = (20 + pw * 52) * Math.pow(progress, 0.55)
    ctx.strokeStyle = attrRgba(s % 2 ? 'light' : 'dark', 0.8 * w0)
    ctx.lineWidth = 2.4 * w0 + 0.5
    ctx.beginPath()
    ctx.moveTo(P.x + Math.cos(a) * len * 0.32, P.y + Math.sin(a) * len * 0.32)
    ctx.lineTo(P.x + Math.cos(a) * len, P.y + Math.sin(a) * len)
    ctx.stroke()
  }
  ctx.restore()
  if (progress < 0.62) {
    ctx.save()
    ctx.globalAlpha = 1 - progress / 0.62
    ctx.textAlign = 'center'
    ctx.font = FONT(13, true)
    ctx.fillStyle = '#fff6e0'
    ctx.fillText('相殺', P.x, P.y - 26 - progress * 16)
    ctx.restore()
  }
}

/** 敵ごとの残り HP を頭の上に短いバー＋数値で出す（射線上の敵は金色で強調）。 */
export function drawEnemyHpBars(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  enemies: Enemy[],
  hide: Set<string> | undefined,
  aimEnemyId: string | null | undefined,
): void {
  const rows = enemies.filter((e) => e.hp > 0 && !hide?.has(e.id))
  if (rows.length === 0) return
  const s = scaleOf(vp)
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  const placed: { x: number; y: number; w: number }[] = []
  for (const e of rows) {
    const P = toScreen(e.pos, vp)
    const hr = e.hitboxRadius * s
    const frac = Math.max(0, Math.min(1, e.hp / (e.maxHp || 1)))
    const W = Math.max(34, Math.min(74, hr * 2.6))
    const H = 5
    const x = Math.round(P.x - W / 2)
    let y = Math.round(P.y - hr - 16)
    for (let g = 0; g < 20; g++) {
      const c = placed.find((q) => Math.abs(q.x - (x + W / 2)) < (q.w + W) / 2 + 2 && Math.abs(q.y - y) < 15)
      if (!c) break
      y = c.y - 15
    }
    placed.push({ x: x + W / 2, y, w: W })
    const aim = !!aimEnemyId && e.id === aimEnemyId
    const bar = frac > 0.5 ? '#8fe0a0' : frac > 0.22 ? '#f4c65a' : '#ff6b52'
    ctx.fillStyle = 'rgba(4,4,10,.82)'
    ctx.fillRect(x - 2, y - 2, W + 4, H + 4)
    ctx.fillStyle = '#1b1b2e'
    ctx.fillRect(x, y, W, H)
    ctx.fillStyle = bar
    ctx.fillRect(x, y, Math.max(frac > 0 ? 1 : 0, Math.round(W * frac)), H)
    ctx.strokeStyle = aim ? 'rgba(255,230,160,.95)' : 'rgba(90,98,136,.85)'
    ctx.lineWidth = 1
    ctx.strokeRect(x - 0.5, y - 0.5, W + 1, H + 1)
    ctx.fillStyle = 'rgba(6,6,14,.7)'
    for (let k = 1; k < 4; k++) ctx.fillRect(Math.round(x + (W * k) / 4), y, 1, H)
    ctx.font = FONT(9, true)
    ctx.textAlign = 'center'
    const txt = `${Math.ceil(e.hp)}/${e.maxHp}`
    ctx.strokeStyle = '#05040b'
    ctx.lineWidth = 3
    ctx.strokeText(txt, x + W / 2, y - 3)
    ctx.fillStyle = aim ? '#ffe6a0' : '#c9d2e6'
    ctx.fillText(txt, x + W / 2, y - 3)
    if (e.boss) {
      ctx.strokeStyle = '#05040b'
      ctx.lineWidth = 3
      ctx.strokeText('☠', x - 8, y + H)
      ctx.fillStyle = '#ff9f7a'
      ctx.fillText('☠', x - 8, y + H)
    }
  }
  ctx.restore()
}

/** ダメージ数値：黒の輪郭＋オフセット影で盤面のどこでも読める（プロトタイプ v3 の _dmgNum）。 */
export function drawDamageNumber(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  size: number,
  alpha: number,
  heal = false,
): void {
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = FONT(size, true)
  ctx.lineJoin = 'miter'
  ctx.miterLimit = 2
  ctx.strokeStyle = '#05040b'
  ctx.lineWidth = Math.max(3, size * 0.26)
  ctx.strokeText(text, x, y)
  ctx.fillStyle = 'rgba(0,0,0,.85)'
  ctx.fillText(text, x + 2, y + 2)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  if (heal) {
    ctx.font = FONT(Math.round(size * 0.62), true)
    ctx.strokeText('＋', x - text.length * size * 0.4, y)
    ctx.fillText('＋', x - text.length * size * 0.4, y)
  }
  ctx.restore()
}
