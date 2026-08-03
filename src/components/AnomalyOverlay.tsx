// 膜の摩耗の異常演出を画面全体へ重ねる（DC プロトタイプ v3 の #gm-anom）。
// 残り回数は数字で見せず、赤み・降る塵・亀裂・一瞬のバグりだけで危うさを伝える。
import { useEffect, useRef } from 'react'
import {
  anomalyStage,
  anomalyTint,
  createAnomalyState,
  drawAnomaly,
  type AnomalyLevel,
} from '../render/anomaly'

/** 膜の摩耗（instability）。live が false（物語・結果画面など）の間は止める。 */
export default function AnomalyOverlay({ instability, live }: { instability: number; live: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const level: AnomalyLevel = anomalyStage(instability)
  const levelRef = useRef(level)
  levelRef.current = level
  const liveRef = useRef(live)
  liveRef.current = live

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const state = createAnomalyState()
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
      drawAnomaly(ctx, state, w, h, liveRef.current ? levelRef.current : 1, now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      <div className="anomaly-tint" style={live ? anomalyTint(level) : { display: 'none' }} aria-hidden="true" />
      <canvas ref={ref} className="anomaly-canvas" aria-hidden="true" />
    </>
  )
}
