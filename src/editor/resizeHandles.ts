// 選択ハンドルによるドラッグリサイズ（#67 CAD風操作性）。
// 円系（disc/ring）は半径ハンドル1点、矩形（rect）は右上角ハンドル1点をサポートする。
// それ以外の op 種別（pillar/wall/colonnade 等）は本数・間隔で形が決まり単純な
// 半径/幅高さに還元できないため対象外（既存のパネル数値入力で編集する）。
import { dist } from '../game/coords'
import type { Vec2 } from '../game/types'
import type { ObstacleOp } from './model'

export interface ResizeHandle {
  id: string
  pos: Vec2
}

const MIN_SIZE = 0.5
/** ハンドルの当たり判定半径（ゲーム座標の単位）。 */
export const HANDLE_HIT_RADIUS = 1.5

/** op が今どんなハンドルを持つか（選択中のみ表示・判定に使う）。対象外の op 種別は空配列。 */
export function getResizeHandles(op: ObstacleOp): ResizeHandle[] {
  switch (op.kind) {
    case 'disc':
      return [{ id: 'radius', pos: { x: op.params.cx + op.params.r, y: op.params.cy } }]
    case 'ring':
      return [{ id: 'radius', pos: { x: op.params.cx + op.params.radius, y: op.params.cy } }]
    case 'rect':
      return [{ id: 'corner', pos: { x: op.params.x + op.params.w, y: op.params.y + op.params.h } }]
    default:
      return []
  }
}

/** 点 m が op のいずれかのハンドル近傍か（ヒットしたハンドル id、無ければ null）。 */
export function hitTestHandle(op: ObstacleOp, m: Vec2): string | null {
  for (const h of getResizeHandles(op)) {
    if (dist(m, h.pos) <= HANDLE_HIT_RADIUS) return h.id
  }
  return null
}

/** ハンドルを絶対座標 pos までドラッグしたときの op（リサイズ後）。 */
export function resizeOpBy(op: ObstacleOp, handleId: string, pos: Vec2): ObstacleOp {
  switch (op.kind) {
    case 'disc':
      if (handleId !== 'radius') return op
      return { ...op, params: { ...op.params, r: Math.max(MIN_SIZE, dist(pos, { x: op.params.cx, y: op.params.cy })) } }
    case 'ring':
      if (handleId !== 'radius') return op
      return {
        ...op,
        params: { ...op.params, radius: Math.max(MIN_SIZE, dist(pos, { x: op.params.cx, y: op.params.cy })) },
      }
    case 'rect':
      if (handleId !== 'corner') return op
      return {
        ...op,
        params: {
          ...op.params,
          w: Math.max(MIN_SIZE, pos.x - op.params.x),
          h: Math.max(MIN_SIZE, pos.y - op.params.y),
        },
      }
    default:
      return op
  }
}
