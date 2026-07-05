// BattleCanvas の描画を壊さないオーバーレイ（#67 §4.2/§4.3）：選択中の障害物のハイライトと
// 重なり警告を SVG で重ねて描く。draw.ts/BattleCanvas のキャンバス描画には一切手を加えない。
import type { Viewport } from '../game/coords'
import { scaleOf, toScreen } from '../game/coords'
import type { CompiledOp } from './model'
import type { OverlapMark } from './overlap'

interface Props {
  compiled: CompiledOp[]
  selectedOpId: string | null
  overlaps: OverlapMark[]
  rField: number
  /** SVG の内部解像度（BattleCanvas の内部解像度＝520と合わせる）。 */
  internal: number
}

/** 選択中 op・重なり警告を薄いオーバーレイとして描く（pointer-events:none でクリックは下のキャンバスへ通す）。 */
export default function ObstacleOverlay({ compiled, selectedOpId, overlaps, rField, internal }: Props) {
  const vp: Viewport = { width: internal, height: internal, unitsRadius: rField }
  const s = scaleOf(vp)
  const selected = compiled.find((c) => c.opId === selectedOpId)

  return (
    <svg
      className="stage-editor-overlay"
      viewBox={`0 0 ${internal} ${internal}`}
      width={internal}
      height={internal}
      style={{ pointerEvents: 'none' }}
    >
      {overlaps.map((m, i) => {
        const p = toScreen({ x: m.x, y: m.y }, vp)
        return <circle key={i} cx={p.x} cy={p.y} r={Math.max(m.r * s, 4)} className="overlap-mark" />
      })}
      {selected?.obstacles.map((o) => (
        <g key={o.id} className="selection-mark">
          {o.solids.map((d, i) => {
            const p = toScreen({ x: d.x, y: d.y }, vp)
            return <circle key={i} cx={p.x} cy={p.y} r={d.r * s} />
          })}
          {(o.rects ?? []).map((r, i) => {
            const p1 = toScreen({ x: r.x, y: r.y + r.h }, vp)
            const p2 = toScreen({ x: r.x + r.w, y: r.y }, vp)
            return <rect key={i} x={p1.x} y={p1.y} width={p2.x - p1.x} height={p2.y - p1.y} />
          })}
        </g>
      ))}
    </svg>
  )
}
