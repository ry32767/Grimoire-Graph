// タイトル・物語・結果の全画面コンポーネント。
import { useEffect, useRef } from 'react'
import { TITLE_TEXT } from '../data/story'
import { drawTitleScene } from '../render/titleScreen'
import { TUTORIAL_PAGES } from '../render/tutorialFigures'

/** タイトル背景：式から絵が出ていることを、そのまま動かして見せる（DC プロトタイプ v3）。 */
function TitleBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let raf = 0
    const loop = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth
      const h = cv.clientHeight
      const pw = Math.round(w * dpr)
      const ph = Math.round(h * dpr)
      if (cv.width !== pw || cv.height !== ph) {
        cv.width = pw
        cv.height = ph
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawTitleScene(ctx, w, h, now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="title-canvas" aria-hidden="true" />
}

export function TitleScreen({
  onStart,
  onGuide,
  onStageSelect,
}: {
  onStart: () => void
  onGuide: () => void
  onStageSelect?: () => void
}) {
  return (
    <main className="title-screen">
      <TitleBackdrop />
      <div className="title-content">
        <div className="title-kicker">f(x) · z(t) · RPG</div>
        <h1 className="title-main">
          GRIMOIRE
          <br />
          GRAPH
        </h1>
        <div className="title-rule">
          <span className="title-rule-line" aria-hidden="true" />
          <span className="title-sub">FUNCTION SPELLCRAFT · TURN-BASED</span>
        </div>
        <p className="title-lead">
          式を書いて撃つ。<span className="el-light">y = f(x)</span> が弾の道、
          <span className="el-dark">z = g(t)</span> が纏う属性。
          <br />
          属性場は完全に読める。当たるかどうかは、撃つまで分からない。
        </p>
        <div className="title-actions">
          <button className="title-cta" onClick={onStart}>
            <span className="cta-label">詠唱を始める</span>
            <span className="cta-arrow">▸▸</span>
          </button>
          <button className="title-sub-cta" onClick={onGuide}>
            <span>はじめての人へ</span>
            <span className="hint">図解 {TUTORIAL_PAGES.length} 枚</span>
          </button>
          {onStageSelect && (
            <button className="title-sub-cta" onClick={onStageSelect}>
              <span>間を選ぶ／試しの間</span>
              <span className="hint">練習・エンドロール</span>
            </button>
          )}
        </div>
        <div className="hint title-device-note">{TITLE_TEXT.subtitle} ／ PC・スマホ対応</div>
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

/**
 * ターン結果パネル（DC プロトタイプ v3 の showResult）。解決アニメの直後に一度だけ挟み、
 * 「このターンで何が起きたか」を 1 行に畳んで見せる。どこを押しても閉じる。
 */
export function TurnResultOverlay({
  turn,
  title,
  lines,
  onDismiss,
}: {
  turn: number
  title: string
  lines: string[]
  onDismiss: () => void
}) {
  return (
    <div className="turn-result-backdrop" onClick={onDismiss} role="presentation">
      <div className="turn-result" onClick={(e) => e.stopPropagation()}>
        <div className="turn-result-kicker">TURN {turn} 解決</div>
        <div className="turn-result-title">{title}</div>
        <div className="turn-result-sub">
          {lines.length > 0 ? lines.map((l, i) => <span key={i}>{l}</span>) : <span>見返しスライダーで追える</span>}
        </div>
        <button className="btn primary" onClick={onDismiss}>
          つづける ▸
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
