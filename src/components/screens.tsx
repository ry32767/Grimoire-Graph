// タイトル・物語・結果の全画面コンポーネント。
import { TITLE_TEXT } from '../data/story'

export function TitleScreen({ onStart, onGuide }: { onStart: () => void; onGuide: () => void }) {
  return (
    <div className="screen-center">
      <h1 className="title-main">{TITLE_TEXT.title}</h1>
      <div className="title-sub">{TITLE_TEXT.subtitle}</div>
      <p className="story-text">{TITLE_TEXT.lead}</p>
      <p className="story-text">
        関数を「描いて」魔法に変える、ターン制の関数バトル。敵の式を読んでから、こちらの式で対抗しよう。
      </p>
      <div className="center-actions">
        <button className="btn primary" onClick={onStart}>
          はじめる
        </button>
        <button className="btn" onClick={onGuide}>
          遊び方
        </button>
      </div>
      <div className="hint">推奨：デスクトップブラウザ（Chrome / Firefox / Safari 最新版）</div>
    </div>
  )
}

export function StoryScreen({
  title,
  lines,
  onNext,
  nextLabel = '次へ',
}: {
  title: string
  lines: string[]
  onNext: () => void
  nextLabel?: string
}) {
  return (
    <div className="screen-center">
      <h2>{title}</h2>
      <div className="story-text">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      <div className="center-actions">
        <button className="btn primary" onClick={onNext}>
          {nextLabel}
        </button>
      </div>
    </div>
  )
}

export function ResultScreen({
  title,
  lines,
  actions,
}: {
  title: string
  lines: string[]
  actions: { label: string; onClick: () => void; primary?: boolean }[]
}) {
  return (
    <div className="screen-center">
      <h2>{title}</h2>
      <div className="story-text">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      <div className="center-actions">
        {actions.map((a, i) => (
          <button key={i} className={`btn${a.primary ? ' primary' : ''}`} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
