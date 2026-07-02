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
  // 状態異常でバーの形を変える（#24）：ひるみ＝ギザギザ、継続ダメージ＝炎の波形
  const hasFlinch = statuses.some((s) => s.kind === 'flinch')
  const hasBurn = statuses.some((s) => s.kind === 'burn')
  const barClass = `hp-bar${hasFlinch ? ' flinch' : ''}${hasBurn ? ' burn' : ''}`
  return (
    <div className={`hp-row${active ? ' active' : ''}${dead ? ' dead' : ''}`}>
      <span className="hp-name">{name}</span>
      <span className={barClass}>
        <span className={`hp-fill${enemy ? ' enemy' : ''}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="hp-num">
        {Math.ceil(hp)}/{maxHp}
      </span>
      <StatusBadges statuses={statuses} />
    </div>
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

interface Props {
  allies: Ally[]
  enemies: Enemy[]
  activeAllyId?: string | null
  /** 膜の摩耗（04b）。visible=初回崩壊後のみメーターを出す（第1幕は隠蔽） */
  instability?: { count: number; visible: boolean }
}

export default function Hud({ allies, enemies, activeAllyId, instability }: Props) {
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
        {instability?.visible && <InstabilityMeter count={instability.count} />}
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
