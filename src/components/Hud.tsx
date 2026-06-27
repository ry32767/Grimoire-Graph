import type { Enemy, PlayerState, StatusEffect } from '../game/types'

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
  statuses,
}: {
  name: string
  hp: number
  maxHp: number
  enemy?: boolean
  statuses: StatusEffect[]
}) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100))
  return (
    <div className="hp-row">
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
  player: PlayerState
  enemies: Enemy[]
}

export default function Hud({ player, enemies }: Props) {
  return (
    <div className="hud panel">
      <HpRow name="術者（あなた）" hp={player.hp} maxHp={player.maxHp} statuses={player.statuses} />
      {enemies.map((e) => (
        <HpRow key={e.id} name={e.name} hp={e.hp} maxHp={e.maxHp} enemy statuses={e.statuses} />
      ))}
      {player.shield && (
        <div className="hp-row">
          <span className="hp-name">結界</span>
          <span className="hp-bar">
            <span
              className="hp-fill"
              style={{
                width: `${Math.max(0, (player.shield.durability / player.shield.maxDurability) * 100)}%`,
                background: 'linear-gradient(180deg,#8ab0ff,#3a5aa0)',
              }}
            />
          </span>
          <span className="hp-num">{Math.ceil(player.shield.durability)}</span>
        </div>
      )}
    </div>
  )
}
