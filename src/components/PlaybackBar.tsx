// プレイバック（見返し）バー。解決済みのターンを選んで、経路・命中・結界の削れを
// スクラブしながら見返す（DC プロトタイプ v3 の playbar）。ゲーム進行には影響しない。
interface Props {
  /** 見返せるターン番号（古い順） */
  turns: number[]
  currentTurn: number
  onSelectTurn: (turn: number) => void
  posMs: number
  totalMs: number
  paused: boolean
  rate: number
  onTogglePlay: () => void
  onSeek: (ms: number) => void
  onStep: (deltaMs: number) => void
  onCycleRate: () => void
  onClose: () => void
}

export default function PlaybackBar(props: Props) {
  const { posMs, totalMs } = props
  return (
    <div className="playbar rwin rwin-flat" aria-label="プレイバック">
      <div className="playbar-turns">
        <span className="playbar-label">見返し</span>
        {/* 見返せるのは直近1ターンだけなので、選択肢が1つのときはボタン列を出さない（#69） */}
        {props.turns.length > 1 ? (
          props.turns.map((t) => (
            <button
              key={t}
              type="button"
              className={`btn small${t === props.currentTurn ? ' selected' : ''}`}
              onClick={() => props.onSelectTurn(t)}
            >
              T{t}
            </button>
          ))
        ) : (
          <span className="playbar-turn-now">T{props.currentTurn}</span>
        )}
      </div>
      <div className="playbar-transport">
        <button type="button" className="btn small play" onClick={props.onTogglePlay} aria-label={props.paused ? '再生' : '一時停止'}>
          {props.paused ? '▶' : '❚❚'}
        </button>
        <button type="button" className="btn small" onClick={() => props.onStep(-120)} aria-label="少し戻す">
          ◂
        </button>
        <button type="button" className="btn small" onClick={() => props.onStep(120)} aria-label="少し進める">
          ▸
        </button>
        <input
          className="playbar-seek"
          type="range"
          min={0}
          max={Math.max(1, Math.round(totalMs))}
          step={1}
          value={Math.round(posMs)}
          onChange={(e) => props.onSeek(Number(e.target.value))}
          aria-label="再生位置"
        />
        <span className="playbar-clock">
          {(posMs / 1000).toFixed(1)} / {(totalMs / 1000).toFixed(1)}s
        </span>
        <button type="button" className="btn small" onClick={props.onCycleRate} aria-label="再生速度">
          ×{props.rate}
        </button>
        <button type="button" className="btn small" onClick={props.onClose} aria-label="見返しを閉じる">
          ✕
        </button>
      </div>
    </div>
  )
}
