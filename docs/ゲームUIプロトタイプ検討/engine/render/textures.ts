// 壁のピクセルアート・テクスチャ（#56）。小さなタイルを一度だけ生成してキャッシュし、
// createPattern で壁の素材内（source-atop）に敷き詰める。種別ごとに石積み/鋲/亀裂/鋼を描く。
// 将来、実 PNG に差し替えたいときは getWallTexture を `new Image()` 読み込みへ替えるだけでよい。
import type { Attribute, ObstacleKind } from '../game/types'

interface Palette {
  base: string
  mortar: string
  face: string
  accent: string
}

// 種別・属性ごとの石の配色（draw.ts の塗り色と調和させる）
function paletteFor(kind: ObstacleKind, element: Attribute): Palette {
  if (kind === 'fragile') return { base: '#6e6a7a', mortar: '#46425a', face: '#86829a', accent: '#e6e6f0' }
  if (kind === 'tough') return { base: '#383846', mortar: '#20202c', face: '#50505f', accent: '#9ea0b6' }
  if (kind === 'unbreakable') return { base: '#181820', mortar: '#0d0d15', face: '#33333f', accent: '#6c6f86' }
  // normal は属性で色味を変える
  if (element === 'light') return { base: '#6e5a2e', mortar: '#473a1d', face: '#866f38', accent: '#b99a4c' }
  if (element === 'dark') return { base: '#3a3266', mortar: '#241e42', face: '#4d4490', accent: '#7d6fc4' }
  return { base: '#404050', mortar: '#282834', face: '#55556a', accent: '#7a7a92' }
}

const TILE = 22 // タイル1辺（デバイスピクセル）
const BRICK_H = 6 // レンガ1段の高さ
const cache = new Map<string, HTMLCanvasElement>()

/** レンガ積みのタイルを描く（段ごとに半個ずらす。種別で表面の装飾を変える）。 */
function makeTile(kind: ObstacleKind, pal: Palette): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = TILE
  cv.height = TILE
  const x = cv.getContext('2d')!
  x.imageSmoothingEnabled = false
  x.fillStyle = pal.base
  x.fillRect(0, 0, TILE, TILE)

  if (kind === 'unbreakable') {
    // 鋼：斜めのシェブロン＋鋲。レンガではなく金属板の質感
    x.strokeStyle = pal.face
    x.lineWidth = 1
    for (let i = -TILE; i < TILE; i += 5) {
      x.beginPath()
      x.moveTo(i, TILE)
      x.lineTo(i + TILE, 0)
      x.stroke()
    }
    x.fillStyle = pal.accent
    for (const [rx, ry] of [[4, 4], [TILE - 5, 4], [4, TILE - 5], [TILE - 5, TILE - 5], [TILE / 2 - 1, TILE / 2 - 1]])
      x.fillRect(rx, ry, 2, 2)
    return cv
  }

  // 石積み（normal/fragile/tough 共通）：段ごとに半個ずらしたレンガ
  let row = 0
  for (let y = 0; y < TILE; y += BRICK_H, row++) {
    const off = (row % 2) * (TILE / 2)
    // 段の面を少し明るく
    x.fillStyle = pal.face
    x.fillRect(0, y + 1, TILE, BRICK_H - 1)
    // 横目地
    x.fillStyle = pal.mortar
    x.fillRect(0, y, TILE, 1)
    // 縦目地（半個ずらし）
    for (let vx = off; vx <= TILE; vx += TILE / 2) x.fillRect(((vx % TILE) + TILE) % TILE, y, 1, BRICK_H)
    if (kind === 'tough') {
      // 鋲：各レンガ中央に明るい点
      x.fillStyle = pal.accent
      for (let vx = off + TILE / 4; vx < TILE + off; vx += TILE / 2)
        x.fillRect((((vx % TILE) + TILE) % TILE), y + BRICK_H / 2, 2, 2)
    }
  }
  if (kind === 'fragile') {
    // 亀裂：明るいジグザグを1本
    x.strokeStyle = pal.accent
    x.globalAlpha = 0.7
    x.lineWidth = 1
    x.beginPath()
    x.moveTo(TILE * 0.3, 0)
    x.lineTo(TILE * 0.45, TILE * 0.4)
    x.lineTo(TILE * 0.3, TILE * 0.7)
    x.lineTo(TILE * 0.5, TILE)
    x.stroke()
    x.globalAlpha = 1
  }
  return cv
}

/** 壁テクスチャのタイル（キャンバス）を返す。SSR 等で document が無ければ null。 */
export function getWallTexture(
  kind: ObstacleKind | undefined,
  element: Attribute,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const k = kind ?? 'normal'
  const key = `${k}:${element}`
  const hit = cache.get(key)
  if (hit) return hit
  const tile = makeTile(k, paletteFor(k, element))
  cache.set(key, tile)
  return tile
}
