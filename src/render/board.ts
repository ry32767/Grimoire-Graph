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
import { COMBAT, FIELD, SAMPLING } from '../data/constants'
import { COLORS } from './theme'
import { dot, dotPx, pixelDisc, pixelShockwave, snapAngle, walkPath } from './pixelfx'

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
  // 帯の太さ＝当たり判定の厚み（2×orbitBandHalf）をピクセルへ直したもの（#72）。**この値は動かさない**
  // ＝結界に触れる距離そのもの。滑らかな線ではなくこの太さの矩形を並べて描くだけで、
  // 判定は変えずに弾・軌跡と同じドット絵の粒度に揃う。
  // 速度・強度は太さでなく明るさで語らせる（判定と見た目を必ず一致させる）。
  const bandW = 2 * COMBAT.orbitBandHalf * scaleOf(vp)
  let bx = NaN
  let by = NaN
  walkPath(
    [...ring, ring[0]],
    n,
    (p) => toScreen(p.pos, vp),
    Math.max(2, dotPx(vp)),
    (x, y, src) => {
      if (!Number.isNaN(bx) && Math.hypot(x - bx, y - by) < bandW * 0.8) return
      bx = x
      by = y
      const f = Math.max(0, Math.min(1, (src.speed ?? 0) / VM))
      dot(ctx, x, y, bandW, zRgba(src.z, 1), 0.14 + f * 0.72)
    },
  )
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
  const unit = dotPx(vp)
  ctx.save()
  for (let k = 0; k < cnt; k++) {
    const i0 = Math.floor(ps[k]) % n
    const p = ring[i0]
    const sp = p.speed ?? 0
    // 粒は**その場のリング速度**で進む（遅い区間で詰まり速い区間で伸びる）。
    // 進め方は render/ringPhase.ts と同じ式＝片方だけ変えないこと。
    ps[k] = (ps[k] + (sp * dt) / segLen) % n
    if (sp <= 0.02) continue
    const P = toScreen(p.pos, vp)
    const at = attributeOf(p.z)
    const st = strengthOf(p.z)
    const f = Math.max(0, Math.min(1, sp / VM))
    // 大きさは 1〜3 ドットの段（速度＋強度）。滑らかに膨らませない
    const tier = 1 + Math.round(f * 1.2 + (st / FIELD.sMax) * 0.8)
    // 尾（速いほど長い）：帯を引かず、通り過ぎたサンプル位置にドットを落とす
    const back = Math.max(1, Math.round(2 + f * 10))
    for (let b = 1; b <= back; b++) {
      const j = ((i0 - b) % n + n) % n
      const T = toScreen(ring[j].pos, vp)
      dot(ctx, T.x, T.y, unit * (b < back / 2 ? 2 : 1), attrRgba(at, 1), (1 - b / back) * 0.55)
    }
    pixelDisc(ctx, P.x, P.y, tier, unit, attrRgba(at, 1), COLORS.light2)
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
  /** true なら見出しを伏せる（エンドロールの背景など、読ませる相手が居ない場面） */
  quiet = false,
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
      // 2 重は「全てが靄に沈む」＝中が一切見えない（#73）。
      // 平らな黒だと穴が開いたように見えるので、濃い靄をゆっくり渦巻かせる
      ctx.fillStyle = '#04030a'
      ctx.fillRect(0, 0, vp.width, vp.height)
      const ai = box(rings[i])
      const bj = box(rings[j])
      const mcx = (ai.cx + bj.cx) / 2
      const mcy = (ai.cy + bj.cy) / 2
      const span = Math.max(ai.x1 - ai.x0, bj.x1 - bj.x0)
      ctx.globalCompositeOperation = 'lighter'
      for (let k = 0; k < 11; k++) {
        const a = phase * 0.35 + (k * Math.PI * 2) / 11
        const rad = span * (0.16 + 0.11 * ((k % 3) + 1))
        const px = mcx + Math.cos(a) * span * (0.14 + (k % 4) * 0.06)
        const py = mcy + Math.sin(a * 0.8 + k) * span * (0.12 + (k % 3) * 0.05)
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad)
        g.addColorStop(0, `rgba(72,52,126,${(0.30 + Math.sin(phase * 0.8 + k) * 0.14).toFixed(3)})`)
        g.addColorStop(0.55, 'rgba(40,28,80,0.16)')
        g.addColorStop(1, 'rgba(20,12,40,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(px, py, rad, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
      const a = box(rings[i])
      const b = box(rings[j])
      const mx = (a.cx + b.cx) / 2
      const my = (a.cy + b.cy) / 2
      if (!quiet && Math.hypot(a.cx - b.cx, a.cy - b.cy) < (a.x1 - a.x0) / 2 + (b.x1 - b.x0) / 2) {
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
    if (!quiet) {
      ctx.textAlign = 'center'
      ctx.font = FONT(10, true)
      const lb = r.owner === 'enemy' ? '敵の闇幕' : '闇幕 — 相手から見えにくい'
      ctx.strokeStyle = '#04030a'
      ctx.lineWidth = 3.5
      ctx.strokeText(lb, b.cx, b.y0 - 6)
      ctx.fillStyle = 'rgba(195,182,255,.9)'
      ctx.fillText(lb, b.cx, b.y0 - 6)
    }
    ctx.restore()
  }
}

// ===== 飛翔中の演出 =====

/**
 * z（属性）と head（0=発射地点／1=弾の頭）から軌跡ドットの濃さを引く。
 * **戦闘アニメとエンドロールが必ず同じ見た目になるよう、濃さの規則はここ1か所に置く。**
 * なめらかにフェードさせず段で表現する（DESIGN.md §6・#74）のは光闇とも共通。
 * - 光＝パッと点く：頭側が早く全点灯に達する。
 * - 闇＝遅れて滲み出て、尾が長く残る：頭の直近だけ一段暗く、尾の減衰も緩やか。
 * - 無＝現状どおりの 3 段。
 */
export function trailDotAlpha(z: number, head: number): number {
  const at = attributeOf(z)
  if (at === 'light') return head > 0.55 ? 0.85 : head > 0.33 ? 0.5 : 0.25
  if (at === 'dark') return head > 0.92 ? 0.45 : head > 0.62 ? 0.7 : head > 0.3 ? 0.5 : 0.35
  return head > 0.66 ? 0.75 : head > 0.33 ? 0.5 : 0.25
}

/**
 * 通ってきた道（ドット絵の軌跡・#74）。連続した帯ではなく、**弧長で等間隔に置いたドット**で描く。
 * サンプル間隔は速度でばらつくので、弧長で歩き直さないとドットの密度が速度で変わってしまう
 * （`walkPath` がその歩き直しを担う）。
 * 濃さは「頭に近いほど濃い」段階（属性ごとの規則は `trailDotAlpha` を参照・なめらかにフェードさせない）。
 */
export function drawFlightPath(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pts: PreviewPoint[],
  upto: number,
  phase: number,
  sizeFrac: (speed: number, z: number) => number,
): void {
  if (upto < 1) return
  const unit = dotPx(vp)
  const toPx = (p: PreviewPoint): Vec2 => toScreen(p.pos, vp)
  ctx.save()
  // ①② 属性色のドット＋白熱の芯を 1 周で打つ。
  //   大きさ＝属性強度 |z|（#74・trailWidthPx を格子へ量子化したもの）、芯の明るさ＝威力（速度×強度）。
  //   **ドットの間隔はその場の大きさに合わせる**：歩幅を固定にすると太い所ほど重なりが増えて
  //   のっぺりした帯に戻ってしまう。大きさの 0.8 倍ずつ進めて、わずかに重ねながら粒を並べる。
  let lx = NaN
  let ly = NaN
  walkPath(pts, upto, toPx, Math.max(2, unit), (x, y, src, _i, head) => {
    const w = trailWidthPx(src.z, vp)
    if (!Number.isNaN(lx) && Math.hypot(x - lx, y - ly) < w * 0.8) return
    lx = x
    ly = y
    const a = trailDotAlpha(src.z, head)
    dot(ctx, x, y, w, zRgba(src.z, 1), a)
    const fr = sizeFrac(src.speed, src.z)
    if (fr > 0.04) dot(ctx, x, y, Math.max(2, unit), COLORS.light2, fr * (0.25 + head * 0.6))
  })
  // ③ 道に落ちた燐光（段で明滅して残る）
  for (let i = 6; i <= upto; i += 10) {
    const A = pts[i]
    if (!A) break
    const P = toScreen(A.pos, vp)
    const fr = sizeFrac(A.speed, A.z)
    const tw = Math.sin(phase * 1.6 + i * 0.7) > 0 ? 1 : 0.45
    dot(ctx, P.x, P.y, unit * (fr > 0.5 ? 2 : 1), zRgba(A.z, 1), 0.3 * tw * (0.4 + fr))
  }
  ctx.restore()
}

/**
 * 威力を語るドット絵の煙（#74）。頭の後ろに四角い粒を置いて、外へ流れながら消える。
 * 粒の数は固定（12）で、位置はサンプル添字と phase から決まる＝毎フレーム跳ねず、負荷も一定。
 * 大きさ・濃さが威力（速度×強度）に比例するので、「重い魔法ほどもうもうと煙る」。
 */
export function drawPowerSmoke(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pts: PreviewPoint[],
  idx: number,
  phase: number,
  powerFrac: number,
): void {
  if (powerFrac <= 0.06 || idx < 2) return
  const PUFFS = 12
  ctx.save()
  for (let k = 0; k < PUFFS; k++) {
    const back = 2 + k * 3
    const j = idx - back
    if (j < 0) break
    const a = pts[j]
    const b = pts[Math.min(j + 1, pts.length - 1)]
    if (!a || !b) break
    const P = toScreen(a.pos, vp)
    const Q = toScreen(b.pos, vp)
    const dx = Q.x - P.x
    const dy = Q.y - P.y
    const m = Math.hypot(dx, dy) || 1
    // 進行方向の法線へ、後ろほど大きく開きながら流れる
    const spread = (k / PUFFS) * (5 + powerFrac * 18)
    const side = k % 2 === 0 ? 1 : -1
    const wob = Math.sin(phase * 1.3 + k * 1.9) * 0.6
    const ox = (-dy / m) * (spread * side + wob)
    const oy = (dx / m) * (spread * side + wob)
    const fade = 1 - k / PUFFS
    const px = Math.max(2, Math.round((2.5 + powerFrac * 7) * fade))
    ctx.globalAlpha = Math.min(0.85, (0.25 + powerFrac) * fade * 0.9)
    // 手前は白熱、後ろは属性色に冷える（色相は属性のまま＝威力は明るさで語る）
    ctx.fillStyle = k < 3 ? 'rgba(255,248,225,1)' : zRgba(a.z, 1)
    ctx.fillRect(Math.round(P.x + ox - px / 2), Math.round(P.y + oy - px / 2), px, px)
  }
  ctx.restore()
}

/** 飛行の軌跡の太さ（ユニット・#74）：属性強度 |z| が 0 のときの下限。 */
const TRAIL_W_MIN = 0.12
/**
 * 軌跡の最大の太さ（ユニット・#74）。**弾の本体（＝当たり判定 2×bulletRadius）より必ず細い**こと。
 * 太い軌跡を当たり判定と読み違えないよう、本体の最小直径（2×bulletRadiusMin）の 6 割に抑える。
 * bulletRadiusMin から導くので、当たり半径を調整しても勝手にズレない。
 */
const TRAIL_W_MAX = COMBAT.bulletRadiusMin * 1.2

/**
 * z（属性強度）から軌跡の太さ（画面ピクセル）を引く（#74）。
 * **戦闘アニメとエンドロールが必ず同じ見た目になるよう、太さの規則はここ1か所に置く。**
 * 値は**ドット格子の整数倍へ丸める**：軌跡もドットで描くので、格子に乗らない太さは
 * 弾・スプライトと粒度がズレて「にじんだ帯」に見える。丸め幅は 1 ドット（±unit/2）で、
 * TRAIL_W_MAX（≈1.02 ユニット）に足しても弾の最小直径（2×bulletRadiusMin＝1.7 ユニット）を
 * 超えない＝「軌跡を当たり判定と読み違えない」規則は保たれる。
 */
export function trailWidthPx(z: number, vp: Viewport): number {
  const f = Math.min(1, strengthOf(z) / FIELD.sMax)
  const raw = (TRAIL_W_MIN + (TRAIL_W_MAX - TRAIL_W_MIN) * f) * scaleOf(vp)
  const unit = dotPx(vp)
  return Math.max(unit, Math.round(raw / unit) * unit)
}

/**
 * 発射の閃光（詠唱の瞬間・術者位置から広がる輪）。progress 0→1。
 * 半径は従来どおり 4→26px で、**進み方だけを 5 段**にして格子へ丸める。
 */
export function drawLaunchFlash(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pos: Vec2,
  z: number,
  progress: number,
): void {
  const P = toScreen(pos, vp)
  const col = zRgba(z, 1)
  ctx.save()
  pixelShockwave(ctx, P.x, P.y, 4, 22, progress, 5, dotPx(vp), col, col, 1 - progress)
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
  const unit = dotPx(vp)
  ctx.save()
  for (let s = 0; s < 3; s++) {
    const j = Math.max(0, idx - 2 - s * 2)
    const b = pts[j]
    if (!b) break
    const B = toScreen(b.pos, vp)
    const a = (1 - s / 3) * 0.6 * frac
    const size = unit * (frac > 0.5 && s === 0 ? 2 : 1)
    // 揺れも 1 ドット刻み（サブピクセルで震えさせない）
    const wob = (Math.sin(phase * 3 + s * 2.1) > 0 ? 1 : -1) * unit
    dot(ctx, B.x + wob, B.y - wob, size, zRgba(b.z, 1), a)
  }
  ctx.restore()
}

/**
 * ドットの衝撃波（着弾・相殺の共通語彙・#77）。滑らかに広がる輪の代わりに、
 * **段で広がる**（進行を離散化し、半径をドット格子へ丸める）。段数が威力に比例するので、
 * 「重い魔法ほど遠くまで」が段の数として読める。
 * 粒は 1 つおきに白熱と属性色を交互に置く＝ドット絵らしい 2 色のちらつき。
 *
 * **半径そのものは元の絶対ピクセル式**（`r0 + span`）を保つ：段数からピクセルを組み立て直すと
 * 縮尺の小さい盤面で輪が数分の一に縮んでしまう（`pixelfx.pixelShockwave` の注記）。
 */
export function drawPixelBurst(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pos: Vec2,
  attr: Attribute,
  powerFrac: number,
  progress: number,
  r0: number,
  span: number,
): void {
  if (progress < 0 || progress >= 1) return
  const P = toScreen(pos, vp)
  ctx.save()
  pixelShockwave(
    ctx,
    P.x,
    P.y,
    r0,
    span,
    progress,
    2 + Math.round(powerFrac * 4),
    dotPx(vp),
    COLORS.light2,
    attrRgba(attr, 1),
    1 - progress,
  )
  ctx.restore()
}

/** 着弾の衝撃波（対象の位置から広がるドットの輪・半径 6→36px）。progress 0→1。 */
export function drawImpactShockwave(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pos: Vec2,
  progress: number,
): void {
  drawPixelBurst(ctx, vp, pos, 'neutral', 0.5, progress, 6, 30)
}

/**
 * 相殺の火花そのもの（文字なし）。二重の衝撃波＋白熱の核＋光闇の破片。
 * **エンドロールと本編で必ず同じ見た目になるよう、火花の実体はここ 1 か所に置く**
 * （かつてエンドロールが同じ絵を独自に書き直していて、片方だけドット絵から取り残された）。
 */
export function drawParryFlash(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pos: Vec2,
  power: number,
  progress: number,
): void {
  if (progress < 0 || progress >= 1) return
  const TAU = Math.PI * 2
  const P = toScreen(pos, vp)
  const pw = Math.min(1, power / 140)
  const unit = dotPx(vp)
  ctx.save()
  // ① 二重の衝撃波：着弾（drawPixelBurst）と同じ段の輪を、光・闇の順に半拍ずらして重ねる。
  //   半径は従来どおり `9+pw×22 → +44+pw×66`＝**盤面いっぱいに走る大きさ**（相殺は必ず目に入れる）
  for (let k = 0; k < 2; k++) {
    const q = Math.min(1, Math.max(0, (progress - k * 0.16) / 0.84))
    if (q <= 0) continue
    drawPixelBurst(ctx, vp, pos, k === 0 ? 'light' : 'dark', pw, q, 9 + pw * 22, 44 + pw * 66)
  }
  // ② 白熱の核：段で欠けていくドットの円盤（グラデーションで滲ませない）
  const coreTier = Math.round((2 + pw * 3) * (1 - progress))
  if (coreTier >= 1) pixelDisc(ctx, P.x, P.y, coreTier, unit, COLORS.light2, '#ffffff', 1 - progress)
  // ③ 光闇の破片：1 ドットずつ並べた線が外へ伸びる（相殺＝両極が弾け飛ぶ）
  const n = 12 + Math.round(pw * 10)
  const w0 = 1 - progress
  const len = (20 + pw * 52) * Math.pow(progress, 0.55)
  for (let s = 0; s < n; s++) {
    const a = snapAngle((s / n) * TAU + pos.x * 0.7 + pos.y * 0.3)
    const col = attrRgba(s % 2 ? 'light' : 'dark', 1)
    for (let d = len * 0.32; d <= len; d += unit) {
      dot(ctx, P.x + Math.cos(a) * d, P.y + Math.sin(a) * d, unit, col, 0.8 * w0)
    }
  }
  ctx.restore()
}

/**
 * 結界と魔法が相殺した瞬間（パリィ）。火花（drawParryFlash）＋「相殺」の文字で必ず目に入るようにする。
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
  drawParryFlash(ctx, vp, pos, power, progress)
  if (progress < 0.62) {
    const P = toScreen(pos, vp)
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

/** 光の結界（回復のオーラ）を描くための1枚（#73）。 */
export interface LightRing {
  ring: ZPoint[]
  owner: 'ally' | 'enemy'
}

/**
 * 光の結界の内側に「癒やしの場」を描く（#73）。
 * 闇幕（drawDarkVeil）と対になる表現で、**囲まれている＝毎ターン回復している**ことを目で分かるようにする。
 * - 内側に暖色のグラデーションを敷き、光の粒がゆっくり上へ昇る
 * - 縁は流れる破線＋「癒やしの輪」の見出し
 * - **2 枚が重なった範囲は効果も 2 重**（engine は内側優先で最大2つ・turn.ts §5.5）なので、
 *   重なりだけを一段明るく塗り、「二重回復」を出す
 */
export function drawLightAura(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  rings: LightRing[],
  phase: number,
  /** true なら見出しを伏せる（エンドロールの背景など、読ませる相手が居ない場面） */
  quiet = false,
): void {
  if (rings.length === 0) return
  const path = (r: LightRing) => {
    ctx.beginPath()
    r.ring.forEach((p, i) => {
      const P = toScreen(p.pos, vp)
      if (i === 0) ctx.moveTo(P.x, P.y)
      else ctx.lineTo(P.x, P.y)
    })
    ctx.closePath()
  }
  const box = (r: LightRing) => {
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
    const rad = Math.max(8, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2)
    ctx.save()
    path(r)
    ctx.clip()
    // 内側の暖かい下地（中心ほど淡く、縁に向かって金色が乗る）
    const g = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, rad)
    g.addColorStop(0, 'rgba(244,198,90,0.05)')
    g.addColorStop(0.72, 'rgba(244,198,90,0.10)')
    g.addColorStop(1, 'rgba(255,226,150,0.20)')
    ctx.fillStyle = g
    ctx.fillRect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8)
    // 昇る光の粒（位置は index 由来で安定。phase でゆっくり上へ流れる）
    ctx.globalCompositeOperation = 'lighter'
    const N = 18
    const h = b.y1 - b.y0 + 8
    for (let i = 0; i < N; i++) {
      const u = (i * 0.6180339887) % 1
      const x = b.x0 + u * (b.x1 - b.x0)
      const y = b.y1 - (((phase * 22 + i * 37) % h) )
      const a = 0.5 + Math.sin(phase * 1.6 + i) * 0.3
      const rr = 1.2 + ((i % 3) * 0.5)
      ctx.fillStyle = `rgba(255,236,176,${Math.max(0, a * 0.55).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, y, rr, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
    // 縁：流れる破線＋見出し
    ctx.save()
    path(r)
    ctx.strokeStyle = 'rgba(255,214,120,.62)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.lineDashOffset = phase * 6
    ctx.stroke()
    ctx.setLineDash([])
    if (!quiet) {
      ctx.textAlign = 'center'
      ctx.font = FONT(10, true)
      const lb = r.owner === 'enemy' ? '敵の癒やしの輪' : '癒やしの輪 — 毎ターン回復'
      ctx.strokeStyle = '#120c04'
      ctx.lineWidth = 3.5
      ctx.strokeText(lb, b.cx, b.y0 - 6)
      ctx.fillStyle = '#ffd98a'
      ctx.fillText(lb, b.cx, b.y0 - 6)
    }
    ctx.restore()
  }

  // 重なり＝効果も2重（engine は内側優先で最大2つ）。重なりだけを明るく塗って知らせる
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      if (rings[i].owner !== rings[j].owner) continue
      ctx.save()
      path(rings[i])
      ctx.clip()
      path(rings[j])
      ctx.clip()
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = `rgba(255,226,150,${(0.10 + Math.sin(phase * 2) * 0.03).toFixed(3)})`
      ctx.fillRect(0, 0, vp.width, vp.height)
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
      const a = box(rings[i])
      const b = box(rings[j])
      if (!quiet && Math.hypot(a.cx - b.cx, a.cy - b.cy) < (a.x1 - a.x0) / 2 + (b.x1 - b.x0) / 2) {
        ctx.save()
        ctx.textAlign = 'center'
        ctx.font = FONT(11, true)
        ctx.strokeStyle = '#120c04'
        ctx.lineWidth = 3.5
        const mx = (a.cx + b.cx) / 2
        const my = (a.cy + b.cy) / 2
        ctx.strokeText('二重回復', mx, my + 4)
        ctx.fillStyle = '#ffe9ad'
        ctx.fillText('二重回復', mx, my + 4)
        ctx.restore()
      }
    }
  }
}
