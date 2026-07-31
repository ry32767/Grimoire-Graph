// EnemyForm が使い回す共通入力部品（#67 §6.2）。ObstacleFormFields と対になる敵編集版。
import type { EnemyFamily, EnemyRole } from '../game/types'
import { Z_FIELD_PRESET_LABELS, type ZFieldPreset } from './enemyRules'

const ROLE_LABELS: Record<EnemyRole, string> = {
  attacker: '迂回型（attacker）',
  breaker: '火力型（breaker）',
  guardian: '守護型（guardian）',
  ruptor: '暴発型（ruptor）',
}
const FAMILY_LABELS: Record<EnemyFamily, string> = {
  line: '直進（line）',
  arc: '弧（arc）',
  wave: '波（wave）',
  spiral: '渦（spiral）',
  exp: '昇り（exp）',
  poly34: '捻れ（poly34）',
  harmonic: '重波（harmonic）',
  abs: '折れ（abs）',
}

/** role プルダウン。選択肢は allowedRoles(level) の結果を渡す（LVLで絞り込み済み）。 */
export function RoleSelect({
  value,
  options,
  onChange,
}: {
  value?: EnemyRole
  options: EnemyRole[]
  onChange: (v: EnemyRole | undefined) => void
}) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : (e.target.value as EnemyRole))}>
      <option value="">未指定（単純attacker）</option>
      {options.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  )
}

/** family プルダウン（主系統）。選択肢は allowedFamilies(role, level) の結果を渡す。 */
export function FamilySelect({
  value,
  options,
  onChange,
}: {
  value: EnemyFamily
  options: EnemyFamily[]
  onChange: (v: EnemyFamily) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as EnemyFamily)}>
      {options.map((f) => (
        <option key={f} value={f}>
          {FAMILY_LABELS[f]}
        </option>
      ))}
    </select>
  )
}

/** families[]（追加の得意系統）のチェックボックス群。主系統と同じ許可表から選ぶ（05b §2/#28）。 */
export function FamiliesCheckboxes({
  value,
  primary,
  options,
  onChange,
}: {
  value: EnemyFamily[]
  primary: EnemyFamily
  options: EnemyFamily[]
  onChange: (v: EnemyFamily[]) => void
}) {
  const toggle = (f: EnemyFamily) => {
    onChange(value.includes(f) ? value.filter((v) => v !== f) : [...value, f])
  }
  return (
    <div className="checkbox-grid">
      {options
        .filter((f) => f !== primary)
        .map((f) => (
          <label key={f} className="checkbox-row">
            <input type="checkbox" checked={value.includes(f)} onChange={() => toggle(f)} />
            {FAMILY_LABELS[f]}
          </label>
        ))}
    </div>
  )
}

/** z場プリセットのプルダウン。選択肢は allowedZFields(role, level) の結果を渡す（空なら選択肢なし＝暴発型）。 */
export function ZFieldPresetSelect({
  value,
  options,
  onChange,
}: {
  value: ZFieldPreset
  options: ZFieldPreset[]
  onChange: (v: ZFieldPreset) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as ZFieldPreset)}>
      {options.map((p) => (
        <option key={p} value={p}>
          {Z_FIELD_PRESET_LABELS[p]}
        </option>
      ))}
    </select>
  )
}
