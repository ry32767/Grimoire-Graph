// 属性場 z = g(t) の整形コントロール（DC プロトタイプ v3 の「z 整形」）。
// 属性・強度は右上の読み出しで常時見えるので、ここには出さない（#67）。
// t は術者からの距離。よく使う4つの形（山/段/波/平）はスライダーで直接いじれる。
// 自由式を手打ちしている間はスライダーを無効化し、「整形に切り替える」で正準形へ戻す。
import { SAMPLING } from '../data/constants'
import type { ComposerState } from './composer'
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

const KINDS: ZShapeKind[] = ['gauss', 'step', 'wave', 'flat']

export default function ZFieldControls({ composer: c, onChange, rDistance }: Props) {
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
