// EnemyForm の「多重詠唱を有効にする」セクション（#67 §6.3・05b §5.5）。
// castCount（フェーズ①の初期同時発射数）・patternPool（弾ごとに使うパターンの許可プール）を編集する。
// 断末魔（HP≤0の暴発3連）は engine 側の固定演出（finaleVariant）のため編集項目を持たない。
import type { Enemy, EnemyRole } from '../game/types'
import { NumField } from './ObstacleFormFields'

const ALL_ROLES: EnemyRole[] = ['attacker', 'breaker', 'guardian', 'ruptor']
const ROLE_LABELS: Record<EnemyRole, string> = {
  attacker: '迂回型',
  breaker: '火力型',
  guardian: '守護型',
  ruptor: '暴発型',
}

interface Props {
  enemy: Enemy
  onChange: (next: Enemy) => void
}

export default function EnemyBossSection({ enemy, onChange }: Props) {
  const togglePatternPool = (r: EnemyRole) => {
    const pool = enemy.patternPool ?? []
    const next = pool.includes(r) ? pool.filter((p) => p !== r) : [...pool, r]
    onChange({ ...enemy, patternPool: next.length > 0 ? next : undefined })
  }

  return (
    <>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={enemy.boss ?? false}
          onChange={(e) =>
            onChange({ ...enemy, boss: e.target.checked || undefined, castCount: e.target.checked ? (enemy.castCount ?? 1) : undefined })
          }
        />
        多重詠唱を有効にする（ボス個体・05b §5.5）
      </label>
      {enemy.boss && (
        <>
          <NumField
            label="初期 castCount（フェーズ①の同時発射数）"
            value={enemy.castCount ?? 1}
            onChange={(v) => onChange({ ...enemy, castCount: Math.max(1, Math.round(v)) })}
          />
          <div>
            パターンプール（patternPool・弾ごとに順繰りに使う）
            <div className="checkbox-grid">
              {ALL_ROLES.map((r) => (
                <label key={r} className="checkbox-row">
                  <input type="checkbox" checked={(enemy.patternPool ?? []).includes(r)} onChange={() => togglePatternPool(r)} />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </div>
          <p className="hint">
            断末魔（HP≤0での暴発3連）は boss=true の個体に自動発生する固定演出（暴発型×3固定）。patternPool は無視される（05b §5.5・06b §6 第7面）。
          </p>
        </>
      )}
    </>
  )
}
