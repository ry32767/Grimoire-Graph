import { useState } from 'react'
import type { Field, Mechanics } from '../game/types'
import {
  ROTATE_PRESETS,
  POLAR_PRESETS,
  sampleOutputs,
  parseExpression,
  defaultCoeffs,
} from '../game/functions'
import { SHIELD_PRESETS } from '../data/fields'
import { FIELD } from '../data/constants'
import {
  type ComposerState,
  type Preview,
  findPreset,
  presetsFor,
} from './composer'

interface Props {
  composer: ComposerState
  onChange: (next: Partial<ComposerState>) => void
  preview: Preview
  field: Field
  mechanics: Mechanics
  canFire: boolean
  onFire: () => void
  onRecommend: () => void
  onOpenCodex: () => void
}

const attrLabel = (a: string) => (a === 'light' ? '光' : a === 'dark' ? '闇' : '中立')

export default function FunctionPanel(props: Props) {
  const { composer: c, onChange, preview } = props
  const [freeDraft, setFreeDraft] = useState(c.freeExpr)
  const preset = findPreset(c.presetId)

  // 現在の関数のサンプル出力
  let samples: { x: number; y: number }[] = []
  if (c.mode === 'rotate') {
    const g = c.useFree ? parseExpression(c.freeExpr) : preset?.category === 'rotate' ? preset.buildG(c.coeffs) : null
    if (g) samples = sampleOutputs(g, [0, 2, 5])
  } else if (preset?.category === 'polar') {
    const f = preset.buildF(c.coeffs)
    samples = [0, Math.PI / 2, Math.PI].map((t) => ({ x: t, y: f(t) }))
  }

  const switchMode = (mode: 'rotate' | 'polar') => {
    const first = presetsFor(mode)[0]
    onChange({ mode, presetId: first.id, coeffs: defaultCoeffs(first), useFree: false, freeError: null })
  }
  const selectPreset = (id: string) => {
    const p = findPreset(id)
    if (p) onChange({ presetId: id, coeffs: defaultCoeffs(p), useFree: false, freeError: null })
  }
  const applyFree = () => {
    const g = parseExpression(freeDraft)
    if (!g) {
      onChange({ freeError: '式が正しくありません' })
    } else {
      onChange({ freeExpr: freeDraft, useFree: true, freeError: null })
    }
  }

  const presets = c.mode === 'rotate' ? ROTATE_PRESETS : POLAR_PRESETS

  return (
    <div className="panel">
      <div className="mode-tabs">
        <button className={`btn small${c.actionKind === 'attack' ? ' selected' : ''}`} onClick={() => onChange({ actionKind: 'attack' })}>
          攻撃（術式）
        </button>
        {props.mechanics.shield && (
          <button className={`btn small${c.actionKind === 'shield' ? ' selected' : ''}`} onClick={() => onChange({ actionKind: 'shield' })}>
            防御（結界）
          </button>
        )}
      </div>

      {c.actionKind === 'attack' ? (
        <>
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
          <div className="preset-desc">{c.useFree ? '自由入力式を使用中' : (preset?.description ?? '')}</div>

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

          {c.mode === 'rotate' && (
            <div className="free-input-wrap">
              <div className="section-title">自由入力（x の式）</div>
              <div className="free-input">
                <input
                  type="text"
                  value={freeDraft}
                  placeholder="例: sin(x)*2 + 1"
                  onChange={(e) => setFreeDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyFree()}
                />
                <button className="btn small" onClick={applyFree}>
                  適用
                </button>
              </div>
              {c.freeError && <div className="field-error">{c.freeError}</div>}
            </div>
          )}

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

          <div className="slider-row">
            <label>初速</label>
            <input
              type="range"
              min={FIELD.minSpeed}
              max={FIELD.maxSpeed}
              step={0.5}
              value={c.speed}
              onChange={(e) => onChange({ speed: Number(e.target.value) })}
            />
            <span className="val">{c.speed.toFixed(1)}</span>
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
                  着弾属性:{' '}
                  <span className={preview.landing.attr}>{attrLabel(preview.landing.attr)}</span>
                </div>
                <div>強度 |z|: {preview.landing.strength.toFixed(2)}</div>
                <div>威力目安: {preview.powerEstimate.toFixed(1)}</div>
              </>
            )}
          </div>

          {preview.selfMisfireWarning && (
            <div className="warn">⚠ 足元で暴発（自爆）の恐れ。原点近くで発散する式です。</div>
          )}

          <div className="action-row">
            <button className="btn primary" disabled={!props.canFire} onClick={props.onFire}>
              発射
            </button>
            <button className="btn small" onClick={props.onRecommend} title="無難に当たるおすすめ関数">
              困ったらこれ
            </button>
            <button className="btn small" onClick={props.onOpenCodex}>
              図鑑
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="section-title">結界の形</div>
          <div className="preset-grid">
            {SHIELD_PRESETS.map((s) => (
              <button
                key={s.id}
                className={`btn small${c.shieldPresetId === s.id ? ' selected' : ''}`}
                onClick={() => onChange({ shieldPresetId: s.id })}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="preset-desc">{SHIELD_PRESETS.find((s) => s.id === c.shieldPresetId)?.description}</div>
          <div className="section-title">結界の属性</div>
          <div className="mode-tabs">
            <button className={`btn small${c.shieldElement === 'light' ? ' selected' : ''}`} onClick={() => onChange({ shieldElement: 'light' })}>
              光
            </button>
            <button className={`btn small${c.shieldElement === 'dark' ? ' selected' : ''}`} onClick={() => onChange({ shieldElement: 'dark' })}>
              闇
            </button>
          </div>
          <div className="hint">同極の敵弾はよく吸収し、反対極には弱い。敵弾の属性を読んで選ぼう。</div>
          <div className="action-row">
            <button className="btn primary" onClick={props.onFire}>
              結界を張る
            </button>
            <button className="btn small" onClick={props.onOpenCodex}>
              図鑑
            </button>
          </div>
        </>
      )}
    </div>
  )
}
