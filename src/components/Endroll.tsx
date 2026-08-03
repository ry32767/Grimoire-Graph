// エンドロール画面（DC プロトタイプ v3）。背後で本物の敵AI同士が延々と撃ち合い、
// 手前にクリアタイム・総ターン数・締めの一文を重ねる。
import { useEffect, useRef } from 'react'
import { createEndroll, drawEndroll } from '../render/endroll'

interface Props {
  /** クリアタイム（mm:ss に整形済み） */
  time: string
  /** 総ターン数 */
  turns: number
  onBack: () => void
}

export default function Endroll({ time, turns, onBack }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const state = createEndroll(performance.now())
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
      try {
        drawEndroll(ctx, state, w, h, now)
      } catch {
        /* 演出だけなので、描画が失敗してもゲームは止めない */
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="endroll">
      <canvas ref={ref} aria-label="エンドロール（術者たちの果てしない撃ち合い）" />
      <div className="endroll-overlay">
        <div>
          <div className="endroll-kicker">ALL STAGES CLEARED</div>
          <div className="endroll-title">GRIMOIRE GRAPH</div>
        </div>
        <div className="endroll-stats">
          <div>
            <div className="k">CLEAR TIME</div>
            <div className="v light">{time}</div>
          </div>
          <div className="endroll-sep" />
          <div>
            <div className="k">TOTAL TURNS</div>
            <div className="v dark">{turns}</div>
          </div>
        </div>
        <p className="endroll-note">式は最後まで君の手にあった。膜は保たれ、五つの間は静まっている。</p>
        <button className="btn primary endroll-back" onClick={onBack}>
          タイトルへ ▸
        </button>
      </div>
    </div>
  )
}
