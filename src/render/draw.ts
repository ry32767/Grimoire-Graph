// Canvas 描画関数（機能3・5）。座標変換は coords に集約したものを使う。
import type { Attribute, Enemy, Obstacle, Shield, Vec2 } from '../game/types'
import { FIELD } from '../data/constants'
import { toScreen, scaleOf, type Viewport } from '../game/coords'
import { attributeOf, strengthOf } from '../game/attribute'
import { COLORS, attrColor } from './theme'

/** z つきの軌道点 */
export interface ZPoint {
  pos: Vec2
  z: number
}

/** 静的シーンの描画パラメータ */
export interface SceneParams {
  vp: Viewport
  enemies: Enemy[]
  obstacles: Obstacle[]
  shield: Shield | null
  /** プレイヤーのプレビュー軌道（z つき＝属性で色分け） */
  playerPath?: ZPoint[] | null
  /** 敵ゴースト軌道（数学座標の点列の配列） */
  ghostPaths?: Vec2[][]
  /** 予測着弾点とその属性（機能17） */
  landing?: { pos: Vec2; attr: Attribute } | null
}

/** 背景：数学グリッドと軸・場外境界（場のタイルは廃止）。 */
export function drawBackground(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, vp.width, vp.height)

  // グリッド線（数学ユニット）
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1
  for (let u = -FIELD.rField; u <= FIELD.rField; u += 2) {
    const a = toScreen({ x: u, y: -FIELD.rField }, vp)
    const b = toScreen({ x: u, y: FIELD.rField }, vp)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    const c = toScreen({ x: -FIELD.rField, y: u }, vp)
    const d = toScreen({ x: FIELD.rField, y: u }, vp)
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()
  }
  // 軸
  ctx.strokeStyle = COLORS.axis
  ctx.lineWidth = 2
  const o = toScreen({ x: 0, y: 0 }, vp)
  ctx.beginPath()
  ctx.moveTo(0, o.y)
  ctx.lineTo(vp.width, o.y)
  ctx.moveTo(o.x, 0)
  ctx.lineTo(o.x, vp.height)
  ctx.stroke()

  // 場外境界
  ctx.strokeStyle = 'rgba(120,110,180,0.4)'
  ctx.beginPath()
  ctx.arc(o.x, o.y, FIELD.rField * scaleOf(vp), 0, Math.PI * 2)
  ctx.stroke()
}

function strokePath(ctx: CanvasRenderingContext2D, pts: Vec2[], vp: Viewport): void {
  if (pts.length < 2) return
  ctx.beginPath()
  const p0 = toScreen(pts[0], vp)
  ctx.moveTo(p0.x, p0.y)
  for (let i = 1; i < pts.length; i++) {
    const p = toScreen(pts[i], vp)
    ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
}

// ===== ドット絵スプライト =====

/** 文字グリッドのスプライトを (cx,cy) 中心・1セル px で描く。'.'/' ' は透明。 */
function drawPixelSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rows: string[],
  palette: Record<string, string>,
  px: number,
): void {
  const w = rows[0].length
  const h = rows.length
  const ox = cx - (w * px) / 2
  const oy = cy - (h * px) / 2
  const s = Math.max(1, Math.ceil(px))
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const col = palette[rows[r][c]]
      if (!col) continue
      ctx.fillStyle = col
      ctx.fillRect(Math.round(ox + c * px), Math.round(oy + r * px), s, s)
    }
  }
}

// 魔導士（術者）
const MAGE_ROWS = [
  '...Y...',
  '..PPP..',
  '.PPPPP.',
  '..CCC..',
  '.GRRRG.',
  '.RRRRR.',
  '.R...R.',
  '.D...D.',
]
const MAGE_PAL: Record<string, string> = {
  Y: '#FFF8E1',
  P: '#7B5CC4',
  C: '#ffe9a8',
  G: '#F4C430',
  R: '#5a4a8a',
  D: '#2a2342',
}

// 光の敵（守護像）
const LIGHT_ENEMY_ROWS = ['.GGG.', 'GGGGG', 'GeWeG', 'GGGGG', '.G.G.', 'G...G']
const LIGHT_ENEMY_PAL: Record<string, string> = { G: '#F4C430', W: '#FFF8E1', e: '#3a2342' }

// 闇の敵（幽鬼）
const DARK_ENEMY_ROWS = ['.PPP.', 'PPPPP', 'PeWeP', 'PPPPP', '.PPP.', 'P.P.P']
const DARK_ENEMY_PAL: Record<string, string> = { P: '#7B5CC4', W: '#1E2A6B', e: '#FFF8E1' }

