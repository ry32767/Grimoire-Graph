import type { Ally, Enemy, StatusEffect } from '../game/types'
import { INSTABILITY } from '../data/constants'
import { remainingMisfires } from '../game/misfireInstability'

function StatusBadges({ statuses }: { statuses: StatusEffect[] }) {
  if (statuses.length === 0) return null
  return (
    <span className="status-badges">
      {statuses.map((s, i) => (
        <span key={i} className={`badge ${s.kind}`}>
          {s.kind === 'flinch' ? `ひるみ${s.remainingTurns}` : `DoT${s.remainingTurns}`}
        </span>
      ))}
    </span>
  )
}

function HpRow({
  name,
  hp,
  maxHp,
  enemy,
  active,
  statuses,
  impaired,
  ready,
  onSelect,
}: {
  name: string
  hp: number
  maxHp: number
  enemy?: boolean
  active?: boolean
  statuses: StatusEffect[]
  impaired?: boolean
  ready?: boolean
  onSelect?: () => void
}) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100))
  const dead = hp <= 0
  // 状態異常でバーの形を変える（#24）：ひるみ＝ギザギザ、継続ダメージ＝炎の波形
  const hasFlinch = statuses.some((s) => s.kind === 'flinch')
  const hasBurn = statuses.some((s) => s.kind === 'burn')
  const barClass = `hp-bar${hasFlinch ? ' flinch' : ''}${hasBurn ? ' burn' : ''}`
  const tappable = !!onSelect && !dead
  // 味方は行ごとタップでそのキャラの関数編集へ（#48）
  const Tag = tappable ? 'button' : 'div'
  return (
    <Tag
      className={`hp-row${active ? ' active' : ''}${dead ? ' dead' : ''}${tappable ? ' tappable' : ''}`}
      onClick={tappable ? onSelect : undefined}
      {...(tappable ? { type: 'button' as const } : {})}
    >
      <span className="hp-name">
        {name}
        {impaired && !dead ? '（ひるみ）' : ''}
      </span>
      <span className={barClass}>
        <span className={`hp-fill${enemy ? ' enemy' : ''}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="hp-num">
        {Math.ceil(hp)}/{maxHp}
      </span>
      <StatusBadges statuses={statuses} />
      {tappable && (
        <span className={`edit-cue${ready ? ' ready' : ''}`} aria-hidden="true">
          {ready ? '✓' : '⚙'}
        </span>
      )}
    </Tag>
  )
}

/**
 * 膜メーター（04b §4b.2）：初回崩壊後にのみ表示（第1幕は数値を一切見せない）。
 * 「あと何回で崩壊するか」を目盛りで常時示す。
 */
function InstabilityMeter({ count }: { count: number }) {
  const remaining = remainingMisfires(count)
  const danger = remaining <= 2
  return (
    <div className={`instability-meter${danger ? ' danger' : ''}`}>
      <span className="hud-label">膜</span>
      <span className="meter-cells">
        {Array.from({ length: INSTABILITY.misfireLimit }, (_, i) => (
          <span key={i} className={`meter-cell${i < count ? ' worn' : ''}`} />
        ))}
      </span>
      <span className="meter-remaining">あと {remaining} 回で崩壊</span>
    </div>
  )
}

type Props =
  | {
      side: 'ally'
      allies: Ally[]
      activeAllyId?: string | null
      /** 膜の摩耗（04b）。visible=初回崩壊後のみメーターを出す（第1幕は隠蔽） */
      instability?: { count: number; visible: boolean }
      /** 味方行のタップで関数編集へ（#48）。未指定なら非タップ。 */
      onSelectAlly?: (id: string) => void
      impairedIds?: string[]
      /** このターンで術式を設定/変更した味方ID（#49：準備状況✓） */
      touchedIds?: string[]
    }
  | { side: 'enemy'; enemies: Enemy[] }

/**
 * 陣営ステータス。敵＝盤面隅の小ウィジェット（enemy 側）、味方＝下部ステータス窓の中身（ally 側・
 * DESIGN.md §5「ステータス窓」）。外枠の rwin はそれぞれの呼び出し側（App.tsx）が用意する。
 */
export default function Hud(props: Props) {
  if (props.side === 'enemy') {
    return (
      <div className="hud-side panel rwin rwin-flat enemy">
        <div className="hud-label">敵陣営</div>
        {props.enemies.map((e) => (
          <HpRow key={e.id} name={e.name} hp={e.hp} maxHp={e.maxHp} enemy statuses={e.statuses} />
        ))}
      </div>
    )
  }
  const { allies, activeAllyId, instability, onSelectAlly, impairedIds = [], touchedIds = [] } = props
  // ステータス窓（DESIGN.md §5・UI設計仕様書 §2）：grid 5列（✓/名前/HPバー/状態/数値）。
  return (
    <div className="status-win">
      {allies.map((a) => {
        const ready = touchedIds.includes(a.id)
        const dead = a.hp <= 0
        const impaired = impairedIds.includes(a.id)
        const pct = Math.max(0, Math.min(100, (a.hp / a.maxHp) * 100))
        const hasFlinch = a.statuses.some((s) => s.kind === 'flinch')
        const hasBurn = a.statuses.some((s) => s.kind === 'burn')
        const tappable = !!onSelectAlly && !dead
        const Tag = tappable ? 'button' : 'div'
        return (
          <Tag
            key={a.id}
            className={`status-row${a.id === activeAllyId ? ' active' : ''}${dead ? ' dead' : ''}${tappable ? ' tappable' : ''}`}
            onClick={tappable ? () => onSelectAlly!(a.id) : undefined}
            {...(tappable ? { type: 'button' as const } : {})}
          >
            <span className={`status-check${ready ? ' ready' : ' unset'}`} aria-hidden="true">
              {ready ? '◎' : '・'}
            </span>
            <span className="nm">
              {a.name}
              {impaired && !dead ? '（ひるみ）' : ''}
            </span>
            <span className={`hp-bar${hasFlinch ? ' flinch' : ''}${hasBurn ? ' burn' : ''}`}>
              <span className="hp-fill" style={{ width: `${pct}%` }} />
            </span>
            <StatusBadges statuses={a.statuses} />
            <span className="status-num">
              {Math.ceil(a.hp)}/{a.maxHp}
            </span>
          </Tag>
        )
      })}
      {instability?.visible && <InstabilityMeter count={instability.count} />}
    </div>
  )
}
