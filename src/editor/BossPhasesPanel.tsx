// ボスのHPフェーズ表（bossPhases）編集パネル（#67 §6.3・06b §6 第7面）。
// castCount（同時発射数）・cullMinions（眷属間引き）・rField（崩落後の場の半径）をHP割合しきいごとに
// 編集する。obstacles（崩落後のアリーナ差し替え）はこの土台段階では編集対象にせず、既存配置を保持する
// （フル編集は#67の範囲外・followupsに記載）。断末魔（HP≤0の暴発3連）はengine側の固定演出のため
// 編集項目を持たない（EnemyForm側の説明を参照）。
import type { BossPhase } from '../game/types'
import { createDefaultBossPhase } from './model'

interface Props {
  bossPhases: BossPhase[]
  onChange: (next: BossPhase[]) => void
}

export default function BossPhasesPanel({ bossPhases, onChange }: Props) {
  const updateAt = (i: number, patch: Partial<BossPhase>) =>
    onChange(bossPhases.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const removeAt = (i: number) => onChange(bossPhases.filter((_, idx) => idx !== i))
  const add = () => onChange([...bossPhases, createDefaultBossPhase()])

  return (
    <section>
      <h3>ボスのHPフェーズ（多重詠唱・#67 §6.3）</h3>
      <p className="hint">HP割合がしきい（hpBelow）を下回るたびに同時発射数（castCount）等を切り替える（06b §6 第7面）。</p>
      {bossPhases.map((ph, i) => (
        <div key={i} className="obstacle-form">
          <label>
            HP割合しきい（hpBelow・例0.66）
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={ph.hpBelow}
              onChange={(e) => updateAt(i, { hpBelow: Number(e.target.value) })}
            />
          </label>
          <label>
            castCount（同時発射数）
            <input
              type="number"
              min={1}
              value={ph.castCount}
              onChange={(e) => updateAt(i, { castCount: Math.max(1, Math.round(Number(e.target.value))) })}
            />
          </label>
          <label>
            rField（崩落後の場の半径・未指定は据え置き）
            <input
              type="number"
              value={ph.rField ?? ''}
              placeholder="未指定"
              onChange={(e) => updateAt(i, { rField: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={ph.cullMinions ?? false} onChange={(e) => updateAt(i, { cullMinions: e.target.checked || undefined })} />
            眷属を間引く（cullMinions・最下層向け）
          </label>
          <p className="hint">アリーナ（obstacles）差し替え：{ph.obstacles.length}件（この段階では未編集・既存構成を保持）</p>
          <button className="btn small danger" onClick={() => removeAt(i)}>
            このフェーズを削除
          </button>
        </div>
      ))}
      <button className="btn small" onClick={add}>
        ＋フェーズを追加
      </button>
      <p className="hint">断末魔（HP≤0の暴発3連）はboss=trueの個体に自動発生する固定演出。ここでは編集しない。</p>
    </section>
  )
}
