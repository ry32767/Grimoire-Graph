// 障害物 op の編集操作（追加・選択・ドラッグ移動・プリセット・#67 §4.1〜§4.4）。
// obstacleOps 配列そのものを書き換える純粋関数群。React state 更新は呼び出し側（StageEditor）が行う。
import type { Obstacle, Vec2 } from '../game/types'
import { dist } from '../game/coords'
import { nextOpId, type CompiledOp, type ObstacleOp } from './model'

/** 点 p が障害物の素材（円 or 矩形）の内側にあるか（キャンバスクリック選択の当たり判定）。 */
export function pointInObstacle(o: Obstacle, p: Vec2): boolean {
  if (o.solids.some((d) => dist(p, { x: d.x, y: d.y }) <= d.r)) return true
  return (o.rects ?? []).some((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)
}

/** 点 p にヒットする最も手前（配列末尾＝最後に追加）の op の id。ヒットが無ければ null。 */
export function hitTestOp(compiled: CompiledOp[], p: Vec2): string | null {
  for (let i = compiled.length - 1; i >= 0; i--) {
    if (compiled[i].obstacles.some((o) => pointInObstacle(o, p))) return compiled[i].opId
  }
  return null
}

/** op の基準座標を移動量ぶんずらす（ドラッグ移動・#67 §4.3）。raw op は素材の全点を直接ずらす。 */
export function moveOpBy(op: ObstacleOp, delta: Vec2): ObstacleOp {
  switch (op.kind) {
    case 'pillar':
      return { ...op, params: { ...op.params, cx: op.params.cx + delta.x, y0: op.params.y0 + delta.y } }
    case 'block':
      return { ...op, params: { ...op.params, x0: op.params.x0 + delta.x, y0: op.params.y0 + delta.y } }
    case 'wall':
      return {
        ...op,
        params: { ...op.params, x0: op.params.x0 + delta.x, x1: op.params.x1 + delta.x, y0: op.params.y0 + delta.y },
      }
    case 'colonnade':
      return {
        ...op,
        params: { ...op.params, x0: op.params.x0 + delta.x, x1: op.params.x1 + delta.x, y0: op.params.y0 + delta.y },
      }
    case 'spiralArm':
      return { ...op, params: { ...op.params, cx: op.params.cx + delta.x, cy: op.params.cy + delta.y } }
    case 'disc':
      return { ...op, params: { ...op.params, cx: op.params.cx + delta.x, cy: op.params.cy + delta.y } }
    case 'rect':
      return { ...op, params: { ...op.params, x: op.params.x + delta.x, y: op.params.y + delta.y } }
    case 'ring':
      return { ...op, params: { ...op.params, cx: op.params.cx + delta.x, cy: op.params.cy + delta.y } }
    case 'roomWalls':
      return {
        ...op,
        params: {
          ...op.params,
          xL: op.params.xL + delta.x,
          xR: op.params.xR + delta.x,
          yB: op.params.yB + delta.y,
          yT: op.params.yT + delta.y,
        },
      }
    case 'roomWallsOpenEnds':
      return { ...op, params: { xL: op.params.xL + delta.x, xR: op.params.xR + delta.x } }
    case 'raw':
      return {
        ...op,
        params: {
          obstacles: op.params.obstacles.map((o) => ({
            ...o,
            solids: o.solids.map((d) => ({ ...d, x: d.x + delta.x, y: d.y + delta.y })),
            rects: o.rects?.map((r) => ({ ...r, x: r.x + delta.x, y: r.y + delta.y })),
            carves: o.carves.map((d) => ({ ...d, x: d.x + delta.x, y: d.y + delta.y })),
          })),
        },
      }
  }
}

/** 「＋壁を追加」で選べる op 種別（raw は既存ステージ取り込み専用のため選択肢に出さない）。 */
export const ADDABLE_OP_KINDS = [
  'disc',
  'rect',
  'pillar',
  'block',
  'wall',
  'colonnade',
  'spiralArm',
  'ring',
  'roomWalls',
  'roomWallsOpenEnds',
] as const
export type AddableOpKind = (typeof ADDABLE_OP_KINDS)[number]

/** op 種別ごとの表示名（docs/11-stage-editor.md §4.1）。 */
export const OP_KIND_LABELS: Record<AddableOpKind, string> = {
  disc: '円・任意半径（disc）',
  rect: '矩形・自由サイズ（rect）',
  pillar: '柱（pillar）',
  block: '矩形ブロック（block）',
  wall: '横壁（wall）',
  colonnade: '列柱（colonnade）',
  spiralArm: '螺旋の腕（spiralArm）',
  ring: 'リング（ring）',
  roomWalls: '部屋の囲い・四方（roomWalls）',
  roomWallsOpenEnds: '部屋の囲い・左右のみ（roomWallsOpenEnds）',
}

/** 種別を選ぶと追加される既定 op（フィールド中央付近・#67 §4.1）。 */
export function createDefaultOp(kind: AddableOpKind): ObstacleOp {
  const id = nextOpId()
  switch (kind) {
    case 'disc':
      return { id, kind, params: { cx: 0, cy: 0, r: 3, element: 'neutral' } }
    case 'rect':
      return { id, kind, params: { x: -5, y: -5, w: 10, h: 10, element: 'neutral' } }
    case 'pillar':
      return { id, kind, params: { cx: 0, y0: 0, n: 5, element: 'neutral' } }
    case 'block':
      return { id, kind, params: { x0: -3, y0: -3, cols: 3, rows: 3, element: 'neutral' } }
    case 'wall':
      return { id, kind, params: { x0: -6, x1: 6, y0: 0, rows: 1, element: 'neutral' } }
    case 'colonnade':
      return { id, kind, params: { x0: -10, x1: 10, step: 5, y0: 0, n: 3, elems: ['neutral'] } }
    case 'spiralArm':
      return { id, kind, params: { cx: 0, cy: 0, n: 20, turns: 2, phase: 0, element: 'neutral' } }
    case 'ring':
      return { id, kind, params: { cx: 0, cy: 0, radius: 8, element: 'neutral' } }
    case 'roomWalls':
      return { id, kind, params: { xL: -10, xR: 10, yB: -10, yT: 10 } }
    case 'roomWallsOpenEnds':
      return { id, kind, params: { xL: -10, xR: 10 } }
  }
}

/**
 * 部屋の囲いプリセット（旧・翼壁／#67 §4.4）：現在の rField に合わせた部屋の矩形を自動生成する。
 * 生成される範囲はあくまで出発点（rField の 4〜6 割）で、以後は通常どおり編集できる。
 */
export function roomPresetOp(rField: number, openEnds: boolean): ObstacleOp {
  const id = nextOpId()
  const w = Math.round(rField * 0.4)
  const h = Math.round(rField * 0.55)
  return openEnds
    ? { id, kind: 'roomWallsOpenEnds', params: { xL: -w, xR: w } }
    : { id, kind: 'roomWalls', params: { xL: -w, xR: w, yB: -h, yT: h } }
}
