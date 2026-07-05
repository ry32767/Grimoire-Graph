// キャンバス上の障害物・敵・味方のクリック選択とドラッグ移動を統合したポインタハンドラ（#67）。
// BattleCanvas は onAim という1系統のコールバックしか公開しないため、3種類のヒットテストを
// ここで束ねて振り分ける（旧 useObstacleEditing を敵・味方にも対応するよう一般化）。
// 判定優先度は 味方＞敵＞障害物（描画上手前にいるものから拾う＝選びやすさを合わせる）。
// ポインタの押下〜離す一連の操作は window の pointerup/pointercancel で自前に区切る
// （BattleCanvas は onAim にしか通知しないため、ジェスチャーの境界が分からない）。
import { useEffect, useRef, useState } from 'react'
import type { Enemy, Vec2 } from '../game/types'
import type { CompiledOp, ObstacleOp } from './model'
import { hitTestOp, moveOpBy } from './opEditing'
import { hitTestEnemy } from './enemyEditing'
import { hitTestAlly } from './allyEditing'

/** 選択対象（障害物 op／敵／味方のいずれか）。null は未選択。 */
export type EditorSelection =
  | { kind: 'obstacle'; id: string }
  | { kind: 'enemy'; id: string }
  | { kind: 'ally'; index: number }
  | null

export function useEditorPointer(
  obstacleOps: ObstacleOp[],
  compiledOps: CompiledOp[],
  enemies: Enemy[],
  allyPositions: Vec2[],
  updateOp: (next: ObstacleOp) => void,
  moveEnemyTo: (id: string, pos: Vec2) => void,
  moveAllyTo: (index: number, pos: Vec2) => void,
) {
  const [selection, setSelection] = useState<EditorSelection>(null)
  const draggingRef = useRef(false)
  const anchorRef = useRef<Vec2 | null>(null)
  const targetRef = useRef<EditorSelection>(null)

  useEffect(() => {
    const endDrag = () => {
      draggingRef.current = false
      anchorRef.current = null
      targetRef.current = null
    }
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [])

  const handleFieldPointer = (m: Vec2) => {
    if (!draggingRef.current) {
      // ジェスチャー開始（ポインタダウン相当）：味方→敵→障害物の順にヒットテストして選択する
      draggingRef.current = true
      const allyHit = hitTestAlly(allyPositions, m)
      const enemyHit = allyHit === null ? hitTestEnemy(enemies, m) : null
      let target: EditorSelection = null
      if (allyHit !== null) target = { kind: 'ally', index: allyHit }
      else if (enemyHit) target = { kind: 'enemy', id: enemyHit }
      else {
        const opHit = hitTestOp(compiledOps, m)
        target = opHit ? { kind: 'obstacle', id: opHit } : null
      }
      setSelection(target)
      targetRef.current = target
      anchorRef.current = m
      return
    }
    const anchor = anchorRef.current
    const target = targetRef.current
    anchorRef.current = m
    if (!anchor || !target) return
    const delta = { x: m.x - anchor.x, y: m.y - anchor.y }
    if (target.kind === 'obstacle') {
      const op = obstacleOps.find((o) => o.id === target.id)
      if (op) updateOp(moveOpBy(op, delta))
    } else if (target.kind === 'enemy') {
      const enemy = enemies.find((e) => e.id === target.id)
      if (enemy) moveEnemyTo(enemy.id, { x: enemy.pos.x + delta.x, y: enemy.pos.y + delta.y })
    } else {
      const pos = allyPositions[target.index]
      if (pos) moveAllyTo(target.index, { x: pos.x + delta.x, y: pos.y + delta.y })
    }
  }

  return { selection, setSelection, handleFieldPointer }
}
