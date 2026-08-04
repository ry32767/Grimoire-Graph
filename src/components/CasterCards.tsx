// 右レールの術者カード（DC プロトタイプ v3 の casters）。
// 3 人ぶんの HP・いまの式（y / z）・読み出しの一行サマリを並べ、押すと編集対象が切り替わる。
import type { Ally } from '../game/types'
import type { Readout } from './readout'
import type { ComposerState } from './composer'

interface Props {
  allies: Ally[]
  composers: Record<string, ComposerState>
  readouts: Record<string, Readout>
  activeAllyId: string
  impairedIds: string[]
  /** このターンで術式を設定/変更した味方ID（準備状況） */
  touchedIds: string[]
  onSelect: (id: string) => void
}

export default function CasterCards({ allies, composers, readouts, activeAllyId, impairedIds, touchedIds, onSelect }: Props) {
  return (
    <div className="caster-cards rwin rwin-flat">
      <div className="caster-head">術者 — 各自に式を割り当てる</div>
      {allies.map((a) => {
        const c = composers[a.id]
        const r = readouts[a.id]
        const dead = a.hp <= 0
        const active = a.id === activeAllyId
        const ratio = Math.max(0, a.hp) / Math.max(1, a.maxHp)
        const tone = dead || ratio < 0.25 ? 'low' : ratio < 0.5 ? 'mid' : a.element
        return (
          <button
            key={a.id}
            type="button"
            className={`caster-card${active ? ' active' : ''}${dead ? ' dead' : ''}`}
            disabled={dead}
            onClick={() => onSelect(a.id)}
          >
            <span className="caster-row">
              <span className={`caster-name el-${a.element}`}>
                {a.name}
                {touchedIds.includes(a.id) && !dead && (
                  <span className="caster-ready" aria-label="術式を設定済み">
                    ◎
                  </span>
                )}
              </span>
              <span className={`caster-mark tone-${impairedIds.includes(a.id) ? 'danger' : (r?.markTone ?? 'dim')}`}>
                {dead ? '戦闘不能' : (r?.mark ?? '—')}
              </span>
            </span>
            <span className="caster-row">
              <span className={`caster-hp tone-${tone}`}>
                <span className="fill" style={{ width: `${ratio * 100}%` }} />
              </span>
              <span className={`caster-hp-num tone-${tone}`}>{Math.max(0, Math.ceil(a.hp))}</span>
              <span className="caster-hp-max">/{a.maxHp}</span>
            </span>
            <span className="caster-expr">
              {c?.mode === 'polar' ? '' : 'y='}
              {c?.yText || '0'} <span className="sep">·</span> z={c?.zText || '0'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
