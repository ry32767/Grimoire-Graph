import { useEffect, useRef } from 'react'
import { ROTATE_PRESETS, POLAR_PRESETS, defaultCoeffs, buildTrajectory, type Preset } from '../game/functions'
import { sampleTrajectory, validPrefix } from '../game/coords'
import { COLORS } from '../render/theme'

const W = 230
const H = 110

/** プリセットの既定曲線を自動フィットで描く小プレビュー。 */
function CurvePreview({ preset }: { preset: Preset }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, W, H)
    const traj = buildTrajectory(preset, defaultCoeffs(preset), 0)
    const pts = validPrefix(sampleTrajectory(traj)).map((s) => s.pos)
    if (pts.length < 2) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    minX = Math.min(minX, 0); maxX = Math.max(maxX, 0)
    minY = Math.min(minY, 0); maxY = Math.max(maxY, 0)
    const pad = 12
    const sx = (W - pad * 2) / (maxX - minX || 1)
    const sy = (H - pad * 2) / (maxY - minY || 1)
    const s = Math.min(sx, sy)
    const map = (p: { x: number; y: number }) => ({
      x: pad + (p.x - minX) * s,
      y: H - pad - (p.y - minY) * s,
    })
    // 原点
    const o = map({ x: 0, y: 0 })
    ctx.fillStyle = COLORS.caster
    ctx.beginPath()
    ctx.arc(o.x, o.y, 3, 0, Math.PI * 2)
    ctx.fill()
    // 曲線
    ctx.strokeStyle = COLORS.light1
    ctx.lineWidth = 2
    ctx.beginPath()
    const p0 = map(pts[0])
    ctx.moveTo(p0.x, p0.y)
    for (const p of pts.slice(1)) {
      const m = map(p)
      ctx.lineTo(m.x, m.y)
    }
    ctx.stroke()
  }, [preset])
  return <canvas ref={ref} width={W} height={H} />
}

function Card({ preset, active }: { preset: Preset; active: boolean }) {
  return (
    <div className={`codex-card${active ? ' active' : ''}`}>
      <div>
        <strong>{preset.name}</strong> <span className="formula">{preset.formula}</span>
      </div>
      <CurvePreview preset={preset} />
      <div className="desc">{preset.description}</div>
    </div>
  )
}

interface Props {
  activePresetId?: string
  onClose: () => void
}

export default function Codex({ activePresetId, onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>関数図鑑（古代式一覧）</h2>
          <button className="btn small" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="section-title">A. 回転 y=g(x)（狙う角度θで回転）</div>
        <div className="codex-grid">
          {ROTATE_PRESETS.map((p) => (
            <Card key={p.id} preset={p} active={p.id === activePresetId} />
          ))}
        </div>
        <div className="section-title">B. 極座標 r=f(θ)（全方向）</div>
        <div className="codex-grid">
          {POLAR_PRESETS.map((p) => (
            <Card key={p.id} preset={p} active={p.id === activePresetId} />
          ))}
        </div>
      </div>
    </div>
  )
}
