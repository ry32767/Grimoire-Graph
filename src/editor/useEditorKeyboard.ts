// キーボード操作（矢印ナッジ・Delete・Undo/Redo・#67 CAD風操作性）。
// フォーム入力中（input/textarea/select にフォーカス）は素通しし、盤面操作の邪魔をしない。
import { useEffect } from 'react'
import type { Enemy, Vec2 } from '../game/types'
import type { EditorSelection } from './useEditorPointer'
import type { ObstacleOp } from './model'
import { moveOpBy } from './opEditing'

interface Opts {
  selection: EditorSelection
  obstacleOps: ObstacleOp[]
  enemies: Enemy[]
  allyPositions: Vec2[]
  updateOp: (next: ObstacleOp) => void
  deleteOp: (id: string) => void
  updateEnemy: (next: Enemy) => void
  deleteEnemy: (id: string) => void
  moveAllyTo: (index: number, pos: Vec2) => void
  undo: () => void
  redo: () => void
}

const NUDGE_STEP = 1
const NUDGE_STEP_FINE = 5

export function useEditorKeyboard(opts: Opts): void {
  const {
    selection,
    obstacleOps,
    enemies,
    allyPositions,
    updateOp,
    deleteOp,
    updateEnemy,
    deleteEnemy,
    moveAllyTo,
    undo,
    redo,
  } = opts

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }

      if (!selection) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.kind === 'obstacle') {
          e.preventDefault()
          deleteOp(selection.id)
        } else if (selection.kind === 'enemy') {
          e.preventDefault()
          deleteEnemy(selection.id)
        }
        return
      }

      const step = e.shiftKey ? NUDGE_STEP_FINE : NUDGE_STEP
      let dx = 0
      let dy = 0
      if (e.key === 'ArrowLeft') dx = -step
      else if (e.key === 'ArrowRight') dx = step
      else if (e.key === 'ArrowUp') dy = step // ゲーム座標は y 上向き（game/coords.ts）
      else if (e.key === 'ArrowDown') dy = -step
      else return
      e.preventDefault()

      if (selection.kind === 'obstacle') {
        const op = obstacleOps.find((o) => o.id === selection.id)
        if (op) updateOp(moveOpBy(op, { x: dx, y: dy }))
      } else if (selection.kind === 'enemy') {
        const enemy = enemies.find((en) => en.id === selection.id)
        if (enemy) updateEnemy({ ...enemy, pos: { x: enemy.pos.x + dx, y: enemy.pos.y + dy } })
      } else {
        const pos = allyPositions[selection.index]
        if (pos) moveAllyTo(selection.index, { x: pos.x + dx, y: pos.y + dy })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selection, obstacleOps, enemies, allyPositions, updateOp, deleteOp, updateEnemy, deleteEnemy, moveAllyTo, undo, redo])
}
