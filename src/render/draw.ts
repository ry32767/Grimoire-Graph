// Canvas 描画関数（機能3・5・#15）。座標変換は coords に集約したものを使う。
import type { Ally, Attribute, Enemy, EnemySpecies, Obstacle, ObstacleKind, Vec2, ZPoint } from '../game/types'
import { FIELD } from '../data/constants'
import { toScreen, scaleOf, type Viewport } from '../game/coords'
import { attributeOf, strengthOf } from '../game/attribute'
import { COLORS } from './theme'
import { getWallTexture } from './textures'
import {
  drawBoardAxes,
  drawBoardGrid,
  drawPreviewRibbon,
  drawRayAxis,
  drawTurnTrails,
  drawZFieldRings,
  toPreviewPoints,
  type ZFieldRingsOptions,
} from './board'
import {
  speciesOf,
  speciesStyle,
  tierOf,
  GUARD_LIGHT,
  GUARD_DARK,
  type SpeciesStyle,
} from './species'

export type { ZPoint }

/** 静的シーンの描画パラメータ */
export interface SceneParams {
  vp: Viewport
  allies: Ally[]
  enemies: Enemy[]
  obstacles: Obstacle[]
  /** 現在編集中の味方（強調表示） */
  activeAllyId?: string | null
  /** 各味方の暴発（関数エラー）点。プレビューで赤い✕として可視化する。エラー無しは null */
  misfirePoints?: (Vec2 | null)[]
  /** 敵ゴースト軌道（数学座標の点列の配列） */
  ghostPaths?: Vec2[][]
  /** 崩し手（#42）の予告：計画された暴発点（赤✕＋揺れる円）。無い敵は null */
  ghostMisfires?: (Vec2 | null)[]
  /** ステージの異変の段階（04b §4b.2：0=静か〜3=崩壊目前）。背景の歪み・ひびで危うさを示す */
  anomaly?: number
  /** 暴発半径のブレ帯（04b §4b.3）。misfirePoints/ghostMisfires の周囲に min–max の二重リングを描く */
  misfireBand?: { min: number; max: number }
  /** 被弾中の対象ID→フラッシュ強度（1→0）。赤く光って揺れる（#20） */
  flash?: Record<string, number>
  /** 揺れの位相（時間とともに増加） */
  shakePhase?: number
  /** 軌跡アニメの位相（パーティクルが揺れ・波が流れる。作成フェーズで進める） */
  trailPhase?: number
  /** 編集中の z 場 z=f(x,y)（#37）。showZField の間だけ「場がエラーになる地点」の赤を重ねる */
  zField?: (x: number, y: number) => number
  /** z 場をいじっている間だけ true：場のプレビューを表示する（#37） */
  showZField?: boolean
  /**
   * z 場の同心円表示（DC プロトタイプ v3）。術者を中心に z(t) を全開示する盤面の主役。
   * 作成フェーズで showZField のときだけ渡す。
   */
  zRings?: ZFieldRingsOptions
  /** 射線のローカル座標系（f(x) が住む軸）。アクティブ術者の位置と θ */
  rayAxis?: { pos: Vec2; angle: number } | null
  /**
   * アクティブ術者のプレビュー軌道（v3 のリボン表現）。
   * previewFull=false のときは弧長 PREVIEW_STUB_ARC までの出だしだけを見せる（＝当たるかは撃つまで分からない）。
   */
  previewPath?: ZPoint[] | null
  previewFull?: boolean
  /** 前ターンの軌跡（残像）。作成フェーズでうっすら残す */
  trails?: ZPoint[][]
  /** ボスの多段外見（#51）に渡す状態（bossPhase・finale・outcome）。 */
  bossView?: BossView
  /** 撃破演出が始まった敵ID（#46）：生存スプライトを隠し、消滅アニメへ譲る。 */
  hideEnemyIds?: Set<string>
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

/**
 * 背景：方眼・軸・目盛り数値・場外境界（DC プロトタイプ v3 の盤面）。
 * 1マス=2ユニット、10ごとに濃い線、5ごとに数値を振る「グラフ用紙」の見せ方。
 * 単体で呼ばれたとき（エンドロール等）は軸まで一気に描く。
 */
export function drawBackground(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  drawBoardGrid(ctx, vp, COLORS.bg)
  drawBoardAxes(ctx, vp)
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

// 原型スプライトのドット絵（種族パレットで塗り分ける・#46）。光=石像／闇=幽鬼のシルエット。
const LIGHT_ENEMY_ROWS = ['.GGG.', 'GGGGG', 'GeWeG', 'GGGGG', '.G.G.', 'G...G']
const DARK_ENEMY_ROWS = ['.PPP.', 'PPPPP', 'PeWeP', 'PPPPP', '.PPP.', 'P.P.P']

// ===== 種族別スプライト（05c §0/§6・#46）：species×tier で手続き描画する =====

/** 原型（proto）：既存の石像ドット絵を種族パレットで描く（無装飾）。 */
function drawProto(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  style: SpeciesStyle,
  light: boolean,
): void {
  const rows = light ? LIGHT_ENEMY_ROWS : DARK_ENEMY_ROWS
  const pal: Record<string, string> = light
    ? { G: style.base, W: style.accent, e: style.edge }
    : { P: style.base, W: style.accent, e: style.accent }
  const px = (r * 2) / rows[0].length
  drawPixelSprite(ctx, cx, cy, rows, pal, px)
}

/** 鋼鬼（oni）：武骨な鎧＋兜の角＋破城槌。ティア(1〜3)で装甲面積・角・得物が大型化する。 */
function drawOni(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  style: SpeciesStyle,
): void {
  const t = style.ornaments // 1..3
  ctx.save()
  ctx.strokeStyle = style.edge
  ctx.lineWidth = Math.max(1.5, r * 0.1)
  // 胴の鎧（ティアで幅が増す）
  const bw = r * (0.85 + t * 0.1)
  const bh = r * (0.95 + t * 0.08)
  ctx.fillStyle = style.base
  ctx.beginPath()
  ctx.moveTo(cx - bw * 0.5, cy - bh * 0.3)
  ctx.lineTo(cx - bw * 0.35, cy + bh * 0.7)
  ctx.lineTo(cx + bw * 0.35, cy + bh * 0.7)
  ctx.lineTo(cx + bw * 0.5, cy - bh * 0.3)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // 兜（丸い頭当て）
  ctx.beginPath()
  ctx.arc(cx, cy - bh * 0.45, r * 0.42, Math.PI, 0)
  ctx.fill()
  ctx.stroke()
  // 兜の角（ティアの数だけ左右に生える）
  ctx.strokeStyle = style.accent
  ctx.lineWidth = Math.max(1.5, r * 0.09)
  for (let i = 0; i < t; i++) {
    const dx = r * (0.28 + i * 0.14)
    const hy = cy - bh * 0.62
    for (const sgn of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + sgn * dx * 0.6, hy)
      ctx.lineTo(cx + sgn * dx, hy - r * (0.28 + i * 0.08))
      ctx.stroke()
    }
  }
  // 目（睨む二つの光点）
  ctx.fillStyle = style.accent
  for (const sgn of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(cx + sgn * r * 0.16, cy - bh * 0.42, Math.max(1, r * 0.08), 0, Math.PI * 2)
    ctx.fill()
  }
  // 破城槌（右手の得物・ティアで大型化）
  const mlen = r * (0.7 + t * 0.25)
  const mw = r * (0.18 + t * 0.06)
  ctx.strokeStyle = style.edge
  ctx.lineWidth = Math.max(2, r * 0.1)
  ctx.beginPath()
  ctx.moveTo(cx + bw * 0.4, cy + bh * 0.2)
  ctx.lineTo(cx + bw * 0.4 + mlen * 0.6, cy - mlen * 0.5)
  ctx.stroke()
  ctx.fillStyle = style.base
  ctx.beginPath()
  ctx.arc(cx + bw * 0.4 + mlen * 0.6, cy - mlen * 0.55, mw, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** 亡霊魔術師（wraith）：半透明ローブ＋紋様。ティアで輪郭が濃く・紋様が複雑に。crackColor 指定で紅亡霊の亀裂も描く。 */
function drawWraith(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  style: SpeciesStyle,
  phase: number,
  crack = false,
): void {
  const t = style.ornaments
  ctx.save()
  ctx.globalAlpha = style.alpha
  // フード＋ローブ（裾が揺らぐ幽体）
  ctx.fillStyle = style.base
  ctx.beginPath()
  ctx.moveTo(cx, cy - r * 0.9) // 頭頂
  ctx.quadraticCurveTo(cx - r * 0.8, cy - r * 0.2, cx - r * 0.62, cy + r * 0.5)
  // 裾の波打ち（位相で揺れる）
  const hem = cy + r * 0.85
  ctx.quadraticCurveTo(cx - r * 0.4, hem + Math.sin(phase) * r * 0.1, cx - r * 0.2, hem)
  ctx.quadraticCurveTo(cx, hem + Math.sin(phase + 1) * r * 0.12, cx + r * 0.2, hem)
  ctx.quadraticCurveTo(cx + r * 0.4, hem + Math.sin(phase + 2) * r * 0.1, cx + r * 0.62, cy + r * 0.5)
  ctx.quadraticCurveTo(cx + r * 0.8, cy - r * 0.2, cx, cy - r * 0.9)
  ctx.closePath()
  ctx.fill()
  // 輪郭（ティアで濃く）
  ctx.globalAlpha = Math.min(1, style.alpha + 0.15 * t)
  ctx.strokeStyle = style.edge
  ctx.lineWidth = Math.max(1, r * (0.04 + t * 0.02))
  ctx.stroke()
  // フードの闇（顔は空虚）
  ctx.globalAlpha = style.alpha
  ctx.fillStyle = 'rgba(8,6,18,0.75)'
  ctx.beginPath()
  ctx.ellipse(cx, cy - r * 0.28, r * 0.32, r * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()
  // 灯る二つの目
  ctx.fillStyle = style.accent
  for (const sgn of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(cx + sgn * r * 0.13, cy - r * 0.28, Math.max(1, r * 0.07), 0, Math.PI * 2)
    ctx.fill()
  }
  // ローブの紋様（ティアの数だけ横線が増える）
  ctx.strokeStyle = style.accent
  ctx.globalAlpha = style.alpha * 0.7
  ctx.lineWidth = Math.max(1, r * 0.04)
  for (let i = 0; i < t; i++) {
    const y = cy + r * (0.18 + i * 0.2)
    ctx.beginPath()
    ctx.moveTo(cx - r * (0.45 - i * 0.06), y)
    ctx.lineTo(cx + r * (0.45 - i * 0.06), y)
    ctx.stroke()
  }
  // 紅亡霊の亀裂（内側から紅い光が漏れ、明滅する・#46）
  if (crack) {
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(phase * style.crackPulse))
    ctx.globalAlpha = pulse
    ctx.strokeStyle = style.accent // '#ff3b3b'
    ctx.shadowColor = style.accent
    ctx.shadowBlur = 6
    ctx.lineWidth = Math.max(1, r * 0.06)
    const cracks = 1 + t // ティアで本数が増える
    for (let i = 0; i < cracks; i++) {
      const a0 = (i / cracks) * Math.PI * 2 + 0.4
      let x = cx + Math.cos(a0) * r * 0.1
      let y = cy - r * 0.1 + Math.sin(a0) * r * 0.1
      ctx.beginPath()
      ctx.moveTo(x, y)
      for (let k = 0; k < 3; k++) {
        x += Math.cos(a0 + (k % 2 ? 0.6 : -0.4)) * r * 0.22
        y += Math.sin(a0 + (k % 2 ? 0.6 : -0.4)) * r * 0.22
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** ゴーレム（golem）：石塊＋同心円紋様（一重→二重→三重）。目は結界属性色（eyeColor）に発光。 */
function drawGolem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  style: SpeciesStyle,
  eyeColor: string,
): void {
  const t = style.ornaments
  ctx.save()
  // 角張った石塊の胴
  ctx.fillStyle = style.base
  ctx.strokeStyle = style.edge
  ctx.lineWidth = Math.max(1.5, r * 0.1)
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.7, cy - r * 0.55)
  ctx.lineTo(cx + r * 0.7, cy - r * 0.55)
  ctx.lineTo(cx + r * 0.8, cy + r * 0.5)
  ctx.lineTo(cx + r * 0.35, cy + r * 0.85)
  ctx.lineTo(cx - r * 0.35, cy + r * 0.85)
  ctx.lineTo(cx - r * 0.8, cy + r * 0.5)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // 同心円の紋様（ティアで一重→二重→三重）
  ctx.strokeStyle = style.accent
  ctx.lineWidth = Math.max(1, r * 0.05)
  for (let i = 0; i < t; i++) {
    ctx.beginPath()
    ctx.arc(cx, cy + r * 0.08, r * (0.24 + i * 0.2), 0, Math.PI * 2)
    ctx.stroke()
  }
  // ティア3：発光する回路状の筋（05c §6：完成形）
  if (t >= 3) {
    ctx.strokeStyle = eyeColor
    ctx.globalAlpha = 0.5
    ctx.lineWidth = Math.max(1, r * 0.04)
    for (const sgn of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + sgn * r * 0.5, cy - r * 0.4)
      ctx.lineTo(cx + sgn * r * 0.5, cy + r * 0.6)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  // 目：現在張っている結界の属性色に発光（05c §4）。ティアで大きく・強く
  ctx.shadowColor = eyeColor
  ctx.shadowBlur = 6 + t * 2
  ctx.fillStyle = eyeColor
  const er = Math.max(1.4, r * (0.09 + t * 0.02))
  for (const sgn of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(cx + sgn * r * 0.24, cy - r * 0.18, er, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * ゴーレムの目の発光色（05c §4）：現在張っている結界の属性色。
 * guardZSign（交互張りが今ターン設定した極性）を優先し、無ければ自身の防御属性から導出する。
 */
function golemEyeColor(e: Pick<Enemy, 'guardZSign' | 'element'>): string {
  if (e.guardZSign === 1) return GUARD_LIGHT
  if (e.guardZSign === -1) return GUARD_DARK
  return e.element === 'light' ? GUARD_LIGHT : GUARD_DARK
}

/**
 * 種族スプライトを (cx,cy) 中心・半径 r で描く（05c §0/§6・#46）。
 * boss は専用描画（drawBossSprite）へ回すため、ここでは扱わない。
 */
export function drawSpeciesSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  species: EnemySpecies,
  tier: 1 | 2 | 3,
  element: Attribute,
  eyeColor: string,
  phase: number,
): void {
  const style = speciesStyle(species, tier, element)
  const light = element === 'light'
  if (species === 'oni') drawOni(ctx, cx, cy, r, style)
  else if (species === 'wraith') drawWraith(ctx, cx, cy, r, style, phase)
  else if (species === 'redWraith') drawWraith(ctx, cx, cy, r, style, phase, true)
  else if (species === 'golem') drawGolem(ctx, cx, cy, r, style, eyeColor)
  else drawProto(ctx, cx, cy, r, style, light)
}

// ===== ボスの多段外見（#51・06b §6 第7面「ボスの見た目」）=====

/** ボスの光（金）/闇（紫）の左右色。左半身=光・右半身=闇に固定（06b §6）。 */
const BOSS_LIGHT = '#f4c430'
const BOSS_DARK = '#8a6cff'

/** 天秤（左半身=光/右半身=闇）を (cx,cy) 中心に角度 tilt[rad] だけ傾けて描く。 */
function drawScale(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  arm: number,
  tilt: number,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.strokeStyle = '#efe6c8'
  ctx.lineWidth = Math.max(1.5, arm * 0.08)
  // 梁
  ctx.beginPath()
  ctx.moveTo(-arm, 0)
  ctx.lineTo(arm, 0)
  ctx.stroke()
  // 支柱
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, arm * 0.4)
  ctx.stroke()
  // 左右の皿（光・闇）
  for (const [sgn, col] of [[-1, BOSS_LIGHT], [1, BOSS_DARK]] as const) {
    ctx.strokeStyle = col
    ctx.beginPath()
    ctx.moveTo(sgn * arm, 0)
    ctx.lineTo(sgn * arm, arm * 0.35)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(sgn * arm, arm * 0.4, arm * 0.28, 0, Math.PI)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * 魔導書の守護者（ボス・#51）：書物のページ状装甲＋天秤の意匠。左=光/右=闇の対称。
 * bossPhase(0/1/2) で装甲剥離・天秤の傾き・核の露出が段階的に進み、
 * finale='cast' で断末魔（激しい揺れ＋3つの綻び）、outcome='cleared'（finale='done'）で撃破後の崩壊。
 */
export function drawBossSprite(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  phase: number,
  view?: BossView,
): void {
  const ph = view?.phase ?? 0 // 0/1/2
  const finale = view?.finale
  const R = r * 1.15 // ボスは既存枠より一回り大きく（hitbox 3.6 相当）
  // 撃破後の崩壊（outcome='cleared'）は BattleCanvas の撃破タイムライン（drawBossCollapse）で
  // progress つきに描くため、ここ（生存中スプライト）では扱わない。
  const casting = finale === 'cast'
  // 断末魔は制御を失って激しく揺れる（固定角なし）
  const tremor = casting ? Math.sin(phase * 3.1) * R * 0.06 : 0
  ctx.save()
  ctx.translate(tremor, Math.cos(phase * 2.7) * (casting ? R * 0.05 : 0))

  // 天秤の傾き（フェーズで増す・#51）。断末魔は激しく振れる
  const tilt = casting
    ? Math.sin(phase * 2.3) * 0.5
    : ph >= 2
      ? 0.7 // 30〜45°付近（大きく傾いたまま）
      : ph === 1
        ? 0.22 // 10〜15°
        : 0 // 水平

  // ページ状装甲（左=光/右=闇）。フェーズが進むほど剥離して枚数が減る
  const plates = ph >= 2 ? 2 : ph === 1 ? 3 : 4
  for (const [sgn, col] of [[-1, BOSS_LIGHT], [1, BOSS_DARK]] as const) {
    ctx.strokeStyle = 'rgba(20,16,34,0.9)'
    ctx.lineWidth = Math.max(1, R * 0.03)
    for (let i = 0; i < plates; i++) {
      const t = i / Math.max(1, plates - 1)
      const px0 = cx + sgn * R * (0.18 + t * 0.6)
      const py0 = cy - R * 0.55 + t * R * 0.1
      // 剥離した破片は少し浮いて舞う（フェーズ2以降・断末魔で大きく）
      const lift = (ph >= 1 ? (1 - t) : 0) * (casting ? R * 0.3 : R * 0.12) * (0.5 + 0.5 * Math.sin(phase + i))
      ctx.fillStyle = col
      ctx.globalAlpha = 0.85 - t * 0.15
      ctx.beginPath()
      ctx.rect(px0 - R * 0.16, py0 - lift, R * 0.32, R * 1.0)
      ctx.fill()
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1

  // 核（フェーズ3で露出・光と闇が混ざる発光体・小刻みに明滅）
  if (ph >= 2 || casting) {
    const flick = 0.6 + 0.4 * Math.abs(Math.sin(phase * (casting ? 5 : 2.4)))
    const coreR = R * (casting ? 0.6 : 0.4) * flick
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.5, `rgba(244,196,48,${0.6 * flick})`)
    g.addColorStop(1, `rgba(138,108,255,0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
    ctx.fill()
  }

  // 刻印が裂けて光が漏れる（フェーズ3・紅亡霊に近いがボス規模）
  if (ph >= 2 && !casting) {
    ctx.strokeStyle = 'rgba(255,240,180,0.7)'
    ctx.lineWidth = Math.max(1, R * 0.03)
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2 + 0.5
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a0) * R * 0.7, cy + Math.sin(a0) * R * 0.7)
      ctx.stroke()
    }
  }

  // 断末魔：3つの綻び（drawMisfire の白紫の視覚言語を小さく流用・体の中心と左右）
  if (casting) {
    for (const dx of [-R * 0.55, 0, R * 0.55]) {
      const rift = 0.5 + 0.5 * Math.abs(Math.sin(phase * 4 + dx))
      const g = ctx.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, R * 0.5 * rift)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.5, 'rgba(180,131,255,0.7)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx + dx, cy, R * 0.5 * rift, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 胸の天秤（最重要のビジュアル・#51）。装甲より前面に描く
  drawScale(ctx, cx, cy + R * 0.05, R * 0.55, tilt)
  ctx.restore()
}

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
  abs: '折れ',
  harmonic: '重波',
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
    // 3〜5次（#43/#46）：S字の捻れ
    ctx.moveTo(cx - 9, cy + 5)
    ctx.bezierCurveTo(cx - 2, cy - 9, cx + 2, cy + 9, cx + 9, cy - 5)
    ctx.stroke()
  } else if (family === 'abs') {
    // 折れ（#46）：V字に鋭く折れる
    ctx.moveTo(cx - 9, cy - 6)
    ctx.lineTo(cx, cy + 6)
    ctx.lineTo(cx + 9, cy - 6)
    ctx.stroke()
  } else if (family === 'harmonic') {
    // 重波（#69）：周期の違うサイン波の重ね合わせ＝繰り返さないうねり
    for (let i = 0; i <= 18; i++) {
      const x = -9 + i
      const y = -(Math.sin(x * 0.75) * 3.5 + Math.sin(x * 1.45 + 1.1) * 2 + Math.sin(x * 2.3 + 2.3) * 1.1)
      if (i === 0) ctx.moveTo(cx + x, cy + y)
      else ctx.lineTo(cx + x, cy + y)
    }
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

/**
 * ボスの多段外見（#51）に渡す状態。BattleState から抜き出す（描画専用）。
 * phase=0/1/2（bossPhase）／finale・outcome で断末魔〜撃破後を分岐する。
 */
export interface BossView {
  phase?: number
  finale?: 'pending' | 'cast' | 'done'
  outcome?: 'ongoing' | 'cleared' | 'gameover'
}

/** 敵の描画（種族別スプライト＋得意関数記号＋名前・#46）。ボスは多段外見（#51）。 */
export function drawEnemies(
  ctx: CanvasRenderingContext2D,
  enemies: Enemy[],
  vp: Viewport,
  flash?: Record<string, number>,
  shakePhase = 0,
  bossView?: BossView,
  hideIds?: Set<string>,
): void {
  for (const e of enemies) {
    if (e.hp <= 0) continue
    if (hideIds?.has(e.id)) continue // 撃破演出中は生存スプライトを隠す（#46）
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
    // 種族スプライト（05c §0/§6・#46）。ボスは専用の多段外見（#51）へ回す
    const phase = shakePhase
    if (e.boss) {
      drawBossSprite(ctx, c.x, c.y, r, phase, bossView)
    } else {
      const species = speciesOf(e)
      const tier = tierOf(e.level)
      const eye = golemEyeColor(e)
      drawSpeciesSprite(ctx, c.x, c.y, r * 0.95, species, tier, e.element, eye, phase)
    }
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
  if (o.solids.length === 0 && !(o.rects && o.rects.length)) return
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
  for (const r of o.rects ?? []) {
    minX = Math.min(minX, r.x)
    maxX = Math.max(maxX, r.x + r.w)
    minY = Math.min(minY, r.y)
    maxY = Math.max(maxY, r.y + r.h)
  }
  const tl = toScreen({ x: minX, y: maxY }, vp) // y 反転：maxY が画面上
  const br = toScreen({ x: maxX, y: minY }, vp)
  const x0 = tl.x
  const y0 = tl.y
  const x1 = br.x
  const y1 = br.y
  const kind = o.kind ?? 'normal'
  // ピクセルアートのタイル画像を素材内に敷き詰める（#56）。取得できなければ手続き描画にフォールバック
  const tex = getWallTexture(kind, o.element)
  if (tex) {
    const pat = lx.createPattern(tex, 'repeat')
    if (pat) {
      lx.save()
      lx.globalAlpha = 0.62 // 下地の属性色を活かしつつ質感を重ねる
      lx.imageSmoothingEnabled = false
      lx.fillStyle = pat
      lx.fillRect(x0, y0, x1 - x0, y1 - y0)
      lx.restore()
      return
    }
  }
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
    if (o.solids.length === 0 && !(o.rects && o.rects.length)) continue // 円・矩形どちらも無ければ描かない（#56）
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
    // 四角い素材（#56）：角のシャープな矩形を塗る
    for (const r of o.rects ?? []) {
      const tl = toScreen({ x: r.x, y: r.y + r.h }, vp) // y 反転：上辺が画面上
      const br = toScreen({ x: r.x + r.w, y: r.y }, vp)
      lx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
    }
    // 種別テクスチャを素材内だけに重ねる（source-atop で素材の上にのみ描く・#40/#56）
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

/**
 * 敵の闇結界による視認阻害（#61/#62）：作成フェーズで内側をぼかし、z 場・予測経路を隠す。
 * **1枚だけの範囲は「見づらいがギリギリ見える」薄幕**、**2枚が重なった範囲は「全く見えない黒」**にする
 * （自陣隠蔽の 1重/2重 と同じ考え方）。リング同士が重なる領域を交差クリップで塗り分ける。
 */
export function drawEnemyConceal(ctx: CanvasRenderingContext2D, rings: ZPoint[][], vp: Viewport): void {
  const valid = rings.filter((r) => r.length >= 3)
  if (valid.length === 0) return
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  // 1枚ぶん：内側をぼかし＋薄い幕（ギリギリ見える）
  for (const ring of valid) {
    ctx.save()
    ringScreenPath(ctx, ring, vp)
    ctx.clip()
    ctx.filter = 'blur(5px)'
    ctx.drawImage(ctx.canvas, 0, 0)
    ctx.filter = 'none'
    ctx.fillStyle = 'rgba(10,7,20,0.5)' // 薄幕：z 場・予測経路は見えなくなるが地形はギリギリ分かる
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }
  // 2枚が重なる領域：交差だけにクリップして不透明な黒で塗る（全く見えない・#62）
  for (let i = 0; i < valid.length; i++)
    for (let j = i + 1; j < valid.length; j++) {
      ctx.save()
      ringScreenPath(ctx, valid[i], vp)
      ctx.clip()
      ringScreenPath(ctx, valid[j], vp)
      ctx.clip() // clip を重ねると交差（重なり）だけになる
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      ctx.restore()
    }
  // 視認阻害ゾーンの境界を薄い破線で示す
  for (const ring of valid) {
    ctx.save()
    ringScreenPath(ctx, ring, vp)
    ctx.strokeStyle = 'rgba(150,110,210,0.55)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.stroke()
    ctx.restore()
  }
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
  const R = vp.unitsRadius // #49：場の半径はビューポートから（面/フェーズで可変）
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
  // 方眼 → z 場の同心円 → 軸・目盛り（v3 の重ね順：軸は場の上で必ず読める）
  drawBoardGrid(ctx, p.vp, COLORS.bg)

  // ステージの異変（04b §4b.2）：instability が上がるほど背景が波打ち、床にひびが走る
  if (p.anomaly && p.anomaly > 0) {
    drawAnomaly(ctx, p.vp, p.anomaly, p.trailPhase ?? p.shakePhase ?? 0)
  }

  // z 場：術者中心の同心円（半径＝飛行距離 t）。地形より下に敷く（v3 の盤面）
  if (p.showZField && p.zRings) drawZFieldRings(ctx, p.vp, p.zRings)
  drawBoardAxes(ctx, p.vp)
  // 場がエラーになる地点を全て赤で可視化（極=線・定義域外=領域・#30）
  if (p.showZField && p.zField) drawZFieldErrors(ctx, p.zField, p.vp)

  // 射線のローカル座標系（f(x) が住む軸・10 ごとの目盛り）
  if (p.rayAxis) drawRayAxis(ctx, p.vp, p.rayAxis.pos, p.rayAxis.angle)

  // 敵ゴースト軌道（次の一手の破線）
  if (p.ghostPaths) {
    ctx.save()
    ctx.strokeStyle = 'rgba(188,198,224,.42)'
    ctx.lineWidth = 1.6
    ctx.setLineDash([5, 4])
    for (const path of p.ghostPaths) strokePath(ctx, path, p.vp)
    ctx.setLineDash([])
    ctx.restore()
  }

  drawObstacles(ctx, p.obstacles, p.vp)

  // 前ターンの軌跡（残像）：どこを通ったかがうっすら残る
  if (p.trails && p.trails.length > 0) drawTurnTrails(ctx, p.vp, p.trails)

  // アクティブ術者のプレビュー軌道（v3 のリボン）。既定は出だしだけ＝当たるかは撃つまで分からない
  if (p.previewPath && p.previewPath.length > 1) {
    drawPreviewRibbon(ctx, p.vp, toPreviewPoints(p.previewPath), p.previewFull ?? false)
  }

  // 敵・術者は軌跡の上に描く（軌跡で隠れない・#27）
  drawEnemies(ctx, p.enemies, p.vp, p.flash, p.shakePhase, p.bossView, p.hideEnemyIds)
  drawCasters(ctx, p.allies, p.vp, p.activeAllyId, p.flash, p.shakePhase)

  // 関数エラーで暴発する点を赤い✕で可視化（最前面・#30）。
  // instability が進んでいると、半径のブレ帯（min–max のぼやけた二重リング）を重ねる（04b §4b.3）
  if (p.misfirePoints) {
    const phase = p.shakePhase ?? p.trailPhase ?? 0
    for (const m of p.misfirePoints) {
      if (!m) continue
      if (p.misfireBand) drawMisfireBand(ctx, m, p.misfireBand, p.vp)
      drawMisfireMarker(ctx, m, p.vp)
      // 膜が摩耗するほど、予想半径そのものが揺らいで読めなくなる（04b §4b.3・v3）
      if (p.misfireBand && (p.anomaly ?? 0) >= 3) {
        const mid = (p.misfireBand.min + p.misfireBand.max) / 2
        const amp = ((p.anomaly ?? 0) - 2) * 0.55
        const c = toScreen(m, p.vp)
        const s = scaleOf(p.vp)
        ctx.save()
        ctx.setLineDash([3, 5])
        ctx.lineWidth = 1
        for (let k = 0; k < 3; k++) {
          const rr = (mid + Math.sin(phase * 2.1 + k * 2.3) * amp * (1 + k * 0.45)) * s
          ctx.strokeStyle = `rgba(255,125,94,${(0.22 - k * 0.05).toFixed(3)})`
          ctx.beginPath()
          ctx.arc(c.x, c.y, Math.max(2, rr), 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.restore()
      }
    }
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

/**
 * ステージの異変（04b §4b.2）：level 1=背景がわずかに波打つ／2=床のひび・周縁ノイズ／3=崩壊目前。
 * 数値は見せず「盤面そのものが軋む」感覚だけを伝える（第1幕の主要な手がかり）。
 */
export function drawAnomaly(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  level: number,
  phase = 0,
): void {
  ctx.save()
  // level1+：背景がわずかに波打つ（横縞の薄い明滅）
  const bands = 5 + level * 2
  for (let i = 0; i < bands; i++) {
    const y = ((i + 0.5) / bands) * vp.height + Math.sin(phase * 0.7 + i * 1.7) * 6
    const alpha = 0.015 * level * (1 + 0.5 * Math.sin(phase * 1.1 + i))
    ctx.fillStyle = `rgba(180,140,255,${Math.max(0, alpha)})`
    ctx.fillRect(0, y, vp.width, 3 + level)
  }
  // level1+：床の亀裂（画面下部から走る暗い稲妻線・決定的な形＝ちらつかない）。段階で本数・濃さが増す
  const cracks = level >= 3 ? 6 : level >= 2 ? 4 : 2
  ctx.strokeStyle = `rgba(20,12,30,${level >= 3 ? 0.85 : level >= 2 ? 0.7 : 0.5})`
  ctx.lineWidth = level >= 2 ? 2 : 1.6
  for (let c = 0; c < cracks; c++) {
    const x0 = ((c * 2654435761) % 1000) / 1000 * vp.width
    ctx.beginPath()
    ctx.moveTo(x0, vp.height)
    let x = x0
    let y = vp.height
    const pts: { x: number; y: number }[] = []
    for (let s = 0; s < 6; s++) {
      x += Math.sin(c * 3.1 + s * 2.3) * 22
      y -= vp.height * (0.05 + 0.03 * ((c + s) % 3))
      ctx.lineTo(x, y)
      pts.push({ x, y })
    }
    ctx.stroke()
    // level2+：亀裂の縁が崩れかける（暗い欠けらが亀裂沿いに散る・決定的な配置）
    if (level >= 2) {
      ctx.fillStyle = 'rgba(15,10,24,0.75)'
      for (let s = 0; s < pts.length; s++) {
        const sz = 2 + ((c * 7 + s * 5) % 4)
        const ox = Math.sin(c * 5.3 + s * 3.7) * 7
        ctx.fillRect(pts[s].x + ox - sz / 2, pts[s].y - sz / 2, sz, sz)
        if (level >= 3) ctx.fillRect(pts[s].x - ox - sz / 2, pts[s].y + 4 - sz / 2, sz, sz)
      }
    }
  }
  // level3：画面周縁が赤黒く脈動する（崩壊目前）
  if (level >= 3) {
    const pulse = 0.16 + 0.08 * Math.sin(phase * 1.8)
    const g = ctx.createRadialGradient(
      vp.width / 2, vp.height / 2, Math.min(vp.width, vp.height) * 0.35,
      vp.width / 2, vp.height / 2, Math.max(vp.width, vp.height) * 0.72,
    )
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(120,20,40,${pulse})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, vp.width, vp.height)
  }
  ctx.restore()
}

/** 暴発半径のブレ帯（04b §4b.3）：min–max のぼやけた二重リング。正確な大きさは読み切れない。 */
export function drawMisfireBand(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  band: { min: number; max: number },
  vp: Viewport,
): void {
  const c = toScreen(pos, vp)
  const s = scaleOf(vp)
  ctx.save()
  ctx.strokeStyle = 'rgba(255,75,75,0.45)'
  ctx.lineWidth = 1.2
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  ctx.arc(c.x, c.y, band.min * s, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,75,75,0.25)'
  ctx.beginPath()
  ctx.arc(c.x, c.y, band.max * s, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
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
  // 弾の大きさは威力（=速度×強度）で決まる（#21/#45）。速度0や弱属性なら小さく、最大威力で最大。
  // 以前は強属性に下駄（sFrac×0.4）を履かせ基準サイズも大きかったため、常に大玉に見えていた。
  const powerFrac = powerSizeFrac(speed, z)
  const sizeFrac = Math.max(0.06, powerFrac) // 最低限見える大きさだけ確保し、あとは威力に比例
  const pulse = 1 + Math.sin(phase * 1.7) * 0.25
  // 威力が大きいほど大きく・強いほど棘が多い（#21：形が z で変わる）
  const glowR = (4 + sizeFrac * 22) * pulse
  const spikes = 4 + Math.round(sFrac * 4)
  const coreR = (1.3 + sizeFrac * 4.2) * pulse
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
  radiusUnits: number = FIELD.aoeRadius,
): void {
  const c = toScreen(pos, vp)
  const s = scaleOf(vp)
  const maxR = radiusUnits * s // AoE 半径（実ダメージ範囲・#29。致死崩壊はステージ全体＝rField を渡す）
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
 * intensity は瓦礫の量の倍率（04b：崩壊へ近づくほど 1→大きくして降らせる。上限あり）。
 */
export function drawFallingDebris(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  progress: number,
  intensity = 1,
): void {
  const s = scaleOf(vp)
  const W = vp.width
  const H = vp.height
  const N = Math.min(64, Math.round(18 * Math.max(1, intensity)))
  const COLS = ['#6b5a44', '#544a5e', '#7a6f86', '#8a7350']
  ctx.save()
  // フィールド円内にクリップ（盤面の外へはみ出さない）
  const center = toScreen({ x: 0, y: 0 }, vp)
  ctx.beginPath()
  ctx.arc(center.x, center.y, vp.unitsRadius * s, 0, Math.PI * 2)
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

// ===== 種族別の撃破演出（05c §6.5・#46）：progress 0→1 で消滅アニメを再生 =====
// いずれも当たり判定・ダメージ計算に一切影響しない、描画タイムラインのみの演出。

/** 属性の光色（撃破時の光の筋・粒に使う）。 */
function attrGlow(element: Attribute): string {
  return element === 'light' ? '#f4c430' : element === 'dark' ? '#b483ff' : '#d9d4ea'
}

/** 決定的な擬似乱数（撃破の破片配置をフレーム間で安定させる）。 */
function rand01(i: number): number {
  const h = Math.sin(i * 12.9898) * 43758.5453
  return h - Math.floor(h)
}

/**
 * 種族別の撃破演出を (pos) 中心・半径 r（数学ユニット由来）で描く（05c §6.5）。
 * species/element/tier と progress から見た目のみを決める。
 */
export function drawEnemyDeath(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  hitboxRadius: number,
  species: EnemySpecies,
  element: Attribute,
  tier: 1 | 2 | 3,
  progress: number,
  vp: Viewport,
): void {
  if (progress < 0 || progress >= 1) return
  const c = toScreen(pos, vp)
  const r = hitboxRadius * scaleOf(vp)
  const glow = attrGlow(element)
  if (species === 'oni') drawOniDeath(ctx, c.x, c.y, r, element, progress)
  else if (species === 'wraith') drawWraithDeath(ctx, c.x, c.y, r, glow, progress, false, tier)
  else if (species === 'redWraith') drawWraithDeath(ctx, c.x, c.y, r, glow, progress, true, tier)
  else if (species === 'golem') drawGolemDeath(ctx, c.x, c.y, r, element, progress)
  else drawProtoDeath(ctx, c.x, c.y, r, glow, progress)
}

/** 原型（石像）：ひび割れて光の粒になって崩れる（基準形）。 */
function drawProtoDeath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  glow: string,
  p: number,
): void {
  ctx.save()
  const N = 16
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rand01(i) * 0.6
    const d = p * r * (1.2 + rand01(i + 1) * 1.2)
    ctx.globalAlpha = Math.max(0, 1 - p) * 0.9
    ctx.fillStyle = i % 2 === 0 ? glow : '#fff8e1'
    ctx.shadowColor = glow
    ctx.shadowBlur = 6
    const sz = Math.max(1, r * 0.18 * (1 - p))
    const x = cx + Math.cos(a) * d
    const y = cy + Math.sin(a) * d - p * r * 0.5 // 光の粒は少し上へ
    ctx.beginPath()
    ctx.arc(x, y, sz, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 鋼鬼：膝から崩れ、鎧の破片が飛散して瓦礫が残ってから消える（実体・重量感）。 */
function drawOniDeath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  element: Attribute,
  p: number,
): void {
  ctx.save()
  // 崩れ落ちる本体（沈みながらフェード）
  const sink = p * r * 0.5
  ctx.globalAlpha = Math.max(0, 1 - p * 1.4)
  const base = element === 'light' ? '#c9a24b' : element === 'dark' ? '#6b5aa8' : '#8a8496'
  ctx.fillStyle = base
  ctx.beginPath()
  ctx.arc(cx, cy + sink, r * 0.6 * (1 - p * 0.5), 0, Math.PI * 2)
  ctx.fill()
  // 飛散する鎧の破片（四角・重力で落ちて地面に瓦礫として残る）
  const N = 14
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rand01(i) * 1.2
    const reach = 0.6 + rand01(i + 3)
    const dist = p * r * 1.6 * reach
    const gx = cx + Math.cos(a) * dist
    // 破片は放物線で飛び、後半は地面（cy+r）に積もる
    const fall = p * p * r * 2.2
    const gy = Math.min(cy + r * 0.9, cy + Math.sin(a) * dist * 0.4 + fall)
    ctx.globalAlpha = i % 4 === 0 ? Math.max(0, 1 - (p - 0.5) * 2) : Math.max(0, 1 - p * 0.6) // 一部は瓦礫として残る
    ctx.fillStyle = i % 3 === 0 ? '#e8e0c8' : base
    const sz = Math.max(1.5, r * 0.2 * (1 - p * 0.4))
    ctx.save()
    ctx.translate(gx, gy)
    ctx.rotate(a + p * 3)
    ctx.fillRect(-sz / 2, -sz / 2, sz, sz)
    ctx.restore()
  }
  ctx.restore()
}

/**
 * 亡霊魔術師：ローブがほどけ、上方へ属性色の光の筋となって静かに消える（破片も音もない）。
 * 紅亡霊(crack)は、消える直前に亀裂が強く明滅→細かな光の破片が弾ける（無害・小規模・05c §6.5）。
 */
function drawWraithDeath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  glow: string,
  p: number,
  crack: boolean,
  tier: 1 | 2 | 3,
): void {
  ctx.save()
  // ローブがほどけて上へ立ちのぼる光の筋（3〜4本）
  const streaks = 3 + tier
  for (let i = 0; i < streaks; i++) {
    const sx = cx + (rand01(i) - 0.5) * r * 0.8
    const rise = p * r * 2.2
    ctx.globalAlpha = Math.max(0, 1 - p) * 0.7
    ctx.strokeStyle = glow
    ctx.shadowColor = glow
    ctx.shadowBlur = 8
    ctx.lineWidth = Math.max(1, r * 0.12 * (1 - p))
    ctx.beginPath()
    ctx.moveTo(sx, cy + r * 0.5 - p * r * 0.5)
    ctx.quadraticCurveTo(
      sx + Math.sin(i + p * 4) * r * 0.3,
      cy - rise * 0.5,
      sx + Math.sin(i) * r * 0.4,
      cy - rise,
    )
    ctx.stroke()
  }
  // 紅亡霊：終盤に亀裂が強く明滅してから紅い光の破片が弾ける（本物の暴発より小さく・無害）
  if (crack && p > 0.5) {
    const q = (p - 0.5) / 0.5
    const flick = Math.abs(Math.sin(p * 30))
    // 亀裂の明滅
    ctx.globalAlpha = Math.max(0, 1 - q) * flick
    ctx.strokeStyle = '#ff3b3b'
    ctx.shadowColor = '#ff3b3b'
    ctx.shadowBlur = 8
    ctx.lineWidth = Math.max(1, r * 0.08)
    for (let i = 0; i < 2 + tier; i++) {
      const a0 = (i / (2 + tier)) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a0) * r * 0.6, cy + Math.sin(a0) * r * 0.6)
      ctx.stroke()
    }
    // 細かな光の破片（規模は控えめ＝暴発と誤認させない）
    const N = 10
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rand01(i)
      const d = q * r * 1.1 // AoE より遥かに小さい
      ctx.globalAlpha = Math.max(0, 1 - q) * 0.8
      ctx.fillStyle = '#ff7a6a'
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(0.6, r * 0.08 * (1 - q)), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/**
 * ゴーレム：目の光が消え→同心円に沿って亀裂→その場に沈むように崩れる（破片はほぼ真下に積もる）。
 */
function drawGolemDeath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  element: Attribute,
  p: number,
): void {
  ctx.save()
  const base = element === 'light' ? '#8a7c5e' : element === 'dark' ? '#5a5470' : '#6e6a78'
  // 前半：同心円に沿って亀裂が走る（本体はまだ立っている）
  if (p < 0.5) {
    ctx.globalAlpha = 1 - p
    ctx.fillStyle = base
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(20,16,28,0.9)'
    ctx.lineWidth = Math.max(1, r * 0.06)
    const cracks = Math.floor(p * 12)
    for (let i = 0; i < cracks; i++) {
      const a0 = (i / 12) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a0) * r * 0.7, cy + Math.sin(a0) * r * 0.7)
      ctx.stroke()
    }
  } else {
    // 後半：その場に沈むように崩れ、破片は真下に積もる（暴れない）
    const q = (p - 0.5) / 0.5
    const N = 12
    for (let i = 0; i < N; i++) {
      const spread = (rand01(i) - 0.5) * r * 0.9 // 横のばらつきは小さい
      const fall = q * r * 1.0
      const gx = cx + spread
      const gy = Math.min(cy + r * 0.9, cy + fall)
      ctx.globalAlpha = Math.max(0, 1 - q * 0.7)
      ctx.fillStyle = i % 3 === 0 ? '#b8b0c8' : base
      const sz = Math.max(1.5, r * 0.22 * (1 - q * 0.3))
      ctx.fillRect(gx - sz / 2, gy - sz / 2, sz, sz)
    }
  }
  ctx.restore()
}

/**
 * ボスの撃破後の最終崩壊（#51・06b §6）。progress 0→1：
 * ①震えが止まり ②装甲・破片がゆっくり落下し ③輪郭が光の粒でほどけ ④最後に天秤だけが水平に戻って消える。
 */
export function drawBossCollapse(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  hitboxRadius: number,
  progress: number,
  vp: Viewport,
): void {
  if (progress < 0 || progress >= 1) return
  const c = toScreen(pos, vp)
  const R = hitboxRadius * scaleOf(vp) * 1.15
  const p = progress
  ctx.save()
  // ①〜②：残った装甲・破片が重力に従って落下し積もる（前半 0〜0.55）
  if (p < 0.7) {
    const fall = Math.min(1, p / 0.6)
    for (const [sgn, col] of [[-1, BOSS_LIGHT], [1, BOSS_DARK]] as const) {
      for (let i = 0; i < 4; i++) {
        const gx = c.x + sgn * R * (0.2 + i * 0.18)
        const gy = c.y - R * 0.4 + fall * (R * 1.4 + i * R * 0.1)
        ctx.globalAlpha = Math.max(0, 1 - fall) * 0.9
        ctx.fillStyle = col
        ctx.fillRect(gx - R * 0.14, Math.min(c.y + R * 0.9, gy), R * 0.28, R * 0.5)
      }
    }
  }
  // ③：輪郭が光の粒となってほどけ、立ちのぼって消える（中盤 0.3〜0.85）
  if (p > 0.3 && p < 0.9) {
    const q = (p - 0.3) / 0.6
    const N = 40
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rand01(i)
      const rr = R * (0.5 + rand01(i + 1) * 0.5)
      const x = c.x + Math.cos(a) * rr
      const y = c.y + Math.sin(a) * rr - q * R * 1.6 // 立ちのぼる
      ctx.globalAlpha = Math.max(0, 1 - q) * 0.8
      ctx.fillStyle = i % 2 === 0 ? BOSS_LIGHT : '#fff8e1'
      ctx.shadowColor = BOSS_LIGHT
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.arc(x, y, Math.max(0.6, R * 0.06 * (1 - q)), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // ④：最後に天秤だけが残り、傾きから水平（0）へ戻ってから消える（後半 0.6〜1）
  ctx.shadowBlur = 0
  if (p > 0.55) {
    const q = (p - 0.55) / 0.45
    const tilt = 0.7 * (1 - q) // 傾き→水平
    ctx.globalAlpha = q < 0.8 ? 1 : Math.max(0, 1 - (q - 0.8) / 0.2) // 最後にフェード
    drawScale(ctx, c.x, c.y, R * 0.6, tilt)
  }
  ctx.restore()
}
