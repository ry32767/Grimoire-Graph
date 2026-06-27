// Canvas 描画関数（機能3・5）。座標変換は coords に集約したものを使う。
import type { Attribute, Enemy, Field, Obstacle, Shield, Vec2 } from '../game/types'
import { FIELD } from '../data/constants'
import { toScreen, scaleOf, type Viewport } from '../game/coords'
import { COLORS, fieldTile, attrColor } from './theme'

/** 静的シーンの描画パラメータ */
export interface SceneParams {
  vp: Viewport
  field: Field
  enemies: Enemy[]
  obstacles: Obstacle[]
  shield: Shield | null
  /** プレイヤーのプレビュー軌道（数学座標の点列） */
  playerPath?: Vec2[] | null
  /** 敵ゴースト軌道（数学座標の点列の配列） */
  ghostPaths?: Vec2[][]
  /** 予測着弾点とその属性（機能17） */
  landing?: { pos: Vec2; attr: Attribute } | null
}

/** 背景：場の色分け（薄いタイル）と数学グリッド。 */
export function drawBackground(ctx: CanvasRenderingContext2D, vp: Viewport, field: Field): void {
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, vp.width, vp.height)

  // 場のタイル（約44分割）
  const cells = 44
  const cw = vp.width / cells
  const ch = vp.height / cells
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const px = (i + 0.5) * cw
      const py = (j + 0.5) * ch
      const mx = (px - vp.width / 2) / scaleOf(vp)
      const my = (vp.height / 2 - py) / scaleOf(vp)
      if (mx * mx + my * my > FIELD.rField * FIELD.rField) continue
      const z = field(mx, my)
      ctx.fillStyle = fieldTile(Number.isFinite(z) ? z : 0)
      ctx.fillRect(Math.floor(i * cw), Math.floor(j * ch), Math.ceil(cw), Math.ceil(ch))
    }
  }

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

/** 術者（原点）マーカー */
export function drawCaster(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const o = toScreen({ x: 0, y: 0 }, vp)
  ctx.fillStyle = COLORS.caster
  ctx.strokeStyle = COLORS.light1
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(o.x, o.y, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function drawCircle(ctx: CanvasRenderingContext2D, pos: Vec2, rUnits: number, vp: Viewport): void {
  const c = toScreen(pos, vp)
  ctx.beginPath()
  ctx.arc(c.x, c.y, rUnits * scaleOf(vp), 0, Math.PI * 2)
}

/** 敵の描画（属性で色分け・HPに応じてフェード） */
export function drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[], vp: Viewport): void {
  for (const e of enemies) {
    if (e.hp <= 0) continue
    const c = toScreen(e.pos, vp)
    ctx.fillStyle = e.element === 'light' ? 'rgba(244,196,48,0.85)' : 'rgba(123,92,196,0.85)'
    ctx.strokeStyle = COLORS.enemy
    ctx.lineWidth = 3
    const r = e.hitboxRadius * scaleOf(vp)
    // ドット風の四角＋円
    ctx.fillRect(c.x - r * 0.7, c.y - r * 0.7, r * 1.4, r * 1.4)
    drawCircle(ctx, e.pos, e.hitboxRadius, vp)
    ctx.stroke()
    // 名前
    ctx.fillStyle = COLORS.text
    ctx.font = '10px "DotGothic16", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(e.name, c.x, c.y - r - 4)
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

/** 静的シーン一式を描画する。 */
export function drawScene(ctx: CanvasRenderingContext2D, p: SceneParams): void {
  drawBackground(ctx, p.vp, p.field)

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

  // プレイヤーのプレビュー軌道
  if (p.playerPath && p.playerPath.length > 1) {
    ctx.strokeStyle = COLORS.light2
    ctx.lineWidth = 3
    strokePath(ctx, p.playerPath, p.vp)
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

/** 飛行中の弾（光=金スパーク、闇=紫の揺らぎ）。 */
export function drawBullet(ctx: CanvasRenderingContext2D, pos: Vec2, color: string, vp: Viewport): void {
  const c = toScreen(pos, vp)
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.arc(c.x, c.y, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
}

/** 暴発エフェクト（光と闇が混じる）。progress 0→1 で広がる。 */
export function drawMisfire(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  progress: number,
  vp: Viewport,
): void {
  const c = toScreen(pos, vp)
  const maxR = FIELD.aoeRadius * scaleOf(vp)
  const r = maxR * progress
  const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r + 1)
  grad.addColorStop(0, 'rgba(255,248,225,0.9)')
  grad.addColorStop(0.5, 'rgba(244,196,48,0.6)')
  grad.addColorStop(1, 'rgba(123,92,196,0.1)')
  ctx.fillStyle = grad
  ctx.globalAlpha = 1 - progress * 0.5
  ctx.beginPath()
  ctx.arc(c.x, c.y, r + 1, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}
