import { useEffect, useRef } from 'react'
import type { LogEntry } from '../game/types'

// 種別ごとの目印（色分けだけでなく形でも一読で区別できるように）
const ICONS: Record<LogEntry['kind'], string> = {
  info: '・',
  turn: '▶',
  playerHit: '◆',
  enemyHit: '◆',
  misfire: '✕',
  parry: '⇄',
  shield: '⛊',
  orbit: '◎',
  obstacle: '■',
  status: '◇',
  miss: '·',
}

interface Props {
  log: LogEntry[]
  /** 盤面右上のタブから開閉するパネル（DESIGN.md §5「戦闘ログ」・全フェーズ常設）。 */
  collapsed?: boolean
  onToggle?: () => void
}

/** 戦闘ログ：盤面右上の log-tab（畳み時はタブのみ）＋開くと log-panel（DESIGN.md §5）。 */
export default function BattleLog({ log, collapsed = false, onToggle }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [log, collapsed])
  // 直近のログを表示（多すぎる場合は末尾30件）
  const recent = log.slice(-30)
  return (
    <>
      <button
        className="log-tab"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? '戦闘ログを開く' : '戦闘ログを畳む'}
      >
        戦闘ログ {collapsed ? '▾' : '▴'}
      </button>
      {!collapsed && (
        <div className="rwin log-panel open">
          <div className="log" ref={ref}>
            {recent.map((e, i) => (
              <div key={i} className={`log-line entry ${e.kind}`}>
                <span className="entry-icon" aria-hidden="true">
                  {ICONS[e.kind]}
                </span>
                {e.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
