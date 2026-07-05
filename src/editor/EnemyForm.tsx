// 選択中の敵の詳細フォーム（#67・docs/11-stage-editor.md §6.2）。
// role/LVL に応じて family・z場の選択肢を allowedFamilies/allowedZFields で絞り込む（05b §2・06b §3）。
// castInitialSpeed は仕様上「表示のみ・編集不可」（06b §2）。
import type { Enemy, EnemyRole } from '../game/types'
import { ElementSelect, NumField } from './ObstacleFormFields'
import { FamiliesCheckboxes, FamilySelect, RoleSelect } from './EnemyFormFields'
import EnemyZFieldSection from './EnemyZFieldSection'
import EnemyRoleOptions from './EnemyRoleOptions'
import EnemyBossSection from './EnemyBossSection'
import { allowedFamilies, allowedRoles, allowedZFields } from './enemyRules'

interface Props {
  enemy: Enemy
  /** ステージ既定LVL（敵に個別のLVLが無いときのフォールバック。06b §1：敵ごとに個別のLVLを持たせてよい）。 */
  stageLevel: number
  onChange: (next: Enemy) => void
  onDelete: () => void
}

export default function EnemyForm({ enemy, stageLevel, onChange, onDelete }: Props) {
  const level = enemy.level ?? stageLevel
  const roles = allowedRoles(level)
  const families = allowedFamilies(enemy.role, level)
  const zPresets = allowedZFields(enemy.role, level)

  const setRole = (role: EnemyRole | undefined) => {
    // role が変わると family/z場の許可集合が変わるため、現在値が範囲外なら安全な既定へ寄せる。
    const nextFamilies = allowedFamilies(role, level)
    const nextFamily = nextFamilies.includes(enemy.family) ? enemy.family : (nextFamilies[0] ?? enemy.family)
    onChange({ ...enemy, role, family: nextFamily, families: enemy.families?.filter((f) => nextFamilies.includes(f)) })
  }

  const setLevel = (lv: number) => {
    const clamped = Math.min(7, Math.max(1, Math.round(lv)))
    const nextFamilies = allowedFamilies(enemy.role, clamped)
    const nextFamily = nextFamilies.includes(enemy.family) ? enemy.family : (nextFamilies[0] ?? enemy.family)
    onChange({ ...enemy, level: clamped, family: nextFamily, families: enemy.families?.filter((f) => nextFamilies.includes(f)) })
  }

  return (
    <div className="enemy-form">
      <label>
        固有名詞
        <input type="text" value={enemy.name} onChange={(e) => onChange({ ...enemy, name: e.target.value })} />
      </label>
      <div className="pos-row">
        <NumField label="x" value={enemy.pos.x} onChange={(v) => onChange({ ...enemy, pos: { ...enemy.pos, x: v } })} />
        <NumField label="y" value={enemy.pos.y} onChange={(v) => onChange({ ...enemy, pos: { ...enemy.pos, y: v } })} />
      </div>
      <NumField label="LVL" value={level} onChange={setLevel} />
      <label>
        属性（被弾相性）
        <ElementSelect value={enemy.element} onChange={(v) => onChange({ ...enemy, element: v })} />
      </label>
      <label>
        パターン（role）
        <RoleSelect value={enemy.role} options={roles} onChange={setRole} />
      </label>
      <label>
        得意関数（family）
        <FamilySelect value={enemy.family} options={families} onChange={(f) => onChange({ ...enemy, family: f })} />
      </label>
      <div>
        追加の得意関数（families[]）
        <FamiliesCheckboxes
          value={enemy.families ?? []}
          primary={enemy.family}
          options={families}
          onChange={(v) => onChange({ ...enemy, families: v.length > 0 ? v : undefined })}
        />
      </div>

      <EnemyZFieldSection enemy={enemy} zPresets={zPresets} onChange={onChange} />
      <EnemyRoleOptions enemy={enemy} level={level} onChange={onChange} />

      <div className="pos-row">
        <NumField label="HP" value={enemy.hp} onChange={(v) => onChange({ ...enemy, hp: v, maxHp: v })} />
        <NumField label="hitboxRadius" value={enemy.hitboxRadius} onChange={(v) => onChange({ ...enemy, hitboxRadius: v })} />
      </div>
      <p className="hint">castInitialSpeed（初速）：{enemy.castInitialSpeed}（表示のみ・編集不可。06b §2）</p>

      <EnemyBossSection enemy={enemy} onChange={onChange} />

      <button className="btn small danger" onClick={onDelete}>
        この敵を削除
      </button>
    </div>
  )
}
