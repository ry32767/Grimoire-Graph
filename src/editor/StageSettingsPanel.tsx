// ステージ全体設定パネル（既存ステージ選択・LVL・rField・mechanics）。StageEditor から分離（#67）。
import type { Mechanics } from '../game/types'
import { STAGES } from '../data/stages'
import { rFieldForSize } from '../data/stageBuilders'

/** LVL→推奨サイズの目安（06b §5.5 表・実装値の実測に基づく）。あくまで目安であり強制しない。 */
const LVL_SIZE_HINT: Record<number, number> = { 1: 1, 2: 1.5, 3: 2, 4: 3, 5: 3.5, 6: 3, 7: 2.5 }

/** 数値を [min, max] に丸める（NaN は min 扱い）。 */
function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, n))
}

interface Props {
  stageIndex: number
  level: number
  rField: number
  mechanics: Mechanics
  onSelectStage: (i: number) => void
  onLevelChange: (level: number) => void
  onRFieldChange: (rField: number) => void
  onMechanicsChange: (mechanics: Mechanics) => void
}

export default function StageSettingsPanel({
  stageIndex,
  level,
  rField,
  mechanics,
  onSelectStage,
  onLevelChange,
  onRFieldChange,
  onMechanicsChange,
}: Props) {
  const hintSize = LVL_SIZE_HINT[level] ?? 2.5
  const hintRField = rFieldForSize(hintSize)

  return (
    <section>
      <h3>ステージ設定</h3>
      <label>
        既存ステージ
        <select value={stageIndex} onChange={(e) => onSelectStage(Number(e.target.value))}>
          {STAGES.map((s, i) => (
            <option key={s.id} value={i}>
              {i + 1}. {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        LVL
        <input type="number" min={1} max={7} value={level} onChange={(e) => onLevelChange(clamp(Number(e.target.value), 1, 7))} />
      </label>
      <label>
        rField（場の半径）
        <input type="range" min={20} max={70} value={rField} onChange={(e) => onRFieldChange(Number(e.target.value))} />
        <input type="number" value={rField} onChange={(e) => onRFieldChange(Number(e.target.value))} />
      </label>
      <p className="hint">
        目安（LVL{level}・サイズ{hintSize}）: rField≈{hintRField}
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={mechanics.obstacles}
          onChange={(e) => onMechanicsChange({ ...mechanics, obstacles: e.target.checked })}
        />
        障害物あり
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={mechanics.enemyFire}
          onChange={(e) => onMechanicsChange({ ...mechanics, enemyFire: e.target.checked })}
        />
        敵弾あり
      </label>
    </section>
  )
}
