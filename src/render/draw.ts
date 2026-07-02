// Canvas 描画関数（機能3・5・#15）。座標変換は coords に集約したものを使う。
import type { Ally, Attribute, Enemy, Obstacle, ObstacleKind, Vec2, ZPoint } from '../game/types'
import { FIELD } from '../data/constants'
import { toScreen, scaleOf, type Viewport } from '../game/coords'
import { attributeOf, strengthOf } from '../game/attribute'
import { COLORS } from './theme'

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
  /** 各味方の暴発（関数エラー）点。プレビューで赤い✕として可視化する。エラー無しは null */
  misfirePoints?: (Vec2 | null)[]
  /** 敵ゴースト軌道（数学座標の点列の配列） */
  ghostPaths?: Vec2[][]
  /** 崩し手（#42）の予告：計画された暴発点（赤✕＋揺れる円）。無い敵は null */
  ghostMisfires?: (Vec2 | null)[]
  /** 被弾中の対象ID→フラッシュ強度（1→0）。赤く光って揺れる（#20） */
  flash?: Record<string, number>
  /** 揺れの位相（時間とともに増加） */
  shakePhase?: number
  /** 軌跡アニメの位相（パーティクルが揺れ・波が流れる。作成フェーズで進める） */
  trailPhase?: number
  /** 編集中の z 場 z=f(x,y)（#37）。showZField の間だけ薄い場として表示する */
  zField?: (x: number, y: number) => number
  /** z 場をいじっている間だけ true：場のプレビューを表示する（#37） */
  showZField?: boolean
}

/** 被弾の揺れ量（px）。強度と位相・IDシードで上下左右に細かく震える（#20）。 */
function shakeOffset(intensity: number, phase: number, seed: number): Vec2 {
  if (intensity <= 0) return { x: 0, y: 0 }
  const amp = intensity * 5
  return {
    x: Math.sin(phase * 1.3 + seed) * amp,
    y: Math.cos(phase * 1.7 + seed * 1.5) * amp,
  }
}

/** 被弾の赤フラッシュを (cx,cy) 中心・半径 r で重ねる（#20）。 */
function drawHitFlash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  intensity: number,
): void {
  if (intensity <= 0) return
  ctx.save()
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, `rgba(255,72,72,${0.75 * intensity})`)
  g.addColorStop(0.6, `rgba(255,40,40,${0.4 * intensity})`)
  g.addColorStop(1, 'rgba(255,0,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** 文字列IDから安定した擬似乱数シードを作る（揺れの位相ずらし用）。 */
function idSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000
  return h
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
  flash?: Record<string, number>,
  shakePhase = 0,
): void {
  const s = scaleOf(vp)
  for (const a of allies) {
    const o0 = toScreen(a.pos, vp)
    const intensity = flash?.[a.id] ?? 0
    const sh = shakeOffset(intensity, shakePhase, idSeed(a.id))
    const o = { x: o0.x + sh.x, y: o0.y + sh.y }
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
    // 闇の周回で隠れているほど薄れる（#35）。完全隠蔽はほぼ透明＝敵から見えない
    const conceal = a.concealed ?? 0
    const concealAlpha = conceal >= 2 ? 0.22 : conceal === 1 ? 0.55 : 1
    const px = Math.max(2, s * 0.16)
    ctx.globalAlpha = dead ? 0.3 : concealAlpha
    drawPixelSprite(ctx, o.x, o.y, MAGE_ROWS, MAGE_PAL, px)
    ctx.globalAlpha = 1
    // 隠蔽中は闇のもやを重ねる
    if (!dead && conceal > 0) {
      const veil = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 22)
      veil.addColorStop(0, 'rgba(40,28,72,0)')
      veil.addColorStop(1, `rgba(30,20,56,${conceal >= 2 ? 0.7 : 0.4})`)
      ctx.fillStyle = veil
      ctx.beginPath()
      ctx.arc(o.x, o.y, 22, 0, Math.PI * 2)
      ctx.fill()
    }
    // 名前
    ctx.fillStyle = dead ? '#666' : COLORS.text
    ctx.font = '9px "DotGothic16", monospace'
    ctx.textAlign = 'center'
    ctx.fillText(a.name, o.x, o.y + px * 5)
    // 被弾の赤フラッシュ（#20）
    drawHitFlash(ctx, o.x, o.y, 22, intensity)
  }
}

