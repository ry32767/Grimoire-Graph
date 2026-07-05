// 壁（障害物 op）編集パネル（#67・docs/11-stage-editor.md §4）。追加・一覧選択・詳細フォーム・
// 部屋の囲いプリセットをまとめる。キャンバス上のクリック選択と合わせて使う（一覧はクリックが
// 取りづらい細い壁でも確実に選べる補助手段）。
import { useState } from 'react'
import type { ObstacleOp } from './model'
import { ADDABLE_OP_KINDS, OP_KIND_LABELS, createDefaultOp, type AddableOpKind } from './opEditing'
import ObstacleForm from './ObstacleForm'
import { opSummary } from './opSummary'

interface Props {
  ops: ObstacleOp[]
  selectedOpId: string | null
  onSelect: (id: string | null) => void
  onAdd: (op: ObstacleOp) => void
  onAddRoomPreset: (openEnds: boolean) => void
  onChangeOp: (next: ObstacleOp) => void
  onDeleteOp: (id: string) => void
}

export default function ObstaclePanel({ ops, selectedOpId, onSelect, onAdd, onAddRoomPreset, onChangeOp, onDeleteOp }: Props) {
  const [newKind, setNewKind] = useState<AddableOpKind>('pillar')
  const selected = ops.find((o) => o.id === selectedOpId) ?? null

  return (
    <section>
      <h3>壁（障害物）</h3>
      <label>
        種別
        <select value={newKind} onChange={(e) => setNewKind(e.target.value as AddableOpKind)}>
          {ADDABLE_OP_KINDS.map((k) => (
            <option key={k} value={k}>
              {OP_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <button className="btn small" onClick={() => onAdd(createDefaultOp(newKind))}>
        ＋壁を追加
      </button>
      <div className="wall-list">
        {ops.length === 0 && <p className="hint">まだ壁がありません。</p>}
        {ops.map((op) => (
          <button
            key={op.id}
            className={op.id === selectedOpId ? 'wall-list-item selected' : 'wall-list-item'}
            onClick={() => onSelect(op.id === selectedOpId ? null : op.id)}
          >
            {opSummary(op)}
          </button>
        ))}
      </div>
      <div className="room-preset-row">
        <button className="btn small" onClick={() => onAddRoomPreset(false)}>
          部屋の囲いを追加（四方）
        </button>
        <button className="btn small" onClick={() => onAddRoomPreset(true)}>
          部屋の囲いを追加（左右のみ）
        </button>
      </div>
      {selected && (
        <>
          <h3>選択中の壁</h3>
          <ObstacleForm op={selected} onChange={onChangeOp} onDelete={() => onDeleteOp(selected.id)} />
        </>
      )}
    </section>
  )
}
