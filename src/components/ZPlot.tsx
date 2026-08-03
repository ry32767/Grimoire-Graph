// 右レールの z(t) 断面プロット。属性場は「撃つ前に完全に読める」情報なので常時出す。
import { useEffect, useRef } from 'react'
import { drawZPlot, type ZPlotInput } from '../render/zplot'

const W = 252
const H = 118

export default function ZPlot(props: ZPlotInput) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { zAt, rDistance, pole } = props
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    drawZPlot(ctx, W, H, { zAt, rDistance, pole })
  }, [zAt, rDistance, pole])
  return (
    <div className="zplot rwin rwin-flat">
      <div className="zplot-head">
        <span className="zplot-title">z(t)</span>
        <span className="hint">属性場の断面</span>
        <span className="zplot-legend light">▲光</span>
        <span className="zplot-legend dark">▼闇</span>
      </div>
      <canvas ref={ref} width={W} height={H} aria-label="属性場 z(t) の断面" />
    </div>
  )
}