const FAMILY_LABEL: Record<Enemy['family'], string> = {
  line: '直進',
  arc: '弧',
  wave: '波',
  spiral: '渦',
  exp: '昇り',
  poly34: '捻れ',
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
  } else if (family === 'exp') {
    // 指数（#43）：平坦から終盤で鋭く立ち上がる
    ctx.moveTo(cx - 9, cy + 5)
    ctx.quadraticCurveTo(cx + 4, cy + 4, cx + 8, cy - 7)
    ctx.stroke()
  } else if (family === 'poly34') {
    // 3/4次（#43）：S字の捻れ
    ctx.moveTo(cx - 9, cy + 5)
    ctx.bezierCurveTo(cx - 2, cy - 9, cx + 2, cy + 9, cx + 9, cy - 5)
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

/** 敵の戦い方ロールを縁取りで示す（#27/#28）。guardian=二重結界／breaker=砕き縁。 */
function drawRoleMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  role: Enemy['role'],
  color: string,
): void {
  if (!role || role === 'attacker') return
  ctx.save()
  ctx.strokeStyle = color
  if (role === 'guardian') {
    // 二重の結界リング（守りを表す）
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 1.5
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  } else if (role === 'breaker') {
    // 尖った砕き縁（攻め崩しを表す）
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 2
    const spikes = 10
    ctx.beginPath()
    for (let i = 0; i <= spikes; i++) {
      const a = (i / spikes) * Math.PI * 2
      const rr = r + (i % 2 === 0 ? 6 : 1)
      const x = cx + Math.cos(a) * rr
      const y = cy + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  } else if (role === 'ruptor') {
    // ひび割れた記号（#42：崩し手の専用警告。family の glyph とは別に見分けられる）
    ctx.globalAlpha = 0.9
    ctx.strokeStyle = '#ff4b4b'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (const a0 of [0.4, 2.2, 4.1]) {
      // 縁から外へ走る稲妻状のひび（3本）
      const x0 = cx + Math.cos(a0) * r
      const y0 = cy + Math.sin(a0) * r
      ctx.moveTo(x0, y0)
      ctx.lineTo(x0 + Math.cos(a0 + 0.5) * 4, y0 + Math.sin(a0 + 0.5) * 4)
      ctx.lineTo(x0 + Math.cos(a0 - 0.2) * 8, y0 + Math.sin(a0 - 0.2) * 8)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/** 敵の描画（属性ごとのドット絵スプライト＋得意関数記号＋名前）。 */
export function drawEnemies(
  ctx: CanvasRenderingContext2D,
  enemies: Enemy[],
  vp: Viewport,
  flash?: Record<string, number>,
  shakePhase = 0,
): void {
  for (const e of enemies) {
    if (e.hp <= 0) continue
    const c0 = toScreen(e.pos, vp)
    const intensity = flash?.[e.id] ?? 0
    const sh = shakeOffset(intensity, shakePhase, idSeed(e.id))
    const c = { x: c0.x + sh.x, y: c0.y + sh.y }
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
    // 暗い背板＋属性色の縁取り（軌跡や背景に紛れず際立つ・#27）
    ctx.fillStyle = 'rgba(12,10,24,0.78)'
    ctx.beginPath()
    ctx.arc(c.x, c.y, r * 1.18, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = tint
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(c.x, c.y, r * 1.18, 0, Math.PI * 2)
    ctx.stroke()
    // 戦い方ロールの縁取り（#27/#28）：guardian=二重結界リング／breaker=尖った砕き縁
    drawRoleMarker(ctx, c.x, c.y, r * 1.18, e.role, tint)
    // スプライト
    const rows = light ? LIGHT_ENEMY_ROWS : DARK_ENEMY_ROWS
    const pal = light ? LIGHT_ENEMY_PAL : DARK_ENEMY_PAL
    const px = (e.hitboxRadius * scaleOf(vp) * 2) / rows[0].length
    drawPixelSprite(ctx, c.x, c.y, rows, pal, px)
    // 得意関数の記号（特性の紋章＝暗い円板に乗せて目立たせる・#27）
    const gx = c.x + r * 1.1
    const gy = c.y - r * 1.1
    ctx.fillStyle = 'rgba(12,10,24,0.9)'
    ctx.beginPath()
    ctx.arc(gx, gy, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = tint
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(gx, gy, 10, 0, Math.PI * 2)
    ctx.stroke()
    drawFamilyGlyph(ctx, gx, gy, e.family, tint)
    // 名前＋系統＋ロールラベル
    ctx.fillStyle = COLORS.text
    ctx.font = '10px "DotGothic16", monospace'
    ctx.textAlign = 'center'
    const roleTag =
      e.role === 'guardian' ? '・守' : e.role === 'breaker' ? '・破' : e.role === 'ruptor' ? '・崩' : ''
    ctx.fillText(`${e.name}〔${FAMILY_LABEL[e.family]}${roleTag}〕`, c.x, c.y - r - 6)
    // 被弾の赤フラッシュ（#20）
    drawHitFlash(ctx, c.x, c.y, r * 1.5, intensity)
  }
}

const OBSTACLE_FILL: Record<Attribute, string> = {
  light: 'rgba(120,98,46,0.94)',
  dark: 'rgba(62,52,104,0.94)',
  neutral: 'rgba(64,64,80,0.92)',
}

// 無属性の壁は種別ごとに石の色を変えて、削れやすさが一目で分かるようにする（#40）。
const KIND_FILL: Partial<Record<ObstacleKind, string>> = {
  fragile: 'rgba(110,106,122,0.9)', // もろい灰色の石（明るめ）
  tough: 'rgba(56,56,70,0.96)', // 鋲打ちの濃い石
  unbreakable: 'rgba(24,24,32,0.98)', // 黒く鈍い鋼
}

/** 壁の塗り色：種別（無属性の頑丈/もろい/砕けぬ）優先、なければ属性色（#40）。 */
function obstacleFill(o: Obstacle): string {
  const k = o.kind
  if (k && k !== 'normal' && KIND_FILL[k]) return KIND_FILL[k] as string
  return OBSTACLE_FILL[o.element]
}

/**
 * 壁の素材に種別ごとのテクスチャを重ねる（#40）。source-atop で素材内だけに描く前提。
 * 属性/normal=石積みの目地、fragile=ひび割れ、tough=鋲打ち格子、unbreakable=鋼の斜めシェブロン。
 */
function drawObstacleTexture(
  lx: CanvasRenderingContext2D,
  o: Obstacle,
  vp: Viewport,
  s: number,
): void {
  if (o.solids.length === 0) return
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const d of o.solids) {
    minX = Math.min(minX, d.x - d.r)
    maxX = Math.max(maxX, d.x + d.r)
    minY = Math.min(minY, d.y - d.r)
    maxY = Math.max(maxY, d.y + d.r)
  }
  const tl = toScreen({ x: minX, y: maxY }, vp) // y 反転：maxY が画面上
  const br = toScreen({ x: maxX, y: minY }, vp)
  const x0 = tl.x
  const y0 = tl.y
  const x1 = br.x
  const y1 = br.y
  const kind = o.kind ?? 'normal'
  lx.save()
  if (kind === 'unbreakable') {
    lx.strokeStyle = 'rgba(150,162,190,0.5)'
    lx.lineWidth = Math.max(1.5, s * 0.06)
    const gap = Math.max(6, s * 0.5)
    for (let x = x0 - (y1 - y0); x < x1; x += gap) {
      lx.beginPath()
      lx.moveTo(x, y1)
      lx.lineTo(x + (y1 - y0), y0)
      lx.stroke()
    }
  } else if (kind === 'tough') {
    lx.fillStyle = 'rgba(158,158,180,0.5)'
    const gap = Math.max(8, s * 0.7)
    const rv = Math.max(1.2, s * 0.07)
    for (let y = y0 + gap * 0.5; y < y1; y += gap)
      for (let x = x0 + gap * 0.5; x < x1; x += gap) {
        lx.beginPath()
        lx.arc(x, y, rv, 0, Math.PI * 2)
        lx.fill()
      }
  } else if (kind === 'fragile') {
    lx.strokeStyle = 'rgba(228,228,238,0.45)'
    lx.lineWidth = Math.max(1, s * 0.04)
    const gap = Math.max(12, s * 1.0)
    for (let x = x0 + gap * 0.4; x < x1; x += gap) {
      let cx = x
      let cy = y0
      lx.beginPath()
      lx.moveTo(cx, cy)
      while (cy < y1) {
        cy += gap * 0.6
        cx += ((Math.floor(cx) % 7) - 3) * (s * 0.02) // ジグザグの亀裂
        lx.lineTo(cx, cy)
      }
      lx.stroke()
    }
  } else {
    // 属性付き/normal：石積みの横目地
    lx.strokeStyle = 'rgba(0,0,0,0.22)'
    lx.lineWidth = Math.max(1, s * 0.03)
    const gap = Math.max(6, R_OBSTACLE * s * 0.9)
    for (let y = y0; y < y1; y += gap) {
      lx.beginPath()
      lx.moveTo(x0, y)
      lx.lineTo(x1, y)
      lx.stroke()
    }
  }
  lx.restore()
}

/** 石積み目地の間隔基準（壁の円半径の目安・stages の R と揃える）。 */
const R_OBSTACLE = 2.4

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
    lx.fillStyle = obstacleFill(o)
    for (const d of o.solids) {
      const c = toScreen({ x: d.x, y: d.y }, vp)
      lx.beginPath()
      lx.arc(c.x, c.y, d.r * s, 0, Math.PI * 2)
      lx.fill()
    }
    // 種別テクスチャを素材内だけに重ねる（source-atop で solids の上にのみ描く・#40）
    lx.globalCompositeOperation = 'source-atop'
    drawObstacleTexture(lx, o, vp, s)
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

/** リング点列を画面座標の閉パスにする（クリップ用）。 */
function ringScreenPath(ctx: CanvasRenderingContext2D, ring: ZPoint[], vp: Viewport): void {
  ctx.beginPath()
  for (let i = 0; i < ring.length; i++) {
    const s = toScreen(ring[i].pos, vp)
    if (i === 0) ctx.moveTo(s.x, s.y)
    else ctx.lineTo(s.x, s.y)
  }
  ctx.closePath()
}

/**
 * 闇の周回の内側を暗くしてぼかす（#39：プレイヤー視点の視認性低下）。
 * リング内側のキャンバスを自分自身へぼかして描き直し、暗い幕を重ねる。
 * 1重で半分ほど見えにくく、2つの円が重なる領域はぼかし・暗化が重なってほぼ見えなくなる。
 */
export function drawConcealVeil(ctx: CanvasRenderingContext2D, ring: ZPoint[], vp: Viewport): void {
  if (ring.length < 3) return
  ctx.save()
  ringScreenPath(ctx, ring, vp)
  ctx.clip()
  // ぼかし：クリップ内（リング内側）だけをぼかして描き直す
  ctx.filter = 'blur(3px)'
  ctx.drawImage(ctx.canvas, 0, 0)
  ctx.filter = 'none'
  // 暗化の幕（重なるほど濃く＝2重でほぼ真っ暗）
  ctx.fillStyle = 'rgba(6,5,14,0.5)'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

/** z（属性）で色分けして軌道を描く。中立は淡く、光=金・闇=紫。 */
export function strokeZPath(ctx: CanvasRenderingContext2D, pts: ZPoint[], vp: Viewport): void {
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    if (!p0 || !p1) continue // 念のため：欠損点があってもクラッシュしない
    const a = toScreen(p0.pos, vp)
    const b = toScreen(p1.pos, vp)
    const z = (p0.z + p1.z) / 2
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

// 軌跡の波の最大振幅（px）と空間周波数（#11：強属性ほど大きく波打つ）
const TRAIL_MAX_AMP = 6
const TRAIL_FREQ = 0.13

/** 軌跡の属性色（光＝金・闇＝紫・無＝灰白）。 */
function trailColorOf(z: number): string {
  const a = attributeOf(z)
  return a === 'light' ? COLORS.light1 : a === 'dark' ? COLORS.dark1 : 'rgba(214,214,228,1)'
}

/**
 * 魔法の軌跡（#11）。経路に沿って**逆位相の sin 波を2本**重ねて編み込み、振幅は属性強度、
 * 色は光（金）/闇（紫）/無（灰白）。波の節からパーティクルが法線方向に揺れて出て、光闇の質感を出す。
 * phase を進めると波が流れ・粒が揺れる（発射アニメ中・作成フェーズの残存トレイル両方で使う）。
 */
export function drawWaveTrail(
  ctx: CanvasRenderingContext2D,
  pts: ZPoint[],
  vp: Viewport,
  phase = 0,
  alpha = 1,
): void {
  if (pts.length < 2) return
  const sp = pts.map((p) => toScreen(p.pos, vp))
  // 画面上の累積弧長（波の位相に使う）
  const arc: number[] = [0]
  for (let i = 1; i < sp.length; i++) {
    arc[i] = arc[i - 1] + Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y)
  }
  // 経路の法線（接線に直交）
  const normalAt = (i: number): Vec2 => {
    const a = sp[Math.max(0, i - 1)]
    const b = sp[Math.min(sp.length - 1, i + 1)]
    const tx = b.x - a.x
    const ty = b.y - a.y
    const len = Math.hypot(tx, ty) || 1
    return { x: -ty / len, y: tx / len }
  }
  const ampAt = (i: number): number => (strengthOf(pts[i].z) / FIELD.sMax) * TRAIL_MAX_AMP

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineWidth = 1.7
  ctx.lineCap = 'round'
  // 逆位相の2本の sin 波（sign=±1 で位相を反転＝編み込み）
  for (const sign of [1, -1]) {
    const disp = sp.map((p, i) => {
      const off = sign * ampAt(i) * Math.sin(TRAIL_FREQ * arc[i] - phase)
      const n = normalAt(i)
      return { x: p.x + n.x * off, y: p.y + n.y * off }
    })
    for (let i = 1; i < disp.length; i++) {
      ctx.strokeStyle = trailColorOf((pts[i - 1].z + pts[i].z) / 2)
      ctx.beginPath()
      ctx.moveTo(disp[i - 1].x, disp[i - 1].y)
      ctx.lineTo(disp[i].x, disp[i].y)
      ctx.stroke()
    }
  }
  // 軌跡から法線方向にゆっくり揺れて出るパーティクル（ぼやけた光闇のもや・#11）
  // 中心から透明へ落ちる柔らかいグラデの粒にして、チカチカせず滲むように見せる。
  for (let i = 0; i < sp.length; i += 6) {
    const amp = ampAt(i)
    const n = normalAt(i)
    const sway = Math.sin(phase * 0.8 + i * 0.4) * (2 + amp)
    const px = sp[i].x + n.x * sway
    const py = sp[i].y + n.y * sway
    const col = trailColorOf(pts[i].z)
    const rr = 4 + (amp / TRAIL_MAX_AMP) * 3.5 // 大きめ＝ぼやけ
    const g = ctx.createRadialGradient(px, py, 0, px, py, rr)
    g.addColorStop(0, col)
    g.addColorStop(0.5, col)
    g.addColorStop(1, 'transparent')
    ctx.globalAlpha = alpha * 0.4
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, py, rr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * z 場（属性の高さ）を薄い場として描く（#37）。z をいじっている間だけ表示し、敵・壁より下のレイヤに置く。
 * 格子状にサンプルし、光（z>0）=金・闇（z<0）=紫で、強度（|z|→zPeak付近で最大）ほど濃く塗る。
 */
export function drawZFieldOverlay(
  ctx: CanvasRenderingContext2D,
  zField: (x: number, y: number) => number,
  vp: Viewport,
): void {
  const step = 2 // ユニット（方眼1.0刻みに合わせた粗さ）
  const s = scaleOf(vp)
  const cell = step * s
  ctx.save()
  for (let x = -FIELD.rField; x <= FIELD.rField; x += step) {
    for (let y = -FIELD.rField; y <= FIELD.rField; y += step) {
      if (Math.hypot(x, y) > FIELD.rField) continue
      const z = zField(x, y)
      if (!Number.isFinite(z)) continue
      const attr = attributeOf(z)
      if (attr === 'neutral') continue
      const t = Math.min(strengthOf(z) / FIELD.sMax, 1)
      const c = toScreen({ x, y }, vp)
      ctx.fillStyle =
        attr === 'light' ? `rgba(244,196,48,${0.04 + t * 0.16})` : `rgba(123,92,196,${0.05 + t * 0.18})`
      ctx.fillRect(c.x - cell / 2, c.y - cell / 2, cell + 1, cell + 1)
    }
  }
  ctx.restore()
}

/** 極とみなす |z| の発散しきい（ここを超えて伸び続ければ極＝発散と判定）。 */
const ERR_BLOWUP = 500

/**
 * 符号が反転する 2 点間が「極（発散）」かを二分法で判定する（#30）。
 * 符号反転点へ寄せていき、|z| が際限なく増大（非有限/ERR_BLOWUP 超え）すれば極（1/x 型）。
 * 連続関数の零点（|z| は 0 へ収束）と区別できる＝急峻でも有界な場を誤検出しない。
 */
function isPoleBetween(
  zf: (x: number, y: number) => number,
  ax: number, ay: number, za: number,
  bx: number, by: number, zb: number,
): boolean {
  if (!Number.isFinite(za) || !Number.isFinite(zb)) return true
  if (za === 0 || zb === 0 || Math.sign(za) === Math.sign(zb)) return false
  for (let k = 0; k < 16; k++) {
    const mx = (ax + bx) / 2
    const my = (ay + by) / 2
    const zm = zf(mx, my)
    if (!Number.isFinite(zm)) return true
    if (Math.abs(zm) > ERR_BLOWUP) return true // 寄せるほど発散＝極
    if (Math.sign(zm) === Math.sign(za)) { ax = mx; ay = my; za = zm }
    else { bx = mx; by = my; zb = zm }
  }
  return false // 零点へ収束した（有界）＝極ではない
}

/**
 * z 場（属性関数）が**エラーになる地点を全て**赤で可視化する（#30）。
 * 場を走査し、(1) 非有限（NaN/±∞＝sqrt(-1)・log(0) など定義域外）の点を赤で塗り、
 * (2) 隣接サンプル間で符号反転する箇所を二分法で調べ、極（発散）なら赤で塗る。
 * 極は赤い線として、定義域外は赤い領域として現れる。編集中（showZField）だけ表示する。
 */
export function drawZFieldErrors(
  ctx: CanvasRenderingContext2D,
  zField: (x: number, y: number) => number,
  vp: Viewport,
): void {
  const step = 0.8 // ユニット
  const s = scaleOf(vp)
  const cell = step * s
  const R = FIELD.rField
  const xs: number[] = []
  for (let x = -R; x <= R + 1e-9; x += step) xs.push(x)
  ctx.save()
  ctx.fillStyle = 'rgba(255,60,60,0.5)'
  const mark = (x: number, y: number) => {
    const c = toScreen({ x, y }, vp)
    ctx.fillRect(c.x - cell / 2, c.y - cell / 2, cell + 1, cell + 1)
  }
  let prevRow: number[] | null = null
  for (let y = -R; y <= R + 1e-9; y += step) {
    const row: number[] = []
    let prevZ: number | null = null
    for (let xi = 0; xi < xs.length; xi++) {
      const x = xs[xi]
      const inField = Math.hypot(x, y) <= R
      const z = inField ? zField(x, y) : NaN
      row.push(z)
      if (!inField) {
        prevZ = null
        continue
      }
      if (!Number.isFinite(z)) {
        mark(x, y) // 定義域外（NaN/±∞）
        prevZ = null
        continue
      }
      // 横方向（左隣）／縦方向（上の行）の符号反転が極かを調べる（隣が有限な点のみ）
      if (prevZ !== null && isPoleBetween(zField, x - step, y, prevZ, x, y, z)) mark(x - step / 2, y)
      else if (prevRow && Number.isFinite(prevRow[xi]) && isPoleBetween(zField, x, y - step, prevRow[xi], x, y, z))
        mark(x, y - step / 2)
      prevZ = z
    }
    prevRow = row
  }
  ctx.restore()
}

/** 静的シーン一式を描画する。 */
export function drawScene(ctx: CanvasRenderingContext2D, p: SceneParams): void {
  drawBackground(ctx, p.vp)

  // 編集中の z 場を薄い場として表示（#37）。敵・壁より下のレイヤ＝背景直後に描く
  if (p.showZField && p.zField) {
    drawZFieldOverlay(ctx, p.zField, p.vp)
    // 場がエラーになる地点を全て赤で可視化（極=線・定義域外=領域・#30）
    drawZFieldErrors(ctx, p.zField, p.vp)
  }

  // 敵ゴースト軌道
  if (p.ghostPaths) {
    ctx.strokeStyle = COLORS.ghost
    ctx.lineWidth = 2
    ctx.setLineDash([5, 4])
    for (const path of p.ghostPaths) strokePath(ctx, path, p.vp)
    ctx.setLineDash([])
  }

  drawObstacles(ctx, p.obstacles, p.vp)

  // 各味方のプレビュー軌道（z で色分け）。敵より先に描き、敵に被らせない（#27）。
  // #37：軌跡のみを表示し、着弾点（どこで途切れるか）のマーカーは出さない。
  if (p.playerPaths) {
    for (const path of p.playerPaths) {
      if (path && path.length > 1) strokeZPath(ctx, path, p.vp)
    }
  }

  // 敵・術者は軌跡の上に描く（軌跡で隠れない・#27）
  drawEnemies(ctx, p.enemies, p.vp, p.flash, p.shakePhase)
  drawCasters(ctx, p.allies, p.vp, p.activeAllyId, p.flash, p.shakePhase)

  // 関数エラーで暴発する点を赤い✕で可視化（最前面・#30）
  if (p.misfirePoints) {
    for (const m of p.misfirePoints) if (m) drawMisfireMarker(ctx, m, p.vp)
  }

  // 崩し手の暴発予告（#42）：赤✕＋不安定に揺れる円を重ねる（最前面）
  // 作成フェーズは trailPhase が時間で進むので、それを揺れの位相に使う
  if (p.ghostMisfires) {
    const phase = p.shakePhase ?? p.trailPhase ?? 0
    for (const m of p.ghostMisfires) if (m) drawRuptureWarning(ctx, m, p.vp, phase)
  }
}

/**
 * 崩し手（ruptor・#42）の暴発予告：赤い✕（プレイヤーの暴発プレビューと同じ）＋
 * AoE の見込み範囲を示す、不安定に揺れる破線円を重ねる。
 */
export function drawRuptureWarning(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  vp: Viewport,
  phase = 0,
): void {
  const c = toScreen(pos, vp)
  const base = FIELD.aoeRadius * scaleOf(vp)
  const wobble = 1 + 0.06 * Math.sin(phase * 2.1) + 0.04 * Math.sin(phase * 3.7 + 1.3)
  ctx.save()
  ctx.strokeStyle = 'rgba(255,75,75,0.65)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 5])
  ctx.lineDashOffset = -phase * 6
  ctx.beginPath()
  ctx.arc(c.x, c.y, base * wobble, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
  drawMisfireMarker(ctx, pos, vp)
}

/** プレビュー：関数（軌道 or z 場）がエラーで暴発する点を赤い✕で示す（#30）。 */
export function drawMisfireMarker(ctx: CanvasRenderingContext2D, pos: Vec2, vp: Viewport): void {
  const c = toScreen(pos, vp)
  const r = 7
  ctx.save()
  ctx.strokeStyle = '#ff4b4b'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.shadowColor = '#ff2a2a'
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.moveTo(c.x - r, c.y - r)
  ctx.lineTo(c.x + r, c.y + r)
  ctx.moveTo(c.x + r, c.y - r)
  ctx.lineTo(c.x - r, c.y + r)
  ctx.stroke()
  ctx.restore()
}

/** z（属性の高さ）から弾の色を選ぶ。光=金・闇=紫・中立=淡い白。 */
export function bulletColorOf(z: number): string {
  const a = attributeOf(z)
  return a === 'light' ? COLORS.light1 : a === 'dark' ? COLORS.dark1 : '#d9d4ea'
}

/**
 * 威力（=速度×強度）を 0..1 に正規化する。魔法の見た目サイズに使う（#21）。
 * 最大威力（最強属性 sMax × 終端速度 maxFlightSpeed）で 1。発射型の弾・軌道型の粒で共通に使う。
 */
export function powerSizeFrac(speed: number, z: number): number {
  const p = strengthOf(z) * Math.max(0, speed)
  return Math.min(1, p / (FIELD.sMax * FIELD.maxFlightSpeed))
}

/**
 * 飛行中の弾（多層グロー＋脈動コア＋回転スパーク・#11/#21）。
 * 発射されると z 場の値で色と形が変わる：属性で色、強度(|z|→V付近で最大)でグロー半径・スパーク数が増える。
 */
export function drawBullet(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  z: number,
  vp: Viewport,
  phase = 0,
  speed = 0,
): void {
  const c = toScreen(pos, vp)
  const color = bulletColorOf(z)
  const strength = strengthOf(z) // 0..sMax
  const sFrac = Math.min(1, strength / FIELD.sMax) // 0..1
  // 威力 = 速度 × 強度。威力が大きいほど弾も大きくなる（#11/#21）
  const powerFrac = powerSizeFrac(speed, z)
  const sizeFrac = Math.max(sFrac * 0.4, powerFrac) // 強属性は最低限の存在感、威力が高いほど大きく
  const pulse = 1 + Math.sin(phase * 1.7) * 0.25
  // 威力が大きいほど大きく・強いほど棘が多い（#21：形が z で変わる）
  const glowR = (9 + sizeFrac * 18) * pulse
  const spikes = 4 + Math.round(sFrac * 4)
  const coreR = (2.0 + sizeFrac * 3.4) * pulse
  ctx.save()
  const glow = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glowR)
  glow.addColorStop(0, color)
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = 0.5 + sFrac * 0.25
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(c.x, c.y, glowR, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.shadowColor = color
  ctx.shadowBlur = 12 + sFrac * 10
  // 回転スパーク（強度で本数が増える）
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  const len = 6 + sFrac * 5 + Math.sin(phase) * 2.5
  for (let i = 0; i < spikes; i++) {
    const a = phase * 0.5 + (i * Math.PI * 2) / spikes
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(c.x + Math.cos(a) * len, c.y + Math.sin(a) * len)
    ctx.stroke()
  }
  // コア
  ctx.fillStyle = '#fff8e1'
  ctx.beginPath()
  ctx.arc(c.x, c.y, coreR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * 小さな周回パーティクル（軌道型魔法・#24）。グロー＋白コア。
 * sizeScale（0..1＝威力）で粒の大きさが変わる。威力が高い周回ほど太く見える（#21）。
 */
export function drawParticle(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  color: string,
  vp: Viewport,
  phase = 0,
  sizeScale = 0.5,
): void {
  const c = toScreen(pos, vp)
  const r = 1.8 + sizeScale * 2.6 + Math.sin(phase) * 0.7
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 8 + sizeScale * 8
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
 * 発射魔法が速度0で霧散するときの演出（#38）：核が小さくなりながら、粒が外へ散って消える。
 * 周回の霧散（drawOrbitDissipation）と同じ「散って消える」質感を点で表す。sizeFrac は威力（大きさ）。
 */
export function drawBulletDissipation(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  z: number,
  progress: number,
  vp: Viewport,
  sizeFrac = 0.5,
): void {
  if (progress < 0 || progress >= 1) return
  const c = toScreen(pos, vp)
  const col = bulletColorOf(z)
  const s = scaleOf(vp)
  // 縮む核（progress とともに小さくなる）
  const coreR = (2 + sizeFrac * 4) * (1 - progress)
  if (coreR > 0.3) {
    ctx.save()
    ctx.globalAlpha = (1 - progress) * 0.9
    ctx.shadowColor = col
    ctx.shadowBlur = 10
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.arc(c.x, c.y, coreR, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff8e1'
    ctx.beginPath()
    ctx.arc(c.x, c.y, coreR * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  // 外へ散る粒（周回の霧散と同じ質感）
  ctx.save()
  const N = 12
  const out = progress * (3 + sizeFrac * 3) * s
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + i * 0.7
    ctx.globalAlpha = Math.max(0, 1 - progress) * 0.8
    ctx.fillStyle = col
    ctx.shadowColor = col
    ctx.shadowBlur = 8
    const rr = (1.5 + sizeFrac * 1.5) * (1 - progress)
    ctx.beginPath()
    ctx.arc(c.x + Math.cos(a) * out, c.y + Math.sin(a) * out, Math.max(0.4, rr), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * 周回軌道が壁に当たって霧散する演出（#34）。周回はせず、リングが一瞬現れて
 * 重心から外側へ粒が散り、薄れて消える（progress 0→1 で一度きり）。
 */
export function drawOrbitDissipation(
  ctx: CanvasRenderingContext2D,
  ring: ZPoint[],
  progress: number,
  vp: Viewport,
): void {
  const len = ring.length
  if (len < 2 || progress < 0 || progress >= 1) return
  // 重心（≒術者位置）
  let cx = 0
  let cy = 0
  for (const p of ring) {
    cx += p.pos.x
    cy += p.pos.y
  }
  cx /= len
  cy /= len
  // 薄れていくリング本体
  const fade = Math.max(0, 1 - progress * 1.8)
  if (fade > 0) {
    ctx.save()
    ctx.globalAlpha = 0.22 * fade
    strokeZPath(ctx, ring, vp)
    ctx.restore()
  }
  // 外向きに散る粒（霧散）
  ctx.save()
  const N = 28
  for (let n = 0; n < N; n++) {
    const idx = Math.floor((n / N) * (len - 1))
    const p = ring[idx]
    if (!p) continue
    const dx = p.pos.x - cx
    const dy = p.pos.y - cy
    const dl = Math.hypot(dx, dy) || 1
    const out = progress * 5
    const c = toScreen({ x: p.pos.x + (dx / dl) * out, y: p.pos.y + (dy / dl) * out }, vp)
    const col = trailColorOf(p.z)
    ctx.globalAlpha = Math.max(0, 1 - progress) * 0.85
    ctx.fillStyle = col
    ctx.shadowColor = col
    ctx.shadowBlur = 9
    const rr = 2.4 + (1 - progress) * 1.6
    ctx.beginPath()
    ctx.arc(c.x, c.y, rr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * 障害物を削る瞬間のパーティクル（#11/#38）。当たった点から石片＝四角ドットが飛び散り、
 * 中心が閃く。progress 0→1 で広がりながら消える。壁ヒットは赤いパーティクル（発射型/周回ともに・#38）。
 * attr は引数に残すが色は赤系で統一する。大きさ（半径 r）は威力に依存する（呼び出し側で計算）。
 */
export function drawCarveBurst(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  r: number,
  _attr: Attribute,
  progress: number,
  vp: Viewport,
): void {
  if (progress < 0 || progress >= 1) return
  const c = toScreen(pos, vp)
  const s = scaleOf(vp)
  const px = Math.max(3, Math.round(s * 0.34))
  const col = '#ff5a44' // 壁ヒットは赤（#38）
  const colAlt = '#ff9166' // 明るい赤橙（火花の混色）
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
    ctx.fillStyle = i % 3 === 0 ? colAlt : col
    const sz = Math.max(1, px * (1 - progress * 0.55))
    ctx.fillRect(Math.round(gx - sz / 2), Math.round(gy - sz / 2), sz, sz)
  }
  ctx.restore()
}

/**
 * パリィ／結界の衝突火花（#20/#38）。中心が白く弾け、青を基調に光闇を少し混ぜた火花が放射状に飛び散り、
 * 青いパーティクルが散る。大きさは威力（sizeFrac 0..1）に依存し、パリィは2魔法の威力合計で大きくなる。
 */
export function drawClashSpark(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  progress: number,
  vp: Viewport,
  sizeFrac = 0.5,
): void {
  if (progress < 0 || progress >= 1) return
  const c = toScreen(pos, vp)
  const s = scaleOf(vp)
  const scale = 0.6 + Math.min(1, Math.max(0, sizeFrac)) * 1.4 // 威力で大きさが変わる（#38）
  const reach = (2 + progress * 4) * s * scale
  ctx.save()
  // 中心の白い閃光（青みがかった発光）
  const flash = Math.max(0, 1 - progress * 2)
  if (flash > 0) {
    ctx.globalAlpha = flash
    ctx.shadowColor = '#bfe3ff'
    ctx.shadowBlur = 14
    ctx.fillStyle = '#fff8e1'
    ctx.beginPath()
    ctx.arc(c.x, c.y, (3 + flash * 3) * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }
  // 放射状の火花：青を基調に光（金）闇（紫）を少し混ぜる（#38）
  const n = 12
  ctx.lineWidth = 1.5 + Math.min(1, sizeFrac) * 2.5
  ctx.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + progress * 1.5
    ctx.globalAlpha = Math.max(0, 1 - progress) * 0.9
    ctx.strokeStyle =
      i % 5 === 0 ? COLORS.light1 : i % 5 === 2 ? COLORS.dark1 : i % 2 === 0 ? '#5aa8ff' : '#9ad0ff'
    ctx.beginPath()
    ctx.moveTo(c.x + Math.cos(a) * reach * 0.4, c.y + Math.sin(a) * reach * 0.4)
    ctx.lineTo(c.x + Math.cos(a) * reach, c.y + Math.sin(a) * reach)
    ctx.stroke()
  }
  // 散る青いパーティクル（#38）
  const m = 8
  for (let i = 0; i < m; i++) {
    const a = (i / m) * Math.PI * 2 + progress * 2 + 0.5
    const d = reach * (0.3 + progress * 0.8)
    ctx.globalAlpha = Math.max(0, 1 - progress) * 0.85
    ctx.fillStyle = i % 2 === 0 ? '#7ec0ff' : '#bfe3ff'
    ctx.shadowColor = '#5aa8ff'
    ctx.shadowBlur = 8
    const rr = (1.5 + Math.min(1, sizeFrac) * 2) * (1 - progress * 0.5)
    ctx.beginPath()
    ctx.arc(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, Math.max(0.5, rr), 0, Math.PI * 2)
    ctx.fill()
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

/**
 * 暴発の大渦（#9/#29/#41）。紫（闇）と黄（光）の腕が**ぐるぐる回りながら中心へ集まり**、
 * 中心は白熱して最後は白く埋まる（虚式・茈のような渦）。紫と黄は完全には混ぜず、重なった所だけ
 * 加算合成で白っぽく光る。**効果範囲（AoE）の内側を渦で埋め尽くす**（少しだけ外へはみ出す）。
 * AoE 境界には白く明滅する破線円を描き、実ダメージ範囲を明示する。
 * ステージ全体の揺れ・降ってくる遺跡の破片は BattleCanvas 側で全体演出として足す。
 */
export function drawMisfire(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  progress: number,
  vp: Viewport,
): void {
  const c = toScreen(pos, vp)
  const s = scaleOf(vp)
  const maxR = FIELD.aoeRadius * s // AoE 半径（実ダメージ範囲・#29）
  const effR = maxR * 1.18 // 渦は AoE を少しだけはみ出す
  const px = Math.max(3, Math.round(s * 0.28))
  const TAU = Math.PI * 2
  const GOLD = COLORS.light1 // 光＝黄（金）
  const PURPLE = '#b483ff' // 闇＝紫（加算合成で黄に負けないよう明るめの紫）
  ctx.save()
  const cell = (gx: number, gy: number, col: string, a: number) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, a))
    ctx.fillStyle = col
    ctx.fillRect(Math.round((c.x + gx) / px) * px, Math.round((c.y + gy) / px) * px, px, px)
  }

  // AoE 境界：白く明滅する破線円（実ダメージ範囲を明示）
  ctx.globalAlpha = 0.4 + 0.4 * (1 - progress)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(2, px * 0.5)
  ctx.setLineDash([px * 1.4, px * 0.9])
  ctx.beginPath()
  ctx.arc(c.x, c.y, maxR, 0, TAU)
  ctx.stroke()
  ctx.setLineDash([])

  // 加算合成：紫と黄が重なった所だけ白っぽく光る（完全には混ざらず色は残る）
  ctx.globalCompositeOperation = 'lighter'

  const spin = progress * 10 // 進むほど回る（ぐるぐる）

  // 渦の土台：紫と黄の薄いハロを少し回しながら重ね、AoE 内を隙間なく埋める
  for (const [hcol, off] of [[PURPLE, 0], [GOLD, TAU / 2]] as const) {
    const hx = c.x + Math.cos(spin + off) * maxR * 0.12
    const hy = c.y + Math.sin(spin + off) * maxR * 0.12
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, effR)
    hg.addColorStop(0, hcol)
    hg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = 0.16 + progress * 0.1
    ctx.fillStyle = hg
    ctx.beginPath()
    ctx.arc(c.x, c.y, effR, 0, TAU)
    ctx.fill()
  }

  // ===== 渦：紫と黄の腕がぐるぐる回りながら中心へ流れ込み、AoE 内を埋め尽くす =====
  const inflow = progress * 1.5 // 縁→中心へ吸い込まれる量
  const ARMS = 12
  const PTS = 32
  const WIND = 1.7 // らせんの巻き数
  for (let a = 0; a < ARMS; a++) {
    const base = (a / ARMS) * TAU
    const isPurple = a % 2 !== 0
    const col = isPurple ? PURPLE : GOLD
    for (let k = 0; k < PTS; k++) {
      // u から inflow を引いて剰余＝粒が縁→中心へ流れ続ける（常に AoE を埋める）
      const t = ((((k / PTS + a * 0.011 - inflow) % 1) + 1) % 1) // 0(中心)..1(縁)
      const rad = effR * t
      const ang = base + t * WIND * TAU + spin // 半径で巻く＝らせん
      const gx = Math.cos(ang) * rad
      const gy = Math.sin(ang) * rad
      // 縁と中心でフェード（ワープのちらつき防止）。内側ほど明るい＝集まって見える
      const fade = Math.min(1, t * 6) * Math.min(1, (1 - t) * 5)
      // 紫は黄より暗く見えるので濃いめに出す（色を残す）
      const a1 = (0.34 + (1 - t) * 0.55) * (0.55 + progress * 0.45) * fade * (isPurple ? 1.45 : 1)
      cell(gx, gy, col, a1)
      // 中心寄りは白を混ぜる（密になり白っぽく＝最後は白く埋まる）
      if (t < 0.5) cell(gx * 0.9, gy * 0.9, '#fff8e1', a1 * (0.6 - t) * (0.5 + progress))
    }
  }

  // きらめく火花（紫/黄/白がチカチカ・渦に散る）
  const SPARK = 58
  for (let i = 0; i < SPARK; i++) {
    const h = Math.sin(i * 12.9898) * 43758.5453
    const rnd = h - Math.floor(h)
    const ang = rnd * TAU + spin * 0.6
    const rad = effR * (0.12 + rnd * 0.88)
    const tw = 0.5 + 0.5 * Math.sin(progress * 22 + i * 1.3) // 明滅
    const m = i % 3
    const col = m === 0 ? GOLD : m === 1 ? PURPLE : '#ffffff'
    cell(Math.cos(ang) * rad, Math.sin(ang) * rad, col, tw * (0.45 + progress * 0.4) * (m === 1 ? 1.4 : 1))
  }

  // 白熱の中心コア（進行で巨大化＝最後は中心が白く埋まる）
  const coreR = px * 1.2 + maxR * (0.1 + progress * progress * 0.7)
  const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, coreR)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.4, `rgba(255,248,225,${0.55 + 0.45 * progress})`)
  g.addColorStop(0.75, `rgba(244,196,48,${0.35 * (1 - progress * 0.4)})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalAlpha = 1
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(c.x, c.y, coreR, 0, TAU)
  ctx.fill()

  // 中心から伸びる十字の星スパーク（白・明滅）
  ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(progress * 26))
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = Math.max(1.5, px * 0.5)
  const sl = coreR * 1.8
  ctx.beginPath()
  ctx.moveTo(c.x - sl, c.y)
  ctx.lineTo(c.x + sl, c.y)
  ctx.moveTo(c.x, c.y - sl)
  ctx.lineTo(c.x, c.y + sl)
  ctx.stroke()

  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
}

/** ダメージ／回復の数値を縁取りつきで描く（#42）。screen 座標・中央揃え。 */
export function drawDamageNumber(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  text: string,
  color: string,
  sizePx: number,
  alpha: number,
): void {
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.font = `bold ${Math.round(sizePx)}px "DotGothic16", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(2.5, sizePx * 0.22)
  ctx.strokeStyle = 'rgba(8,6,16,0.9)' // 暗い縁取り（高コントラスト）
  ctx.strokeText(text, sx, sy)
  ctx.fillStyle = color
  ctx.fillText(text, sx, sy)
  ctx.restore()
}

/**
 * 暴発に伴いステージ上空から降ってくる遺跡の破片（#41）。
 * 画面全体の演出。progress 0→1 で上から下へ落ち、フィールド円内にクリップする。
 */
export function drawFallingDebris(ctx: CanvasRenderingContext2D, vp: Viewport, progress: number): void {
  const s = scaleOf(vp)
  const W = vp.width
  const H = vp.height
  const N = 18
  const COLS = ['#6b5a44', '#544a5e', '#7a6f86', '#8a7350']
  ctx.save()
  // フィールド円内にクリップ（盤面の外へはみ出さない）
  const center = toScreen({ x: 0, y: 0 }, vp)
  ctx.beginPath()
  ctx.arc(center.x, center.y, FIELD.rField * s, 0, Math.PI * 2)
  ctx.clip()
  for (let i = 0; i < N; i++) {
    const fx = (((i * 73) % 100) / 100) * W
    const delay = (((i * 37) % 100) / 100) * 0.4 // 落下開始をずらす
    const p = (progress - delay) / (1 - delay)
    if (p <= 0 || p >= 1) continue
    const fy = -30 + p * (H + 60) // 上空から下へ抜ける
    const size = s * 0.16 * (0.6 + (((i * 53) % 100) / 100) * 1.0)
    const rot = p * (4 + (i % 5)) + i
    ctx.save()
    ctx.translate(fx, fy)
    ctx.rotate(rot)
    ctx.globalAlpha = 0.9 * Math.min(1, p * 4) // 出現時に軽くフェードイン
    ctx.fillStyle = COLS[i % COLS.length]
    ctx.fillRect(-size / 2, -size / 2, size, size)
    ctx.fillStyle = 'rgba(210,200,220,0.55)' // 角のハイライト
    ctx.fillRect(-size / 2, -size / 2, size * 0.42, size * 0.42)
    ctx.restore()
  }
  ctx.restore()
}
