// コマンド窓（DESIGN.md §5・UI設計仕様書 §2）：縦リスト＋▶カーソル。スマホは横3ボタン（CSS側で切替）。
interface Props {
  showOmakase: boolean
  onOmakase: () => void
  showComposer: boolean
  onOpenComposer: () => void
  fireLabel: string
  fireDanger: boolean
  onFire: () => void
}

export default function CommandWindow({
  showOmakase,
  onOmakase,
  showComposer,
  onOpenComposer,
  fireLabel,
  fireDanger,
  onFire,
}: Props) {
  return (
    <div className="cmd-win">
      {showOmakase && (
        <button type="button" className="cmd-item" onClick={onOmakase}>
          <span className="cmd-cursor" aria-hidden="true">▶</span>
          <span className="cmd-icon" aria-hidden="true">◆</span>
          おまかせ
        </button>
      )}
      {showComposer && (
        <button type="button" className="cmd-item" onClick={onOpenComposer}>
          <span className="cmd-cursor" aria-hidden="true">▶</span>
          <span className="cmd-icon" aria-hidden="true">✎</span>
          術式を組む
        </button>
      )}
      <button type="button" className={`cmd-item${fireDanger ? ' danger' : ''}`} onClick={onFire}>
        <span className="cmd-cursor" aria-hidden="true">▶</span>
        <span className="cmd-icon" aria-hidden="true">◎</span>
        {fireLabel}
      </button>
    </div>
  )
}
