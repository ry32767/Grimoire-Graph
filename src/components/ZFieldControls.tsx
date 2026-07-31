import { useEffect, useState } from 'react'
import { ZFIELD_PRESETS, findZPreset, defaultZCoeffs } from '../game/zfields'
import { FIELD } from '../data/constants'
import { type ComposerState, buildZField, zParametricPatch, setZCoeffPatch } from './composer'

interface Props {
  composer: ComposerState
  onChange: (next: Partial<ComposerState>) => void
}

const GAUGE_W = 200
const GAUGE_H = 56
const GAUGE_PAD = 6
const Z_MAX = FIELD.zPeak * 1.4

/** |z|=zPeak を頂点とする山型の強度カーブ（DESIGN.md §4.4：strength(z)）。 */
function strengthAt(z: number): number {
  const dist = Math.abs(Math.abs(z) - FIELD.zPeak)
  return FIELD.sMax * Math.max(0, 1 - dist / FIELD.zPeak)
}
function toGaugeX(z: number): number {
  const t = (z + Z_MAX) / (Z_MAX * 2)
  return GAUGE_PAD + t * (GAUGE_W - GAUGE_PAD * 2)
}
/** 数式の整形表示（DESIGN.md §3）：`*` 省略・`-`→`−`・`^2`→`²`（表示専用・入力は生の式のまま）。 */
function formatExprPretty(expr: string): string {
  return expr.replace(/\*/g, '').replace(/\^2\b/g, '²').replace(/-/g, '−')
}
// z場プリセットアイコン（DESIGN.md §5・UI設計仕様書 §3：■一定 ↕縦勾配 ↔横勾配 ◎放射）
const ZFIELD_ICON: Record<string, string> = {
  const: '■',
  gradY: '↕',
  gradX: '↔',
  radial: '◎',
}
function toGaugeY(s: number): number {
  const t = s / FIELD.sMax
  return GAUGE_H - GAUGE_PAD - t * (GAUGE_H - GAUGE_PAD * 2)
}

/**
 * z強度ゲージ（シグネチャ）：山型ポリライン（|z|=zPeak で頂点）と現在値マーカー。
 * 「高いほど強いが、狙いすぎると失速する」というこのゲームの核をUIで常時可視化する（DESIGN.md §4.4）。
 */
function ZStrengthGauge({ z }: { z: number }) {
  const steps = 40
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const zz = -Z_MAX + (i / steps) * (Z_MAX * 2)
    return `${toGaugeX(zz).toFixed(1)},${toGaugeY(strengthAt(zz)).toFixed(1)}`
  }).join(' ')
  const neutral = Math.abs(z) < FIELD.epsilon
  const attrLabel = neutral ? '中立' : z > 0 ? '光' : '闇'
  const strength = strengthAt(z)
  const decelerating = Math.abs(z) > FIELD.zRef
  const markerColor = neutral ? 'var(--text-dim)' : z > 0 ? 'var(--light)' : 'var(--dark)'
  return (
    <div className="zgauge">
      <svg viewBox={`0 0 ${GAUGE_W} ${GAUGE_H}`} width="100%" height={GAUGE_H} role="img" aria-label="z強度ゲージ">
        <text x={GAUGE_PAD} y={GAUGE_H - 2} fontSize="9" fill="var(--dark)">闇</text>
        <text x={GAUGE_W - GAUGE_PAD - 10} y={GAUGE_H - 2} fontSize="9" fill="var(--light)">光</text>
        <polyline points={points} fill="none" stroke="var(--edge-lite)" strokeWidth="1.5" />
        <rect
          x={toGaugeX(z) - 3}
          y={toGaugeY(strength) - 3}
          width="6"
          height="6"
          fill={markerColor}
          stroke="var(--edge-dark)"
        />
      </svg>
      <div className="zgauge-readout">
        現在：<span className={`zval ${neutral ? '' : z > 0 ? 'light' : 'dark'}`}>{attrLabel}・強度{strength.toFixed(1)}</span>
        {decelerating && <span>（高いが失速しやすい）</span>}
      </div>
    </div>
  )
}

/**
 * 属性の z 場 z=f(x,y) の操作 UI（#54）。プリセット選択・自動係数スライダー・自由入力。
 * FunctionPanel（詳細設定）と、スマホの盤面ボトムバー（盤面で属性を調整）の両方で使い回す。
 */
export default function ZFieldControls({ composer: c, onChange }: Props) {
  const [zFreeDraft, setZFreeDraft] = useState(c.zFreeExpr)
  useEffect(() => setZFreeDraft(c.zFreeExpr), [c.zFreeExpr])
  const zPreset = findZPreset(c.zPresetId)
  const currentZ = buildZField(c)(0, 0)

  // 式中の数値を自動検出してスライダー化する（#52）
  const selectZPreset = (id: string) => {
    const p = findZPreset(id)
    if (!p) return
    const zCoeffs = defaultZCoeffs(p)
    onChange({ zPresetId: id, zCoeffs, ...zParametricPatch(p.toExpr(zCoeffs)) })
  }
  const applyZFree = () => onChange(zParametricPatch(zFreeDraft))

  return (
    <>
      <ZStrengthGauge z={currentZ} />
      <div className="form-row preset-group">
        <label className="form-label">場</label>
        <div className="preset-row">
          {ZFIELD_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.name}
              className={`preset-icon${c.zPresetId === p.id ? ' selected' : ''}`}
              onClick={() => selectZPreset(p.id)}
            >
              {ZFIELD_ICON[p.id] ?? '?'}
            </button>
          ))}
        </div>
      </div>
      <div className="preset-desc">{zPreset?.description ?? '自由入力の z 場'}</div>
      {/* z 式から自動検出した係数のスライダー（#52） */}
      {c.zFitParams.map((p) => (
        <div className="slider-row" key={p.key}>
          <label title={`初期値 ${p.value}`}>{p.label}</label>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={c.zFitValues[p.key] ?? p.value}
            onChange={(e) => onChange(setZCoeffPatch(c, p.key, Number(e.target.value)))}
          />
          <span className="val">{(c.zFitValues[p.key] ?? p.value).toFixed(2)}</span>
        </div>
      ))}
      <div className="expr-box">
        <div className="expr-pretty">z = {formatExprPretty(c.zFreeExpr)}</div>
        <div className="expr-raw">z = {c.zFreeExpr}</div>
      </div>
      <div className="free-input">
        <input
          type="text"
          value={zFreeDraft}
          placeholder="例: 5  /  0.3*y  /  5*cos(0.2*x)"
          onChange={(e) => setZFreeDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyZFree()}
        />
        <button className="btn small" onClick={applyZFree}>適用</button>
      </div>
      {c.zFreeError && <div className="field-error">{c.zFreeError}</div>}
      <div className="hint">
        変数 <code>x, y</code> は<strong>術者位置が原点</strong>（#52）。 <code>|z|={FIELD.zPeak}</code> に近いほど強い。 z&gt;0=光・z&lt;0=闇。
      </div>
    </>
  )
}
