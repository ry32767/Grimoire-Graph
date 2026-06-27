import { useEffect, useRef } from 'react'
import type { LogEntry } from '../game/types'

export default function BattleLog({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [log])
  // 直近のログを表示（多すぎる場合は末尾30件）
  const recent = log.slice(-30)
  return (
    <div className="panel">
      <div className="section-title">戦闘ログ</div>
      <div className="log" ref={ref}>
        {recent.map((e, i) => (
          <div key={i} className={`entry ${e.kind}`}>
            {e.text}
          </div>
        ))}
      </div>
    </div>
  )
}
