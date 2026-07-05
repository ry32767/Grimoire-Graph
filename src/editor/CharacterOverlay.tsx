// 選択中の敵・味方のハイライト（#67 §6.2/§6.4）。ObstacleOverlay と同じ SVG 手法（描画には手を加えない）。
import type { Enemy, Vec2 } from '../game/types'
import type { Viewport } from '../game/coords'
import { scaleOf, toScreen } from '../game/coords'
import { GAME } from '../data/constants'
import type { EditorSelection } from './useEditorPointer'

interface Props {
  enemies: Enemy[]
  allyPositions: Vec2[]
  selection: EditorSelection
  rField: number
  internal: number
}

export default function CharacterOverlay({ enemies, allyPositions, selection, rField, internal }: Props) {
  if (!selection || selection.kind === 'obstacle') return null
  const vp: Viewport = { width: internal, height: internal, unitsRadius: rField }
  const s = scaleOf(vp)

  let pos: Vec2 | null = null
  let radius = 2
  if (selection.kind === 'enemy') {
    const e = enemies.find((en) => en.id === selection.id)
    if (e) {
      pos = e.pos
      radius = e.hitboxRadius
    }
  } else {
    pos = allyPositions[selection.index] ?? null
    radius = GAME.allyHitbox
  }
  if (!pos) return null
  const p = toScreen(pos, vp)

  return (
    <svg className="stage-editor-overlay" viewBox={`0 0 ${internal} ${internal}`} width={internal} height={internal} style={{ pointerEvents: 'none' }}>
      <circle cx={p.x} cy={p.y} r={Math.max(radius * s, 6) + 4} className="character-selection-mark" />
    </svg>
  )
}