/** 術者（原点）：魔導士のドット絵＋淡いオーラ。 */
export function drawCaster(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const o = toScreen({ x: 0, y: 0 }, vp)
  // オーラ
  const grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 22)
  grad.addColorStop(0, 'rgba(244,196,48,0.35)')
  grad.addColorStop(1, 'rgba(244,196,48,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(o.x, o.y, 22, 0, Math.PI * 2)
  ctx.fill()
  const px = Math.max(2.5, scaleOf(vp) * 0.2)
  drawPixelSprite(ctx, o.x, o.y, MAGE_ROWS, MAGE_PAL, px)
}

/** 敵の描画（属性ごとのドット絵スプライト＋名前）。 */
export function drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[], vp: Viewport): void {
  for (const e of enemies) {
    if (e.hp <= 0) continue
    const c = toScreen(e.pos, vp)
    const r = e.hitboxRadius * scaleOf(vp)
    const light = e.element === 'light'
    // 淡いオーラ
    const aura = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 1.6)
    aura.addColorStop(0, light ? 'rgba(244,196,48,0.3)' : 'rgba(123,92,196,0.32)')
    aura.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = aura
    ctx.beginPath()
    ctx.arc(c.x, c.y, r * 1.6, 0, Math.PI * 2)
    ctx.fill()
    // スプライト
    const rows = light ? LIGHT_ENEMY_ROWS : DARK_ENEMY_ROWS
    const pal = light ? LIGHT_ENEMY_PAL : DARK_ENEMY_PAL
    const px = (e.hitboxRadius * scaleOf(vp) * 2) / rows[0].length
    drawPixelSprite(ctx, c.x, c.y, rows, pal, px)
    // 名前
    ctx.fillStyle = COLORS.text
    ctx.font = '10px "DotGothic16", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(e.name, c.x, c.y - r - 6)
  }
}

/** 障害物の描画 */
export function drawObstacles(ctx: CanvasRenderingContext2D, obstacles: Obstacle[], vp: Viewport): void {
  for (const o of obstacles) {
    if (o.durability <= 0) continue
    const c = toScreen(o.pos, vp)
    const r = o.hitboxRadius * scaleOf(vp)
    ctx.fillStyle = o.element === 'light' ? 'rgba(202,162,74,0.5)' : 'rgba(106,90,168,0.5)'
    ctx.strokeStyle = COLORS.obstacle
    ctx.lineWidth = 3
    ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2)
    ctx.strokeRect(c.x - r, c.y - r, r * 2, r * 2)
    // 耐久ゲージ
    const hpw = (o.durability / o.maxDurability) * r * 2
    ctx.fillStyle = COLORS.light2
    ctx.fillRect(c.x - r, c.y + r + 2, hpw, 3)
  }
}

