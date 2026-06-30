import type { Ally, Enemy, StatusEffect } from '../game/types'

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

interface Props {
  allies: Ally[]
  enemies: Enemy[]
  activeAllyId?: string | null
  /** 味方行のタップで関数編集へ（#48）。未指定なら非タップ。 */
  onSelectAlly?: (id: string) => void
  impairedIds?: string[]
  /** このターンで術式を設定/変更した味方ID（#49：準備状況✓） */
  touchedIds?: string[]
}

export default function Hud({
  allies,
  enemies,
  activeAllyId,
  onSelectAlly,
  impairedIds = [],
  touchedIds = [],
}: Props) {
  return (
    <div className="hud panel">
      <div className="hud-col">
        <div className="hud-label">自陣営{onSelectAlly ? '（タップで関数編集）' : ''}</div>
        {allies.map((a) => (
          <HpRow
            key={a.id}
            name={a.name}
            hp={a.hp}
            maxHp={a.maxHp}
            active={a.id === activeAllyId}
            statuses={a.statuses}
            impaired={impairedIds.includes(a.id)}
            ready={touchedIds.includes(a.id)}
            onSelect={onSelectAlly ? () => onSelectAlly(a.id) : undefined}
          />
        ))}
      </div>
      <div className="hud-col">
        <div className="hud-label">敵陣営</div>
        {enemies.map((e) => (
          <HpRow key={e.id} name={e.name} hp={e.hp} maxHp={e.maxHp} enemy statuses={e.statuses} />
        ))}
      </div>
    </div>
  )
}
