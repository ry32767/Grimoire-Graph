// 属性場 z = g(t) の整形コントロール（DC プロトタイプ v3 の「z 整形」）。
// t は術者からの距離。よく使う4つの形（山/段/波/平）はスライダーで直接いじれる。
// 自由式を手打ちしている間はスライダーを無効化し、「整形に切り替える」で正準形へ戻す。
import { FIELD, SAMPLING } from '../data/constants'
import { type ComposerState, buildZAt } from './composer'
import {
  type ZShapeKind,
  Z_SHAPE_DESC,
  Z_SHAPE_LABEL,
  genZShape,
  parseZShape,
  patchZShape,
} from './zshape'

interface Props {
  composer: ComposerState
  onChange: (next: Partial<ComposerState>) => void
  /** 射線上の的までの距離 r（t₀ ← r のスナップに使う） */
  rDistance: number
}

const GAUGE_W = 200
const GAUGE_H = 56
const GAUGE_PAD = 6
const Z_MAX = FIELD.zPeak * 1.4

/** |z|=zPeak を頂点とする山型の強度カーブ（DESIGN.md §4.4：strength(z)）。 */
function strengthAt(z: number): number {
  const d = Math.abs(Math.abs(z) - FIELD.zPeak)
  return FIELD.sMax * Math.max(0, 1 - d / FIELD.zPeak)
}
function toGaugeX(z: number): number {
  const t = (z + Z_MAX) / (Z_MAX * 2)
  return GAUGE_PAD + t * (GAUGE_W - GAUGE_PAD * 2)
}
function toGaugeY(s: number): number {
  const t = s / FIELD.sMax
  return GAUGE_H - GAUGE_PAD - t * (GAUGE_H - GAUGE_PAD * 2)
}

/**
 * z強度ゲージ（シグネチャ）：山型ポリライン（|z|=zPeak で頂点）と現在値マーカー。
 * 「高いほど強いが、狙いすぎると失速する」という核をUIで常時可視化する（DESIGN.md §4.4）。
 */
function ZStrengthGauge({ z, at }: { z: number; at: number }) {
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
        t={at.toFixed(1)}：
        <span className={`zval ${neutral ? '' : z > 0 ? 'light' : 'dark'}`}>
          {attrLabel}・強度{strength.toFixed(1)}
        </span>
        {decelerating && <span>（高いが失速しやすい）</span>}
      </div>
    </div>
  )
}

const KINDS: ZShapeKind[] = ['gauss', 'step', 'wave', 'flat']

export default function ZFieldControls({ composer: c, onChange, rDistance }: Props) {
  const zAt = buildZAt(c)
  const zHere = zAt ? zAt(rDistance) : 0
  const shape = parseZShape(c.zText)
  const free = !shape
  const t0 = shape ? shape.t0 : Math.round(rDistance)
  const w = shape ? shape.w : 6
  const h = shape ? shape.h : 0

  const set = (patch: Parameters<typeof patchZShape>[1]) => {
    const expr = patchZShape(c.zText, patch)
    onChange({
      zText: expr,
      zFreeExpr: expr,
      zUseFree: true,
      zFreeError: null,
      zFitTemplate: '',
      zFitParams: [],
      zFitValues: {},
    })
  }
  const toCanonical = () => {
    const expr = genZShape('gauss', 5, Math.round(rDistance * 10) / 10, 6)
    onChange({
      zText: expr,
      zFreeExpr: expr,
      zUseFree: true,
      zFreeError: null,
      zFitTemplate: '',
      zFitParams: [],
      zFitValues: {},
    })
  }

  return (
    <div className={`zshape${free ? ' free' : ''}`}>
      <ZStrengthGauge z={Number.isFinite(zHere) ? zHere : 0} at={rDistance} />
      <div className="zshape-head">
        <span className="zshape-title">z 整形</span>
        {free ? (
          <>
            <span className="zshape-badge free">自由式を手打ち中</span>
            <button type="button" className="btn small" onClick={toCanonical}>
              整形に切り替える
            </button>
          </>
        ) : (
          <span className="zshape-badge">
            {Math.abs(h) < 0.05 ? '中立 z=0' : `${Z_SHAPE_LABEL[shape.kind]}形`} — {Z_SHAPE_DESC[shape.kind]}
          </span>
        )}
      </div>
      <div className="zshape-kinds">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`btn small zkind${shape?.kind === k ? ' selected' : ''}`}
            disabled={free}
            onClick={() => set({ kind: k })}
            title={Z_SHAPE_DESC[k]}
          >
            {Z_SHAPE_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="zshape-sliders">
        <div className="slider-row">
          <label htmlFor="zshape-t0">t₀</label>
          <span className="val">{free ? '—' : t0.toFixed(1)}</span>
          <input
            id="zshape-t0"
            type="range"
            min={2}
            max={SAMPLING.rotateXMax}
            step={0.1}
            value={t0}
            disabled={free}
            onChange={(e) => set({ t0: Number(e.target.value) })}
          />
        </div>
        <div className="slider-row">
          <label htmlFor="zshape-w">w</label>
          <span className="val">{free ? '—' : w.toFixed(1)}</span>
          <input
            id="zshape-w"
            type="range"
            min={1}
            max={20}
            step={0.5}
            value={w}
            disabled={free}
            onChange={(e) => set({ w: Number(e.target.value) })}
          />
        </div>
        <div className="slider-row">
          <label htmlFor="zshape-h">z₀</label>
          <span className="val">{free ? '—' : `${h > 0 ? '+' : ''}${h.toFixed(1)}`}</span>
          <input
            id="zshape-h"
            type="range"
            min={-8}
            max={8}
            step={0.1}
            value={h}
            disabled={free}
            onChange={(e) => set({ h: Number(e.target.value) })}
          />
        </div>
        <button
          type="button"
          className="btn small snap-t0"
          disabled={free}
          onClick={() => set({ t0: Math.round(rDistance * 10) / 10 })}
          title="頂点を射線上の的の距離へ合わせる"
        >
          t₀ ← r
        </button>
      </div>
    </div>
  )
}
