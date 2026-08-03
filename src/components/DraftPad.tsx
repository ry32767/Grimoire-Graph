// 作図台（DC プロトタイプ v3 の「作図台 — 式をいじる」）。
// 関数空間の方眼紙。盤面ではないので、ここで打つ点は格子点（整数）に吸着する。
// 「係数をいじる」＝式中の数値をスライダーで動かす／「点から作る」＝打った点を最小二乗で多項式にする。
import { useEffect, useRef, useState } from 'react'
import { SAMPLING } from '../data/constants'
import type { Vec2 } from '../game/types'
import { parseExpression } from '../game/functions'
import { type ComposerState, setCoeffPatch, yTextOf, yTextPatch, zTextPatch } from './composer'
import { formatPoly, polyFit } from './polyFit'

interface Props {
  composer: ComposerState
  onChange: (next: Partial<ComposerState>) => void
  /** 射線上の的までの距離 r（縦の破線） */
  rDistance: number
  /** いま編集しているのは y か z か */
  focus: 'y' | 'z'
  onClose: () => void
}

const W = 520
const H = 216
const TMAX = SAMPLING.rotateXMax
const Y_RANGE = 12

const geo = () => ({ ox: 22, oy: H / 2, sx: (W - 34) / TMAX, sy: (H - 26) / (Y_RANGE * 2) })

