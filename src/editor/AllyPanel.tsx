// 味方位置編集パネル（#67・docs/11-stage-editor.md §6.4）。ドラッグ（useEditorPointer 側）と
// 数値入力の両方で allyPositions を編集できる。「既定位置に戻す」で party.ts の値へ戻す。
import type { Vec2 } from '../game/types'
import { PARTY } from '../data/party'
import { NumField } from './ObstacleFormFields'

interface Props {
  /** 現在の表示位置（allyPositions があればそれ、無ければ PARTY 既定位置）。 */
  positions: Vec2[]
  onChange: (positions: Vec2[]) => void
  onReset: () => void
}

export default function AllyPanel({ positions, onChange, onReset }: Props) {
  const update = (i: number, patch: Partial<Vec2>) =>
    onChange(positions.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))

  return (
    <section>
      <h3>味方位置</h3>
      {PARTY.map((a, i) => (
        <div key={a.id} className="pos-row">
          <span className="ally-name">{a.name}</span>
          <NumField label="x" value={positions[i]?.x ?? a.pos.x} onChange={(v) => update(i, { x: v })} />
          <NumField label="y" value={positions[i]?.y ?? a.pos.y} onChange={(v) => update(i, { y: v })} />
        </div>
      ))}
      <button className="btn small" onClick={onReset}>
        既定位置に戻す
      </button>
    </section>
  )
}
