// 敵編集パネル（#67・docs/11-stage-editor.md §6.1/§6.2）。種族→ティア選択で05cの初期値を自動入力して
// 追加し、一覧選択・詳細フォーム（EnemyForm）をまとめる。
import { useState } from 'react'
import type { Enemy, EnemySpecies } from '../game/types'
import { SPECIES_LABELS, SPECIES_LIST, SPECIES_TIERS, createEnemyFromTier } from './enemyTiers'
import EnemyForm from './EnemyForm'

interface Props {
  enemies: Enemy[]
  stageLevel: number
  rField: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: (enemy: Enemy) => void
  onChangeEnemy: (next: Enemy) => void
  onDeleteEnemy: (id: string) => void
}

export default function EnemyPanel({ enemies, stageLevel, rField, selectedId, onSelect, onAdd, onChangeEnemy, onDeleteEnemy }: Props) {
  const [species, setSpecies] = useState<EnemySpecies>('proto')
  const tiers = SPECIES_TIERS[species]
  const [tierId, setTierId] = useState(tiers[0].id)
  const tier = tiers.find((t) => t.id === tierId) ?? tiers[0]
  const selected = enemies.find((e) => e.id === selectedId) ?? null

  const handleSpeciesChange = (s: EnemySpecies) => {
    setSpecies(s)
    setTierId(SPECIES_TIERS[s][0].id)
  }

  const handleAdd = () => {
    const pos = { x: 0, y: Math.round(rField * 0.5) }
    onAdd(createEnemyFromTier(species, tier, pos))
  }

  return (
    <section>
      <h3>敵</h3>
      <label>
        種族
        <select value={species} onChange={(e) => handleSpeciesChange(e.target.value as EnemySpecies)}>
          {SPECIES_LIST.map((s) => (
            <option key={s} value={s}>
              {SPECIES_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        ティア
        <select value={tierId} onChange={(e) => setTierId(e.target.value)}>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.tierLabel}（LVL{t.level}）：{t.defaultName}
            </option>
          ))}
        </select>
      </label>
      <button className="btn small" onClick={handleAdd}>
        ＋敵を追加
      </button>
      <div className="wall-list">
        {enemies.length === 0 && <p className="hint">まだ敵がいません。</p>}
        {enemies.map((e) => (
          <button
            key={e.id}
            className={e.id === selectedId ? 'wall-list-item selected' : 'wall-list-item'}
            onClick={() => onSelect(e.id === selectedId ? null : e.id)}
          >
            {e.name}（LVL{e.level ?? stageLevel}・HP{e.hp}）
          </button>
        ))}
      </div>
      {selected && (
        <>
          <h3>選択中の敵</h3>
          <EnemyForm
            enemy={selected}
            stageLevel={stageLevel}
            onChange={onChangeEnemy}
            onDelete={() => onDeleteEnemy(selected.id)}
          />
        </>
      )}
    </section>
  )
}
