// EnemyForm のrole別の追加設定（#67 §6.2）：守護型のオーラ・高難度のすり抜け・暴発型の狙い先。
import type { Enemy } from '../game/types'
import { NumField } from './ObstacleFormFields'
import { guardianAuraOptions } from './enemyRules'

interface Props {
  enemy: Enemy
  level: number
  onChange: (next: Enemy) => void
}

export default function EnemyRoleOptions({ enemy, level, onChange }: Props) {
  const aura = guardianAuraOptions(level)

  return (
    <>
      {enemy.role === 'guardian' && (
        <>
          {aura.directedAura && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={enemy.directedAura ?? false}
                onChange={(e) => onChange({ ...enemy, directedAura: e.target.checked || undefined })}
              />
              方向づけられた場（脅威方向に強度偏重・05b §5.4）
            </label>
          )}
          {aura.alternatingAura && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={enemy.alternatingAura ?? false}
                onChange={(e) => onChange({ ...enemy, alternatingAura: e.target.checked || undefined })}
              />
              交互張り（光⇔闇を毎ターン張り替え）
            </label>
          )}
        </>
      )}

      {(enemy.role === 'attacker' || enemy.role === 'ruptor') && level >= 5 && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={enemy.slipThrough ?? false}
            onChange={(e) => onChange({ ...enemy, slipThrough: e.target.checked || undefined })}
          />
          高難度：結界を同極ですり抜ける（slipThrough・05b §5.2）
        </label>
      )}

      {enemy.role === 'ruptor' && (
        <>
          <label>
            崩し手の狙い先
            <select
              value={enemy.ruptorTarget ?? 'allies'}
              onChange={(e) => onChange({ ...enemy, ruptorTarget: e.target.value === 'obstacles' ? 'obstacles' : undefined })}
            >
              <option value="allies">味方</option>
              <option value="obstacles">障害物（最初の1発のみ・デモ用）</option>
            </select>
          </label>
          <div className="pos-row">
            <NumField label="発射間隔(fireEvery)" value={enemy.fireEvery ?? 2} onChange={(v) => onChange({ ...enemy, fireEvery: v })} />
            <NumField label="位相(fireOffset)" value={enemy.fireOffset ?? 0} onChange={(v) => onChange({ ...enemy, fireOffset: v })} />
          </div>
        </>
      )}
    </>
  )
}
