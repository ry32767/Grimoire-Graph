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
  /** 盤面の隅に重ねる半透明オーバーレイ（畳める）として表示する（#UI刷新）。 */
  collapsed?: boolean
  onToggle?: () => void
}

export default function BattleLog({ log, collapsed = false, onToggle }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [log, collapsed])
  // 直近のログを表示（多すぎる場合は末尾30件）
  const recent = log.slice(-30)
  // 畳んだときは最新1件だけ見出しに添える（何が起きたかの気配を残す）
  const last = recent[recent.length - 1]
  return (
    <div className={`log-overlay${collapsed ? ' collapsed' : ''}`}>
      <button
        className="log-head"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? '戦闘ログを開く' : '戦闘ログを畳む'}
      >
        <span>
          戦闘ログ
          {collapsed && last ? `：${last.text}` : ''}
        </span>
        <span className="log-caret" aria-hidden="true">
          {collapsed ? '▴' : '▾'}
        </span>
      </button>
      <div className="log" ref={ref}>
        {recent.map((e, i) => (
          <div key={i} className={`entry ${e.kind}`}>
            <span className="entry-icon" aria-hidden="true">
              {ICONS[e.kind]}
            </span>
            {e.text}
          </div>
        ))}
      </div>
    </div>
  )
}