/** 結界の描画 */
export function drawShield(ctx: CanvasRenderingContext2D, shield: Shield, vp: Viewport): void {
  const o = toScreen({ x: 0, y: 0 }, vp)
  const s = scaleOf(vp)
  ctx.strokeStyle = shield.element === 'light' ? COLORS.light1 : COLORS.dark1
  ctx.lineWidth = 3
  ctx.globalAlpha = 0.7
  ctx.beginPath()
  if (shield.shape === 'circle') {
    ctx.arc(o.x, o.y, (shield.params.R ?? 1) * s, 0, Math.PI * 2)
  } else {
    ctx.ellipse(o.x, o.y, (shield.params.a ?? 1) * s, (shield.params.b ?? 1) * s, 0, 0, Math.PI * 2)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

/** z（属性）で色分けして軌道を描く。中立は淡く、光=金・闇=紫。 */
function strokeZPath(ctx: CanvasRenderingContext2D, pts: ZPoint[], vp: Viewport): void {
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (let i = 1; i < pts.length; i++) {
    const a = toScreen(pts[i - 1].pos, vp)
    const b = toScreen(pts[i].pos, vp)
    const z = (pts[i - 1].z + pts[i].z) / 2
    const attr = attributeOf(z)
    const t = Math.min(strengthOf(z) / FIELD.sMax, 1)
    if (attr === 'neutral') {
      ctx.strokeStyle = 'rgba(220,220,235,0.45)'
      ctx.lineWidth = 2
    } else {
      ctx.strokeStyle = attr === 'light' ? COLORS.light1 : COLORS.dark1
      ctx.lineWidth = 2 + t * 3
    }
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.lineCap = 'butt'
}

/** 静的シーン一式を描画する。 */
export function drawScene(ctx: CanvasRenderingContext2D, p: SceneParams): void {
  drawBackground(ctx, p.vp)

  // 敵ゴースト軌道
  if (p.ghostPaths) {
    ctx.strokeStyle = COLORS.ghost
    ctx.lineWidth = 2
    ctx.setLineDash([5, 4])
    for (const path of p.ghostPaths) strokePath(ctx, path, p.vp)
    ctx.setLineDash([])
  }

  drawObstacles(ctx, p.obstacles, p.vp)
  if (p.shield) drawShield(ctx, p.shield, p.vp)
  drawEnemies(ctx, p.enemies, p.vp)

  // プレイヤーのプレビュー軌道（z で色分け）
  if (p.playerPath && p.playerPath.length > 1) {
    strokeZPath(ctx, p.playerPath, p.vp)
  }

  // 予測着弾点
  if (p.landing) {
    const c = toScreen(p.landing.pos, p.vp)
    ctx.strokeStyle = attrColor(p.landing.attr)
    ctx.fillStyle = attrColor(p.landing.attr)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(c.x, c.y, 8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  drawCaster(ctx, p.vp)
}

/** 飛行中の弾（十字スパーク＋グロー）。phase で煌めきを変える。 */
export function drawBullet(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  color: string,
  vp: Viewport,
  phase = 0,
): void {
  const c = toScreen(pos, vp)
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  // コア
  ctx.fillStyle = '#fff8e1'
  ctx.beginPath()
  ctx.arc(c.x, c.y, 3, 0, Math.PI * 2)
  ctx.fill()
  // 十字スパーク
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  const len = 6 + Math.sin(phase) * 2
  ctx.beginPath()
  ctx.moveTo(c.x - len, c.y)
  ctx.lineTo(c.x + len, c.y)
  ctx.moveTo(c.x, c.y - len)
  ctx.lineTo(c.x, c.y + len)
  ctx.stroke()
  ctx.restore()
}

/** 弾の軌跡（残像）。点列を新しいものほど濃く描く。 */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  color: string,
  vp: Viewport,
): void {
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 1; i < pts.length; i++) {
    const a = toScreen(pts[i - 1], vp)
    const b = toScreen(pts[i], vp)
    ctx.globalAlpha = (i / pts.length) * 0.6
    ctx.strokeStyle = color
    ctx.lineWidth = (i / pts.length) * 5
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.restore()
}

/** ドット爆発（暴発・#9）。グリッドに整列した四角ピクセルで 8bit 風に弾ける。progress 0→1。 */
export function drawMisfire(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  progress: number,
  vp: Viewport,
): void {
  const c = toScreen(pos, vp)
  const maxR = FIELD.aoeRadius * scaleOf(vp)
  const px = Math.max(4, Math.round(scaleOf(vp) * 0.32)) // ドットの一辺
  const r = maxR * progress
  ctx.save()
  // グリッド整列して四角を置く（ピクセルアート感）
  const cell = (gx: number, gy: number, col: string, a: number) => {
    ctx.globalAlpha = a
    ctx.fillStyle = col
    ctx.fillRect(Math.round((c.x + gx) / px) * px, Math.round((c.y + gy) / px) * px, px, px)
  }
  // 中心の閃光（白）：序盤に強く、消える
  const flash = Math.max(0, 1 - progress * 1.4)
  if (flash > 0) {
    cell(0, 0, '#fff8e1', flash)
    cell(px, 0, '#fff8e1', flash * 0.8)
    cell(-px, 0, '#fff8e1', flash * 0.8)
    cell(0, px, '#fff8e1', flash * 0.8)
    cell(0, -px, '#fff8e1', flash * 0.8)
  }
  // 放射状に飛び散るドット（光と闇が交互）。リング状に広がる。
  const rings = 3
  for (let ring = 0; ring < rings; ring++) {
    const rr = r * (0.5 + ring * 0.28)
    const count = 8 + ring * 4
    const fade = (1 - progress) * (1 - ring * 0.18)
    if (fade <= 0) continue
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + ring * 0.4 + progress * 0.8
      const gx = Math.cos(ang) * rr
      const gy = Math.sin(ang) * rr
      const col = (i + ring) % 2 === 0 ? COLORS.light1 : COLORS.dark1
      cell(gx, gy, col, Math.min(1, fade))
      // 中間に淡い火の粉
      if (ring === 0) cell(gx * 0.6, gy * 0.6, COLORS.light2, fade * 0.6)
    }
  }
  // 衝撃リング（中空の四角枠）
  ctx.globalAlpha = (1 - progress) * 0.8
  ctx.strokeStyle = progress < 0.5 ? COLORS.light1 : COLORS.dark1
  ctx.lineWidth = px * 0.6
  ctx.strokeRect(c.x - r, c.y - r, r * 2, r * 2)
  ctx.restore()
}