export default function DraftPad({ composer: c, onChange, rDistance, focus, onClose }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'coef' | 'pts'>('coef')
  const [deg, setDeg] = useState(2)
  const [pts, setPts] = useState<Vec2[]>([])

  const onZ = focus === 'z'
  const barrier = !onZ && c.mode === 'polar'
  const source = onZ ? c.zText : c.yText
  const fitted = pts.length >= 2 ? polyFit(pts, deg) : null
  const fittedExpr = fitted ? (onZ ? formatPoly(fitted).replace(/x/g, 't') : formatPoly(fitted)) : '—'

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const g = geo()
    const X = (x: number) => g.ox + x * g.sx
    const Y = (y: number) => g.oy - y * g.sy
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#07070f'
    ctx.fillRect(0, 0, W, H)

    // 格子点（2 ユニットごと）
    ctx.fillStyle = 'rgba(125,143,196,.22)'
    for (let x = 0; x <= TMAX; x += 2) {
      for (let y = -Y_RANGE; y <= Y_RANGE; y += 2) ctx.fillRect(X(x) - 1, Y(y) - 1, 2, 2)
    }
    // 軸・目盛り
    ctx.strokeStyle = 'rgba(150,162,196,.45)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(X(0), Y(0))
    ctx.lineTo(X(TMAX), Y(0))
    ctx.moveTo(X(0), Y(-Y_RANGE))
    ctx.lineTo(X(0), Y(Y_RANGE))
    ctx.stroke()
    ctx.fillStyle = 'rgba(150,162,196,.6)'
    ctx.font = '9px monospace'
    ctx.textAlign = 'center'
    for (let x = 10; x <= 40; x += 10) {
      ctx.fillRect(X(x), Y(0) - 3, 1, 6)
      ctx.fillText(String(x), X(x), Y(0) + 13)
    }
    // 的までの距離 r
    if (rDistance <= TMAX) {
      ctx.strokeStyle = 'rgba(244,196,48,.45)'
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(X(rDistance), Y(-Y_RANGE))
      ctx.lineTo(X(rDistance), Y(Y_RANGE))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,243,196,.8)'
      ctx.textAlign = 'left'
      ctx.fillText('r', X(rDistance) + 3, Y(Y_RANGE - 1))
    }

    if (barrier) {
      // 結界は極座標なので、そのまま輪として描く（係数を動かすと形が変わる）
      const f = parseExpression(c.freeExpr, 't')
      const cx = W / 2
      const cy = H / 2
      if (f) {
        let rmax = 0
        let rmin = Number.POSITIVE_INFINITY
        const poly: { a: number; r: number }[] = []
        for (let i = 0; i <= 180; i++) {
          const a = (i / 180) * Math.PI * 2
          const rr = f(a)
          const v = Number.isFinite(rr) ? Math.abs(rr) : 0
          poly.push({ a, r: v })
          if (v > rmax) rmax = v
          if (v < rmin) rmin = v
        }
        if (rmax > 0.01) {
          const sc = (Math.min(W, H) * 0.4) / rmax
          ctx.strokeStyle = 'rgba(244,196,48,.95)'
          ctx.lineWidth = 2.2
          ctx.beginPath()
          poly.forEach((p, i) => {
            const px = cx + Math.cos(p.a) * p.r * sc
            const py = cy - Math.sin(p.a) * p.r * sc
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
          ctx.closePath()
          ctx.stroke()
          ctx.fillStyle = 'rgba(244,196,48,.10)'
          ctx.fill()
          ctx.fillStyle = 'rgba(255,243,196,.8)'
          ctx.textAlign = 'left'
          ctx.fillText(`半径 ${rmin.toFixed(1)}〜${rmax.toFixed(1)}`, 8, 14)
        }
      }
    } else {
      const f = parseExpression(onZ ? c.zFreeExpr : c.freeExpr, onZ ? 't' : 'x')
      if (f) {
        ctx.strokeStyle = onZ ? 'rgba(138,111,214,.95)' : 'rgba(244,196,48,.95)'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        let started = false
        for (let x = 0; x <= TMAX; x += 0.25) {
          const y = f(x)
          if (!Number.isFinite(y) || Math.abs(y) > 60) {
            started = false
            continue
          }
          const px = X(x)
          const py = Y(y)
          if (!started) {
            ctx.moveTo(px, py)
            started = true
          } else ctx.lineTo(px, py)
        }
        ctx.stroke()
      }
    }

    // フィットした曲線（点モードのみ・破線）
    if (mode === 'pts' && fitted) {
      ctx.strokeStyle = 'rgba(255,255,255,.75)'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let x = 0; x <= TMAX; x += 0.4) {
        let y = 0
        for (let i = 0; i < fitted.length; i++) y += fitted[i] * Math.pow(x, i)
        if (!Number.isFinite(y)) break
        if (x === 0) ctx.moveTo(X(0), Y(y))
        else ctx.lineTo(X(x), Y(y))
      }
      ctx.stroke()
      ctx.setLineDash([])
    }
    // 打った点
    if (mode === 'pts') {
      for (const p of pts) {
        ctx.fillStyle = '#fff3c4'
        ctx.fillRect(X(p.x) - 3.5, Y(p.y) - 3.5, 7, 7)
        ctx.fillStyle = '#0a0a12'
        ctx.fillRect(X(p.x) - 1.5, Y(p.y) - 1.5, 3, 3)
      }
    }
  }, [c.freeExpr, c.zFreeExpr, c.yText, c.zText, mode, pts, deg, rDistance, onZ, barrier, fitted])

  const onPadPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'pts') return
    const cv = ref.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    const g = geo()
    const px = ((e.clientX - rect.left) * W) / rect.width
    const py = ((e.clientY - rect.top) * H) / rect.height
    const mx = Math.round((px - g.ox) / g.sx)
    const my = Math.round((g.oy - py) / g.sy)
    if (mx < 0 || mx > TMAX || Math.abs(my) > Y_RANGE) return
    setPts((prev) => {
      const i = prev.findIndex((p) => p.x === mx && p.y === my)
      const next = i >= 0 ? prev.filter((_, k) => k !== i) : [...prev, { x: mx, y: my }]
      return next.sort((a, b) => a.x - b.x)
    })
  }

  const apply = () => {
    if (!fitted) return
    if (onZ) onChange(zTextPatch(fittedExpr))
    else onChange(yTextPatch(yTextOf(fittedExpr, c.mode)))
  }

  const canFitCoef = !onZ && c.fitParams.length > 0

  return (
    <div className="draft-pad rwin">
      <div className="draft-head">
        <span className="draft-title">作図台 — 式をいじる</span>
        <span className="hint">{pts.length} 点</span>
        <button type="button" className="btn small draft-close" onClick={onClose} aria-label="作図台を閉じる">
          ✕
        </button>
      </div>
      <div className="draft-canvas-wrap">
        <canvas ref={ref} width={W} height={H} onPointerDown={onPadPointer} aria-label="作図台" />
        <div className="draft-note">
          横軸 = 射線方向の距離 ・「点から作る」では格子点のみ（敵は格子に乗らない）
        </div>
      </div>
      <div className="draft-controls">
        <div className="draft-tabs">
          <button
            type="button"
            className={`btn small${mode === 'coef' ? ' selected' : ''}`}
            onClick={() => setMode('coef')}
          >
            係数をいじる
          </button>
          <button
            type="button"
            className={`btn small${mode === 'pts' ? ' selected' : ''}`}
            onClick={() => setMode('pts')}
          >
            点から作る
          </button>
          <span className="draft-target">
            {onZ ? 'z = ' : barrier ? 'r = ' : 'y = '}
            {source || '0'}
          </span>
        </div>
        {mode === 'coef' && (
          <div className="coef-row">
            {canFitCoef ? (
              c.fitParams.map((p) => (
                <div className="coef-ctrl" key={p.key}>
                  <span className="coef-label">{p.label}</span>
                  <span className="coef-val">{(c.fitValues[p.key] ?? p.value).toFixed(2)}</span>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={c.fitValues[p.key] ?? p.value}
                    onChange={(e) => onChange(setCoeffPatch(c, p.key, Number(e.target.value)))}
                    aria-label={`係数 ${p.label}`}
                  />
                </div>
              ))
            ) : (
              <span className="hint">
                {onZ ? 'z は「z 整形」のスライダーで動かす。' : '式に数値が無いと係数スライダーは出ない。'}
              </span>
            )}
          </div>
        )}
        {mode === 'pts' && (
          <div className="draft-pts-row">
            <span className="hint">次数</span>
            {[1, 2, 3].map((d) => (
              <button
                key={d}
                type="button"
                className={`btn small${deg === d ? ' selected' : ''}`}
                onClick={() => setDeg(d)}
              >
                {d}次
              </button>
            ))}
            <span className="draft-expr">{fittedExpr}</span>
            <button type="button" className="btn small danger" onClick={() => setPts([])}>
              消す
            </button>
            <button type="button" className="btn small primary" disabled={!fitted} onClick={apply}>
              式にする ▸
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
