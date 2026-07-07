// グリッドスナップ（#67 CAD風操作性）。ドラッグ中のポインタ座標をグリッド刻みに丸める。
import type { Vec2 } from '../game/types'

/** グリッド間隔（ゲーム座標の単位）。 */
export const GRID_STEP = 1

export function snapToGrid(p: Vec2, step: number = GRID_STEP): Vec2 {
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step }
}
