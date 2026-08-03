// 画面最上段のレール（DC プロトタイプ v3 の TOP RAIL）。
// 左＝いまの間、中央＝間の進行ドット、右＝ターン数と味方／敵の合計 HP メーター（＋膜メーター）。
import type { Ally, Enemy } from '../game/types'
import { INSTABILITY } from '../data/constants'
import { remainingMisfires } from '../game/misfireInstability'

interface Props {
  stageLabel: string
  boss?: boolean
  /** 進行ドットに出す間の名前（順番） */
  rooms: string[]
  /** いまの間（rooms のインデックス）。練習部屋などで範囲外なら -1 */
  roomIndex: number
  /** 練習部屋（試しの間）／エディタのテストプレイ中 */
  sideRoomLabel?: string
  turn: number
  allies: Ally[]
  enemies: Enemy[]
  /** 膜の摩耗（04b）。visible=初回崩壊後のみメーターを出す（第1幕は隠蔽） */
  instability: { count: number; visible: boolean }
  menu: React.ReactNode
}

function Meter({ label, now, max, hue }: { label: string; now: number; max: number; hue: 'ally' | 'enemy' }) {
  const ratio = Math.max(0, now) / Math.max(1, max)
  const tone = ratio < 0.25 ? 'low' : ratio < 0.5 ? 'mid' : hue
  return (
    <div className="rail-meter">
      <div className="rail-meter-head">
        <span className="rail-meter-label">{label}</span>
        <span className={`rail-meter-now tone-${tone}`}>{Math.round(now)}</span>
        <span className="rail-meter-max">/{Math.round(max)}</span>
      </div>
      <div className={`rail-meter-bar tone-${tone}${ratio < 0.25 && ratio > 0 ? ' warn' : ''}`}>
        <span className="fill" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}

export default function TopRail(props: Props) {
  const { allies, enemies, instability } = props
  const allyNow = allies.reduce((s, a) => s + Math.max(0, a.hp), 0)
  const allyMax = allies.reduce((s, a) => s + a.maxHp, 0)
  const enemyNow = enemies.reduce((s, e) => s + Math.max(0, e.hp), 0)
  const enemyMax = enemies.reduce((s, e) => s + e.maxHp, 0)
  const remaining = remainingMisfires(instability.count)

  return (
    <div className="top-rail">
      <div className="rail-stage">
        <span className="rail-mark" aria-hidden="true" />
        <span className="rail-stage-text">
          <span className="rail-stage-name">
            {props.sideRoomLabel && <span className="boss-tag">{props.sideRoomLabel}</span>}
            {props.stageLabel}
            {props.boss && <span className="boss-tag">BOSS</span>}
          </span>
          <span className="rail-subtitle">GRIMOIRE GRAPH — 関数魔導書</span>
        </span>
      </div>

      {/* 間の進行（表示のみ。移動は「間を選ぶ」画面から） */}
      <ol className="rail-rooms" aria-label="間の進行">
        {props.rooms.map((name, i) => (
          <li key={name} className={`rail-room${i === props.roomIndex ? ' current' : ''}`} title={name}>
            <span className="room-diamond" aria-hidden="true" />
            <span className="room-index">{i + 1}</span>
          </li>
        ))}
      </ol>

      <div className="rail-status">
        <div className="rail-turn">
          ターン <b>{props.turn}</b>
        </div>
        <Meter label="味方" now={allyNow} max={allyMax} hue="ally" />
        <Meter label="敵" now={enemyNow} max={enemyMax} hue="enemy" />
        {instability.visible && (
          <div className={`rail-instability${remaining <= 2 ? ' danger' : ''}`}>
            <span className="rail-meter-label">膜</span>
            <span className="meter-cells">
              {Array.from({ length: INSTABILITY.misfireLimit }, (_, i) => (
                <span key={i} className={`meter-cell${i < instability.count ? ' worn' : ''}`} />
              ))}
            </span>
            <span className="meter-remaining">あと {remaining}</span>
          </div>
        )}
        {props.menu}
      </div>
    </div>
  )
}
