// タイトル・物語・結果の全画面コンポーネント。
import { TITLE_TEXT } from '../data/story'

export function TitleScreen({ onStart, onGuide }: { onStart: () => void; onGuide: () => void }) {
  return (
    <main className="screen-center title-screen">
      <div className="title-emblem rwin rwin-flat" aria-hidden="true">
        <svg viewBox="0 0 180 180" role="presentation">
          <circle className="emblem-orbit" cx="90" cy="90" r="62" />
          <path className="emblem-axis" d="M24 90h132M90 24v132" />
          <path className="emblem-light" d="M26 116C52 116 56 52 89 52s38 64 65 64" />
          <path className="emblem-dark" d="M26 70c24 0 34 42 61 42s39-42 67-42" />
          <rect className="emblem-origin" x="85" y="85" width="10" height="10" />
        </svg>
        <div className="emblem-formula">z = f(x, y)</div>
      </div>

      <div className="title-content">
        <div className="title-kicker">FUNCTION BATTLE RPG</div>
        <h1 className="title-main">{TITLE_TEXT.title}</h1>
        <div className="title-sub">{TITLE_TEXT.subtitle}</div>
        <p className="title-lead">{TITLE_TEXT.lead}</p>
        <p className="title-pitch">
          敵の術式を読み、関数を描き、3人の魔導士で同時に撃ち返す。数式がそのまま軌道と属性になる、約15分の冒険。
        </p>
        <div className="title-loop" aria-label="ゲームの流れ">
          <span>敵の式を読む</span><i aria-hidden="true">▸</i><span>関数を描く</span><i aria-hidden="true">▸</i><span>同時発射</span>
        </div>
        <div className="center-actions">
          <button className="btn primary" onClick={onStart}>
            魔導書をひらく
          </button>
          <button className="btn" onClick={onGuide}>
            先に遊び方を見る
          </button>
        </div>
        <div className="hint title-device-note">PC・スマホ対応 ／ ブラウザだけで遊べます</div>
      </div>
    </main>
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
  time,
}: {
  title: string
  lines: string[]
  actions: { label: string; onClick: () => void; primary?: boolean }[]
  time?: { label: string; value: string }
}) {
  return (
    <div className="screen-center">
      <h2>{title}</h2>
      {time && (
        <div className="clear-time">
          {time.label}: <span className="time-value">{time.value}</span>
        </div>
      )}
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
