// Canvas 描画関数（機能3・5・#15）。座標変換は coords に集約したものを使う。
import type { Ally, Attribute, Enemy, Obstacle, Vec2, ZPoint } from '../game/types'
import { FIELD } from '../data/constants'
import { toScreen, scaleOf, type Viewport } from '../game/coords'
import { attributeOf, strengthOf } from '../game/attribute'
import { COLORS, attrColor } from './theme'

export type { ZPoint }

/** 静的シーンの描画パラメータ */
export interface SceneParams {
  vp: Viewport
  allies: Ally[]
  enemies: Enemy[]
  obstacles: Obstacle[]
  /** 現在編集中の味方（強調表示） */
  activeAllyId?: string | null
  /** 各味方のプレビュー軌道（z つき＝属性で色分け。発射型=飛行軌道／軌道型=リング） */
  playerPaths?: (ZPoint[] | null)[]
  /** 敵ゴースト軌道（数学座標の点列の配列） */
  ghostPaths?: Vec2[][]
  /** 予測着弾点とその属性（機能17） */
  landings?: ({ pos: Vec2; attr: Attribute } | null)[]
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

/** 味方術者（#15）：各自の配置に魔導士のドット絵＋属性オーラ＋名前。active は強調。 */
export function drawCasters(
  ctx: CanvasRenderingContext2D,
  allies: Ally[],
  vp: Viewport,
  activeAllyId?: string | null,
): void {
  const s = scaleOf(vp)
  for (const a of allies) {
    const o = toScreen(a.pos, vp)
    const dead = a.hp <= 0
    const aura =
      a.element === 'light'
        ? 'rgba(244,196,48,'
        : a.element === 'dark'
          ? 'rgba(123,92,196,'
          : 'rgba(180,180,200,'
    const grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 20)
    grad.addColorStop(0, aura + (dead ? 0.06 : 0.36) + ')')
    grad.addColorStop(1, aura + '0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(o.x, o.y, 20, 0, Math.PI * 2)
    ctx.fill()
    // アクティブ強調リング
    if (a.id === activeAllyId && !dead) {
      ctx.strokeStyle = COLORS.light2
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.arc(o.x, o.y, 18, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    const px = Math.max(2, s * 0.16)
    ctx.globalAlpha = dead ? 0.3 : 1
    drawPixelSprite(ctx, o.x, o.y, MAGE_ROWS, MAGE_PAL, px)
    ctx.globalAlpha = 1
    // 名前
    ctx.fillStyle = dead ? '#666' : COLORS.text
    ctx.font = '9px "DotGothic16", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(a.name, o.x, o.y + px * 5)
  }
}

const FAMILY_LABEL: Record<Enemy['family'], string> = {
  line: '直進',
  arc: '弧',
  wave: '波',
  spiral: '渦',
}

/** 敵の得意関数（系統）を表す小さなドット記号（#17：見た目で判別）。 */
function drawFamilyGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  family: Enemy['family'],
  color: string,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  if (family === 'line') {
    ctx.moveTo(cx - 9, cy)
    ctx.lineTo(cx + 9, cy)
    ctx.stroke()
  } else if (family === 'arc') {
    ctx.moveTo(cx - 9, cy + 3)
    ctx.quadraticCurveTo(cx, cy - 8, cx + 9, cy + 3)
    ctx.stroke()
  } else if (family === 'wave') {
    ctx.moveTo(cx - 9, cy)
    ctx.quadraticCurveTo(cx - 4.5, cy - 7, cx, cy)
    ctx.quadraticCurveTo(cx + 4.5, cy + 7, cx + 9, cy)
    ctx.stroke()
  } else {
    // spiral：渦巻き
    for (let i = 0; i < 16; i++) {
      const t = i / 3
      const rr = 1 + t * 1.1
      ctx.lineTo(cx + Math.cos(t * 2) * rr, cy + Math.sin(t * 2) * rr)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/** 敵の描画（属性ごとのドット絵スプライト＋得意関数記号＋名前）。 */
export function drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[], vp: Viewport): void {
  for (const e of enemies) {
    if (e.hp <= 0) continue
    const c = toScreen(e.pos, vp)
    const r = e.hitboxRadius * scaleOf(vp)
    const light = e.element === 'light'
    const tint = light ? COLORS.light1 : COLORS.dark1
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
    // 得意関数の記号
    drawFamilyGlyph(ctx, c.x, c.y + r + 12, e.family, tint)
    // 名前＋系統ラベル
    ctx.fillStyle = COLORS.text
    ctx.font = '10px "DotGothic16", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`${e.name}〔${FAMILY_LABEL[e.family]}〕`, c.x, c.y - r - 6)
  }
}

const OBSTACLE_FILL: Record<Attribute, string> = {
  light: 'rgba(120,98,46,0.94)',
  dark: 'rgba(62,52,104,0.94)',
  neutral: 'rgba(64,64,80,0.92)',
}

// 障害物レイヤー用のオフスクリーン（穴抜きを障害物だけに閉じ込めるため・フレーム間で再利用）
let obstacleLayer: HTMLCanvasElement | null = null

/**
 * 障害物の描画（Graph War 風）。solids（円の和＝ブロブ）を塗り、carves の円を
 * destination-out で抜いて滑らかにえぐる。各障害物ごとにオフスクリーンをクリアして
 * 合成するので、穴はその障害物の素材だけを削り、向こうの場が透けて見える。
 */
export function drawObstacles(ctx: CanvasRenderingContext2D, obstacles: Obstacle[], vp: Viewport): void {
  if (obstacles.length === 0) return
  const s = scaleOf(vp)
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  if (!obstacleLayer) obstacleLayer = document.createElement('canvas')
  const layer = obstacleLayer
  if (layer.width !== W || layer.height !== H) {
    layer.width = W
    layer.height = H
  }
  const lx = layer.getContext('2d')
  if (!lx) return

  for (const o of obstacles) {
    if (o.solids.length === 0) continue
    lx.clearRect(0, 0, W, H)
    // ブロブ本体（円の和を塗る）
    lx.globalCompositeOperation = 'source-over'
    lx.fillStyle = OBSTACLE_FILL[o.element]
    for (const d of o.solids) {
      const c = toScreen({ x: d.x, y: d.y }, vp)
      lx.beginPath()
      lx.arc(c.x, c.y, d.r * s, 0, Math.PI * 2)
      lx.fill()
    }
    // えぐり取った穴を抜く（滑らかな円形の削れ）
    lx.globalCompositeOperation = 'destination-out'
    for (const c0 of o.carves) {
      const c = toScreen({ x: c0.x, y: c0.y }, vp)
      lx.beginPath()
      lx.arc(c.x, c.y, c0.r * s, 0, Math.PI * 2)
      lx.fill()
    }
    lx.globalCompositeOperation = 'source-over'
    ctx.drawImage(layer, 0, 0)
  }
}

/** z（属性）で色分けして軌道を描く。中立は淡く、光=金・闇=紫。 */
export function strokeZPath(ctx: CanvasRenderingContext2D, pts: ZPoint[], vp: Viewport): void {
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

/** 予測着弾点マーカー。 */
function drawLanding(
  ctx: CanvasRenderingContext2D,
  landing: { pos: Vec2; attr: Attribute },
  vp: Viewport,
): void {
  const c = toScreen(landing.pos, vp)
  ctx.strokeStyle = attrColor(landing.attr)
  ctx.fillStyle = attrColor(landing.attr)
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
  drawEnemies(ctx, p.enemies, p.vp)

  // 各味方のプレビュー軌道（z で色分け）
  if (p.playerPaths) {
    for (const path of p.playerPaths) {
      if (path && path.length > 1) strokeZPath(ctx, path, p.vp)
    }
  }

  // 予測着弾点
  if (p.landings) {
    for (const l of p.landings) if (l) drawLanding(ctx, l, p.vp)
  }

  drawCasters(ctx, p.allies, p.vp, p.activeAllyId)
}

/** 飛行中の弾（多層グロー＋脈動コア＋回転スパーク・#11）。phase で煌めきを変える。 */
export function drawBullet(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  color: string,
  vp: Viewport,
  phase = 0,
): void {
  const c = toScreen(pos, vp)
  const pulse = 1 + Math.sin(phase * 1.7) * 0.25
  ctx.save()
  // 外側グロー
  const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 14 * pulse)
  glow.addColorStop(0, color)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = 0.5
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(c.x, c.y, 14 * pulse, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.shadowColor = color
  ctx.shadowBlur = 14
  // 回転スパーク（4方向＋斜め）
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  const len = 7 + Math.sin(phase) * 2.5
  for (let i = 0; i < 4; i++) {
    const a = phase * 0.5 + (i * Math.PI) / 2
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(c.x + Math.cos(a) * len, c.y + Math.sin(a) * len)
    ctx.stroke()
  }
  // コア
  ctx.fillStyle = '#fff8e1'
  ctx.beginPath()
  ctx.arc(c.x, c.y, 3.2 * pulse, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** 小さな周回パーティクル（軌道型魔法・#24）。グロー＋白コア。 */
export function drawParticle(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  color: string,
  vp: Viewport,
  phase = 0,
): void {
  const c = toScreen(pos, vp)
  const r = 2.4 + Math.sin(phase) * 0.9
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.globalAlpha = 0.9
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#fff8e1'
  ctx.beginPath()
  ctx.arc(c.x, c.y, r * 0.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * 障害物を削る瞬間のパーティクル（#11）。当たった点から石片＝四角ドットが飛び散り、
 * 中心が閃く。progress 0→1 で広がりながら消える。attr で色（光=金・闇=紫）。
 */
export function drawCarveBurst(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  r: number,
  attr: Attribute,
  progress: number,
  vp: Viewport,
): void {
  if (progress < 0 || progress >= 1) return
  const c = toScreen(pos, vp)
  const s = scaleOf(vp)
  const px = Math.max(3, Math.round(s * 0.34))
  const col = attr === 'light' ? COLORS.light1 : attr === 'dark' ? COLORS.dark1 : COLORS.light2
  const spread = (r + 2) * s
  ctx.save()
  // 中心の閃光（序盤に白く弾ける）
  const flash = Math.max(0, 1 - progress * 2.4)
  if (flash > 0) {
    ctx.globalAlpha = flash
    ctx.shadowColor = col
    ctx.shadowBlur = 10
    ctx.fillStyle = '#fff8e1'
    const fr = px * 1.4
    ctx.fillRect(Math.round(c.x - fr), Math.round(c.y - fr), fr * 2, fr * 2)
    ctx.shadowBlur = 0
  }
  // 飛び散る石片（角度を散らし、距離は progress で広がる・重力で少し落ちる）
  const n = 12
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + i * 1.7
    const reach = 0.55 + ((i * 37) % 10) / 9
    const dist = spread * (0.2 + progress * 1.05) * reach
    const gx = c.x + Math.cos(ang) * dist
    const gy = c.y + Math.sin(ang) * dist + progress * progress * px * 2.5 // 重力で落下
    ctx.globalAlpha = Math.max(0, 1 - progress) * 0.95
    ctx.fillStyle = i % 3 === 0 ? COLORS.light2 : col
    const sz = Math.max(1, px * (1 - progress * 0.55))
    ctx.fillRect(Math.round(gx - sz / 2), Math.round(gy - sz / 2), sz, sz)
  }
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
