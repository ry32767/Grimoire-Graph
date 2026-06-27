import { useEffect, useState } from 'react'
import {
  ROTATE_PRESETS,
  POLAR_PRESETS,
  sampleOutputs,
  parseExpression,
  parseZExpression,
  defaultCoeffs,
} from '../game/functions'
import { ZFIELD_PRESETS, findZPreset, defaultZCoeffs } from '../game/zfields'
import { FIELD } from '../data/constants'
import { type ComposerState, type Preview, findPreset, presetsFor } from './composer'

interface Props {
  allyName: string
  composer: ComposerState
  onChange: (next: Partial<ComposerState>) => void
  preview: Preview
  onRecommend: () => void
  onOpenCodex: () => void
}

const attrLabel = (a: string) => (a === 'light' ? '光' : a === 'dark' ? '闇' : '中立')

export default function FunctionPanel(props: Props) {
  const { composer: c, onChange, preview } = props
  const [freeDraft, setFreeDraft] = useState(c.freeExpr)
  const [zFreeDraft, setZFreeDraft] = useState(c.zFreeExpr)
  const preset = findPreset(c.presetId)
  const zPreset = findZPreset(c.zPresetId)

  // 味方を切り替えたら自由入力欄も同期
  useEffect(() => setFreeDraft(c.freeExpr), [c.freeExpr])
  useEffect(() => setZFreeDraft(c.zFreeExpr), [c.zFreeExpr])

  // 現在の関数のサンプル出力
  let samples: { x: number; y: number }[] = []
  if (c.mode === 'rotate') {
    const g = c.useFree ? parseExpression(c.freeExpr) : preset?.category === 'rotate' ? preset.buildG(c.coeffs) : null
    if (g) samples = sampleOutputs(g, [0, 2, 5])
  } else {
    const f = c.useFree
      ? parseExpression(c.freeExpr, 't')
      : preset?.category === 'polar'
        ? preset.buildF(c.coeffs)
        : null
    if (f) samples = [0, Math.PI / 2, Math.PI].map((t) => ({ x: t, y: f(t) }))
  }

  const switchMode = (mode: 'rotate' | 'polar') => {
    const first = presetsFor(mode)[0]
    const coeffs = defaultCoeffs(first)
    onChange({
      mode,
      presetId: first.id,
      coeffs,
      useFree: false,
      freeError: null,
      freeExpr: first.toExpr(coeffs),
    })
  }
  // #13：プリセット選択時、自由入力欄にその式を自動転記（回転=x／極座標=t）
  const selectPreset = (id: string) => {
    const p = findPreset(id)
    if (!p) return
    const coeffs = defaultCoeffs(p)
    onChange({ presetId: id, coeffs, useFree: false, freeError: null, freeExpr: p.toExpr(coeffs) })
  }
  // #19：極座標でも自由入力（θ は t）を受け付ける
  const applyFree = () => {
    const f = parseExpression(freeDraft, c.mode === 'polar' ? 't' : 'x')
    if (!f) onChange({ freeError: '式が正しくありません' })
    else onChange({ freeExpr: freeDraft, useFree: true, freeError: null })
  }

  // z 場（属性 z=f(x,y)・#30）の操作
  const selectZPreset = (id: string) => {
    const p = findZPreset(id)
    if (!p) return
    const zCoeffs = defaultZCoeffs(p)
    onChange({ zPresetId: id, zCoeffs, zUseFree: false, zFreeError: null, zFreeExpr: p.toExpr(zCoeffs) })
  }
  const applyZFree = () => {
    const f = parseZExpression(zFreeDraft)
    if (!f) onChange({ zFreeError: '式が正しくありません' })
    else onChange({ zFreeExpr: zFreeDraft, zUseFree: true, zFreeError: null })
  }

  const presets = c.mode === 'rotate' ? ROTATE_PRESETS : POLAR_PRESETS

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-ally">{props.allyName} の術式</span>
        <span className={`kind-badge ${preview.kind}`}>
          {preview.kind === 'orbit' ? '軌道型（周回・防御兼）' : '発射型（火球）'}
        </span>
      </div>

      <div className="mode-tabs">
        <button className={`btn small${c.mode === 'rotate' ? ' selected' : ''}`} onClick={() => switchMode('rotate')}>
          回転 y=g(x)
        </button>
        <button className={`btn small${c.mode === 'polar' ? ' selected' : ''}`} onClick={() => switchMode('polar')}>
          極座標 r=f(θ)
        </button>
      </div>

      <div className="section-title">プリセット</div>
      <div className="preset-grid">
        {presets.map((p) => (
          <button
            key={p.id}
            className={`btn small${!c.useFree && c.presetId === p.id ? ' selected' : ''}`}
            onClick={() => selectPreset(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="preset-desc">
        {c.useFree ? '自由入力式を使用中' : (preset?.description ?? '')}
        {!c.useFree && preset && (
          <div className="free-hint">
            自由入力名: <code>{preset.freeName}</code>
          </div>
        )}
      </div>

      {!c.useFree &&
        preset?.coeffs.map((cf) => (
          <div className="slider-row" key={cf.key}>
            <label>{cf.label}</label>
            <input
              type="range"
              min={cf.min}
              max={cf.max}
              step={cf.step}
              value={c.coeffs[cf.key] ?? cf.default}
              onChange={(e) => onChange({ coeffs: { ...c.coeffs, [cf.key]: Number(e.target.value) } })}
            />
            <span className="val">{(c.coeffs[cf.key] ?? cf.default).toFixed(2)}</span>
          </div>
        ))}

      <div className="free-input-wrap">
        <div className="section-title">
          自由入力（{c.mode === 'polar' ? 'θ の式・θ は t で入力' : 'x の式'}）
        </div>
        <div className="free-input">
          <input
            type="text"
            value={freeDraft}
            placeholder={c.mode === 'polar' ? '例: 8*cos(2*t)' : '例: sin(x)*2 + 1'}
            onChange={(e) => setFreeDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFree()}
          />
          <button className="btn small" onClick={applyFree}>
            適用
          </button>
        </div>
        {c.freeError && <div className="field-error">{c.freeError}</div>}
        <div className="hint">
          使える関数: <code>sin cos tan sqrt exp abs log</code>（<code>^</code>はべき乗）。 変数は{' '}
          <code>{c.mode === 'polar' ? 't（=θ）' : 'x'}</code>
        </div>
        {preset && (
          <button className="btn small" onClick={() => setFreeDraft(preset.toExpr(c.coeffs))}>
            今の関数を式にコピー
          </button>
        )}
      </div>

      {c.mode === 'rotate' && (
        <div className="slider-row">
          <label>θ</label>
          <input
            type="range"
            min={0}
            max={Math.PI * 2}
            step={0.01}
            value={c.angle}
            onChange={(e) => onChange({ angle: Number(e.target.value) })}
          />
          <span className="val">{Math.round((c.angle * 180) / Math.PI)}°</span>
        </div>
      )}

      {/* 属性の z 場 z=f(x,y)（軌道と別入力・#30/#21） */}
      <div className="zfield-section">
        <div className="section-title">属性の高さ z = f(x,y)（光⇔闇）</div>
        <div className="preset-grid">
          {ZFIELD_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`btn small${!c.zUseFree && c.zPresetId === p.id ? ' selected' : ''}`}
              onClick={() => selectZPreset(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="preset-desc">{c.zUseFree ? '自由入力の z 場を使用中' : (zPreset?.description ?? '')}</div>
        {!c.zUseFree &&
          zPreset?.coeffs.map((cf) => (
            <div className="slider-row" key={cf.key}>
              <label>{cf.label}</label>
              <input
                type="range"
                min={cf.min}
                max={cf.max}
                step={cf.step}
                value={c.zCoeffs[cf.key] ?? cf.default}
                onChange={(e) => onChange({ zCoeffs: { ...c.zCoeffs, [cf.key]: Number(e.target.value) } })}
              />
              <span className="val">{(c.zCoeffs[cf.key] ?? cf.default).toFixed(2)}</span>
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
          <button className="btn small" onClick={applyZFree}>
            適用
          </button>
        </div>
        {c.zFreeError && <div className="field-error">{c.zFreeError}</div>}
        <div className="hint">
          変数は <code>x, y</code>（位置）。 <code>|z|={FIELD.zPeak}</code> に近いほど強い。 z&gt;0=光・z&lt;0=闇。
          発射するまで色は伏せられる。
        </div>
      </div>

      <div className="hint">初速は固定（{FIELD.fixedSpeed}）。当てる位置の z で属性・威力が決まる。</div>

      <div className="section-title">計算補助</div>
      <div className="readout">
        {samples.map((s, i) => (
          <div key={i}>
            <span className="k">{c.mode === 'rotate' ? `f(${s.x})` : `f(${s.x.toFixed(2)})`}</span> ={' '}
            {Number.isFinite(s.y) ? s.y.toFixed(2) : '—'}
          </div>
        ))}
        {preview.landing && (
          <>
            <div>
              着弾の理: <span className={preview.landing.attr}>{attrLabel(preview.landing.attr)}</span>
            </div>
            <div>着弾強度 |z|: {preview.landing.strength.toFixed(2)}</div>
            <div>最大強度: {preview.maxStrength.toFixed(2)}</div>
            <div>威力目安: {preview.powerEstimate.toFixed(1)}</div>
          </>
        )}
      </div>

      {preview.selfMisfireWarning && (
        <div className="warn">⚠ 足元で暴発（自爆）の恐れ。原点近くで発散する式です。</div>
      )}

      <div className="action-row">
        <button className="btn small" onClick={props.onRecommend} title="無難に当たるおすすめ関数">
          困ったらこれ
        </button>
        <button className="btn small" onClick={props.onOpenCodex}>
          図鑑
        </button>
      </div>
    </div>
  )
}
