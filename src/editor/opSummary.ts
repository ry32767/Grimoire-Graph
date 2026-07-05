// 障害物 op の一覧表示用ラベル（#67 §4）。ObstacleOverlay/ObstaclePanel の両方から使う純粋関数。
import type { ObstacleOp } from './model'

/** op の代表座標・種別をひとこと表示する（壁一覧・デバッグ用）。 */
export function opSummary(op: ObstacleOp): string {
  switch (op.kind) {
    case 'pillar':
      return `柱 (${op.params.cx}, ${op.params.y0})`
    case 'block':
      return `矩形 (${op.params.x0}, ${op.params.y0})`
    case 'wall':
      return `横壁 x:${op.params.x0}〜${op.params.x1}`
    case 'colonnade':
      return `列柱 x:${op.params.x0}〜${op.params.x1}`
    case 'spiralArm':
      return `螺旋 (${op.params.cx}, ${op.params.cy})`
    case 'ring':
      return `リング (${op.params.cx}, ${op.params.cy})`
    case 'roomWalls':
      return `部屋 x:${op.params.xL}〜${op.params.xR}`
    case 'roomWallsOpenEnds':
      return `部屋(左右) x:${op.params.xL}〜${op.params.xR}`
    case 'raw':
      return `既存壁 ×${op.params.obstacles.length}`
  }
}
