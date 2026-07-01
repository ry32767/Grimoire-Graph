import { useEffect, useState } from 'react'
import { ZFIELD_PRESETS, findZPreset, defaultZCoeffs } from '../game/zfields'
import { FIELD } from '../data/constants'
import { type ZFieldState, zParametricPatch, setZCoeffPatch } from './composer'

interface Props {
  z: ZFieldState
  onChange: (next: Partial<ZFieldState>) => void
}

/**
 * 属性の z 場 z=f(x,y) の操作 UI（#54）。プリセット選択・自動係数スライダー・自由入力。
 * z は全員共通（#57）。FunctionPanel（詳細設定）と、スマホの盤面ボトムバーの両方で使い回す。
 */
export default function ZFieldControls({ z: c, onChange }: Props) {
  const [zFreeDraft, setZFreeDraft] = useState(c.zFreeExpr)
  useEffect(() => setZFreeDraft(c.zFreeExpr), [c.zFreeExpr])
  const zPreset = findZPreset(c.zPresetId)

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
      <div className="form-row">
        <label className="form-label">場</label>
        <select className="select" value={c.zPresetId} onChange={(e) => selectZPreset(e.target.value)}>
          {ZFIELD_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
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
