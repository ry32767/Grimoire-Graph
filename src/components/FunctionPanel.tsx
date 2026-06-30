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
import {
  type ComposerState,
  type Preview,
  findPreset,
  presetsFor,
  parametricPatch,
  setCoeffPatch,
} from './composer'

interface Props {
  allyName: string
  composer: ComposerState
  onChange: (next: Partial<ComposerState>) => void
  preview: Preview
  onRecommend: () => void
  onOpenCodex: () => void
  /** z 場の編集中フラグを通知（#37：いじっている間だけ場をプレビュー表示する） */
  onZEditing?: (editing: boolean) => void
  /** 通過点フィット（#46・射出のみ） */
  fitPickActive?: boolean
  fitPointCount?: number
  onToggleFitPick?: () => void
  onRunFit?: () => void
  onClearFitPoints?: () => void
}

const attrLabel = (a: string) => (a === 'light' ? '光' : a === 'dark' ? '闇' : '中立')

export default function FunctionPanel(props: Props) {
  const { composer: c, onChange, preview } = props
  const [freeDraft, setFreeDraft] = useState(c.freeExpr)
  const [zFreeDraft, setZFreeDraft] = useState(c.zFreeExpr)
  const [advancedOpen, setAdvancedOpen] = useState(false)
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

  // 回転=x／極座標=t。どちらも自由入力式から係数を自動検出してスライダー化する（#46）
  const varOf = (mode: 'rotate' | 'polar') => (mode === 'polar' ? 't' : 'x')

  const switchMode = (mode: 'rotate' | 'polar') => {
    const first = presetsFor(mode)[0]
    const coeffs = defaultCoeffs(first)
    onChange({ mode, presetId: first.id, coeffs, ...parametricPatch(first.toExpr(coeffs), varOf(mode)) })
  }
  // #13/#46：プリセット選択で自由入力欄へ式を転記し、係数を自動検出してスライダー化（回転/極座標とも）
  const selectPreset = (id: string) => {
    const p = findPreset(id)
    if (!p) return
    const coeffs = defaultCoeffs(p)
    onChange({ presetId: id, coeffs, ...parametricPatch(p.toExpr(coeffs), varOf(p.category)) })
  }
  // #19/#46：自由入力を適用。回転/極座標とも係数を自動検出してスライダー化
  const applyFree = () => {
    onChange(parametricPatch(freeDraft, varOf(c.mode)))
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

  const canFit = c.mode === 'rotate' && preview.kind === 'projectile' && c.fitParams.length > 0

  return (
    <div className="panel func-panel">
      <div className="panel-head">
        <span className="panel-ally">{props.allyName} の術式</span>
        <span className={`kind-badge ${preview.kind}`}>
          {preview.kind === 'orbit' ? '軌道型（周回）' : '発射型（火球）'}
        </span>
      </div>

      {/* 形（プリセット）をプルダウンで選ぶ（#48：ボタンを減らす） */}
      <div className="form-row">
        <label className="form-label">形</label>
        <select
          className="select"
          value={`${c.mode}:${c.presetId}`}
          onChange={(e) => {
            const [mode, id] = e.target.value.split(':')
            if (mode !== c.mode) switchMode(mode as 'rotate' | 'polar')
            selectPreset(id)
          }}
        >
          <optgroup label="発射型（回転 y=g(x)）">
            {ROTATE_PRESETS.map((p) => (
              <option key={p.id} value={`rotate:${p.id}`}>{p.name}</option>
            ))}
          </optgroup>
          <optgroup label="軌道型（極座標 r=f(θ)）">
            {POLAR_PRESETS.map((p) => (
              <option key={p.id} value={`polar:${p.id}`}>{p.name}</option>
            ))}
          </optgroup>
        </select>
      </div>
      <div className="preset-desc">{preset?.description ?? '自由入力式'}</div>

      {/* 基本操作：方向はドラッグ、通過点フィットで仕上げる（#46/#47/#48） */}
      {canFit ? (
        <div className="fit-section primary">
          <div className="hint">
            盤面を<strong>ドラッグで発射方向</strong>。<strong>通したい点をタップ</strong>→「フィット」で曲線を合わせる。
          </div>
          <div className="action-row">
            <button
              className={`btn${props.fitPickActive ? ' selected' : ''}`}
              onClick={props.onToggleFitPick}
            >
              {props.fitPickActive ? '点を置く…' : '点を選ぶ'}
            </button>
            <button className="btn primary" disabled={(props.fitPointCount ?? 0) < 1} onClick={props.onRunFit}>
              フィット（{props.fitPointCount ?? 0}）
            </button>
            <button
              className="btn"
              disabled={(props.fitPointCount ?? 0) < 1 && !props.fitPickActive}
              onClick={props.onClearFitPoints}
            >
              クリア
            </button>
          </div>
        </div>
      ) : (
        <div className="hint">
          {c.mode === 'polar'
            ? '軌道型（結界）。係数スライダーや式で形を調整できる（通過点フィットは発射型のみ）。'
            : '盤面をドラッグで発射方向を決められる。'}
        </div>
      )}

      <button className="btn おまかせ" onClick={props.onRecommend} title="無難に当たるおすすめ術式">
        ✨ おまかせ（当たる術式）
      </button>

      {preview.selfMisfireWarning && (
        <div className="warn">⚠ 足元で暴発（自爆）の恐れ。原点近くで発散する式です。</div>
      )}

      {/* 詳細設定（係数・自由式・θ・z 場・計算補助）は折りたたみ（#48） */}
      <button
        className="btn small disclosure"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((o) => !o)}
      >
        詳細設定 {advancedOpen ? '▴' : '▾'}
      </button>

      {advancedOpen && (
        <div className="advanced">
          {/* 自由入力式から自動検出した係数スライダー（#46） */}
          {c.fitParams.length > 0 && (
            <>
              <div className="section-title">係数（式から自動検出）</div>
              {c.fitParams.map((p) => (
                <div className="slider-row" key={p.key}>
                  <label title={`初期値 ${p.value}`}>{p.label}</label>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={c.fitValues[p.key] ?? p.value}
                    onChange={(e) => onChange(setCoeffPatch(c, p.key, Number(e.target.value)))}
                  />
                  <span className="val">{(c.fitValues[p.key] ?? p.value).toFixed(2)}</span>
                </div>
              ))}
            </>
          )}

          <div className="free-input-wrap">
            <div className="section-title">自由入力（{c.mode === 'polar' ? 'θ の式・θ は t' : 'x の式'}）</div>
            <div className="free-input">
              <input
                type="text"
                value={freeDraft}
                placeholder={c.mode === 'polar' ? '例: 8*cos(2*t)' : '例: sin(x)*2 + 1'}
                onChange={(e) => setFreeDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFree()}
              />
              <button className="btn small" onClick={applyFree}>適用</button>
            </div>
            {c.freeError && <div className="field-error">{c.freeError}</div>}
            <div className="hint">
              使える関数: <code>sin cos tan sqrt exp abs log</code>（<code>^</code>はべき乗）。 変数は{' '}
              <code>{c.mode === 'polar' ? 't（=θ）' : 'x'}</code>
            </div>
          </div>

          {c.mode === 'rotate' && (
            <>
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
              <div className="hint">発射方向は<strong>盤面のクリック／ドラッグ</strong>でも決められる（#47）。</div>
            </>
          )}

          {/* 属性の z 場 z=f(x,y)（#30/#21）。いじっている間だけ場をプレビュー（#37） */}
          <div
            className="zfield-section"
            onMouseEnter={() => props.onZEditing?.(true)}
            onMouseLeave={() => props.onZEditing?.(false)}
            onFocusCapture={() => props.onZEditing?.(true)}
            onBlurCapture={() => props.onZEditing?.(false)}
          >
            <div className="section-title">属性の高さ z = f(x,y)（光⇔闇）</div>
            <div className="form-row">
              <label className="form-label">場</label>
              <select
                className="select"
                value={c.zUseFree ? '' : c.zPresetId}
                onChange={(e) => selectZPreset(e.target.value)}
              >
                {ZFIELD_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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
              <button className="btn small" onClick={applyZFree}>適用</button>
            </div>
            {c.zFreeError && <div className="field-error">{c.zFreeError}</div>}
            <div className="hint">
              変数は <code>x, y</code>。 <code>|z|={FIELD.zPeak}</code> に近いほど強い。 z&gt;0=光・z&lt;0=闇。
            </div>
          </div>

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
                <div>威力目安: {preview.powerEstimate.toFixed(1)}</div>
              </>
            )}
          </div>
          <div className="hint">初速は固定（{FIELD.fixedSpeed}）。当てる位置の z で属性・威力が決まる。</div>
        </div>
      )}
    </div>
  )
}
