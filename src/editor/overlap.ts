// 障害物どうしの意図しない重なり検出（#67 §4.2）。model 側の純粋関数として素材（円・矩形）レベルで判定する。
import type { Disc, Obstacle, Rect } from '../game/types'
import { dist } from '../game/coords'

/** 重なりの可視化用マーカー（中心・半径・関与した2つの Obstacle id）。厳密な交差形状ではなく目安。 */
export interface OverlapMark {
  obstacleIds: [string, string]
  x: number
  y: number
  r: number
}

function circleCircleOverlap(a: Disc, b: Disc): Omit<OverlapMark, 'obstacleIds'> | null {
  const d = dist(a, b)
  if (d >= a.r + b.r) return null
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: Math.min(a.r, b.r) }
}

function circleRectOverlap(c: Disc, r: Rect): Omit<OverlapMark, 'obstacleIds'> | null {
  const nx = Math.min(Math.max(c.x, r.x), r.x + r.w)
  const ny = Math.min(Math.max(c.y, r.y), r.y + r.h)
  if (dist(c, { x: nx, y: ny }) >= c.r) return null
  return { x: nx, y: ny, r: Math.max(c.r * 0.5, 0.6) }
}

function rectRectOverlap(a: Rect, b: Rect): Omit<OverlapMark, 'obstacleIds'> | null {
  const ix0 = Math.max(a.x, b.x)
  const ix1 = Math.min(a.x + a.w, b.x + b.w)
  const iy0 = Math.max(a.y, b.y)
  const iy1 = Math.min(a.y + a.h, b.y + b.h)
  if (ix1 <= ix0 || iy1 <= iy0) return null
  return { x: (ix0 + ix1) / 2, y: (iy0 + iy1) / 2, r: Math.max((ix1 - ix0) / 2, (iy1 - iy0) / 2) }
}

/**
 * 複数障害物の素材（solids・rects）が重なる箇所を検出する（#67 §4.2）。
 * 同じ Obstacle 同士（自分自身）は比較しない。異なる Obstacle 間の重なりのみを警告対象にする
 * （1つの op 内で意図的に重ねる solids 同士＝連続ブロブは同じ Obstacle にまとまるため対象外）。
 */
export function detectOverlaps(obstacles: Obstacle[]): OverlapMark[] {
  const marks: OverlapMark[] = []
  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i]
      const b = obstacles[j]
      const ids: [string, string] = [a.id, b.id]
      for (const da of a.solids) {
        for (const db of b.solids) {
          const m = circleCircleOverlap(da, db)
          if (m) marks.push({ ...m, obstacleIds: ids })
        }
        for (const rb of b.rects ?? []) {
          const m = circleRectOverlap(da, rb)
          if (m) marks.push({ ...m, obstacleIds: ids })
        }
      }
      for (const ra of a.rects ?? []) {
        for (const db of b.solids) {
          const m = circleRectOverlap(db, ra)
          if (m) marks.push({ ...m, obstacleIds: ids })
        }
        for (const rb of b.rects ?? []) {
          const m = rectRectOverlap(ra, rb)
          if (m) marks.push({ ...m, obstacleIds: ids })
        }
      }
    }
  }
  return marks
}
