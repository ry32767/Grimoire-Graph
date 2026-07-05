// 親要素にちょうど収まる正方形の一辺長を実測する（#67 §4.2：BattleCanvas と同じ大きさの
// オーバーレイ SVG を重ねるため）。ref を付けた要素の contentRect から min(幅,高さ) を追跡する。
import { useEffect, useRef, useState } from 'react'

export function useSquareFrame<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize(Math.max(0, Math.min(width, height)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, size }
}
