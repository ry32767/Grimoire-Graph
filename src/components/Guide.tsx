// 手引き（チュートリアル）。DC プロトタイプ v3 の 8 枚の図解をそのまま canvas 図版として持ち込む。
// 図はアニメーションする（弾が飛ぶ・結界が回る・壁が削れる）ので、文章より先に挙動が伝わる。
import { useEffect, useRef, useState } from 'react'
import { TUTORIAL_PAGES, drawTutorialFigure } from '../render/tutorialFigures'

const FIG_W = 560
const FIG_H = 236

function Figure({ index }: { index: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let raf = 0
    const t0 = performance.now()
    const loop = (now: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, FIG_W, FIG_H)
      drawTutorialFigure(ctx, index, FIG_W, FIG_H, (now - t0) / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [index])
  return (
    <div className="guide-figure">
      <canvas ref={ref} width={FIG_W} height={FIG_H} aria-label={TUTORIAL_PAGES[index].title} />
    </div>
  )
}

export default function Guide({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0)
  const p = TUTORIAL_PAGES[page]
  const last = TUTORIAL_PAGES.length - 1
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guide rwin" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>手引き</h2>
          <span className="hint">
            {page + 1} / {TUTORIAL_PAGES.length}
          </span>
          <button className="btn small" onClick={onClose}>
            閉じる
          </button>
        </div>
        <Figure index={page} />
        <h3 className="guide-title">{p.title}</h3>
        <div className="guide-body">
          <p>{p.body}</p>
        </div>
        <div className="guide-nav">
          <button className="btn small" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
            ◂ 戻る
          </button>
          <span className="guide-dots">
            {TUTORIAL_PAGES.map((t, i) => (
              <button
                key={t.title}
                type="button"
                className={`guide-dot${i === page ? ' on' : ''}`}
                aria-label={`${i + 1} ページ目へ`}
                onClick={() => setPage(i)}
              />
            ))}
          </span>
          {page < last ? (
            <button className="btn small primary" onClick={() => setPage((n) => n + 1)}>
              次へ ▸
            </button>
          ) : (
            <button className="btn small primary" onClick={onClose}>
              はじめる ▸
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
