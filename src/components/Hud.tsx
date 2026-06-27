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
}: {
  name: string
  hp: number
  maxHp: number
  enemy?: boolean
  active?: boolean
  statuses: StatusEffect[]
}) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100))
  const dead = hp <= 0
  return (
    <div className={`hp-row${active ? ' active' : ''}${dead ? ' dead' : ''}`}>
      <span className="hp-name">{name}</span>
      <span className="hp-bar">
        <span className={`hp-fill${enemy ? ' enemy' : ''}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="hp-num">
        {Math.ceil(hp)}/{maxHp}
      </span>
      <StatusBadges statuses={statuses} />
    </div>
  )
}

interface Props {
  allies: Ally[]
  enemies: Enemy[]
  activeAllyId?: string | null
}

export default function Hud({ allies, enemies, activeAllyId }: Props) {
  return (
    <div className="hud panel">
      <div className="hud-col">
        <div className="hud-label">自陣営</div>
        {allies.map((a) => (
          <HpRow
            key={a.id}
            name={a.name}
            hp={a.hp}
            maxHp={a.maxHp}
            active={a.id === activeAllyId}
            statuses={a.statuses}
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
