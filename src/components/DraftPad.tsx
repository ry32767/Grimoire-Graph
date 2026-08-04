// 作図台（DC プロトタイプ v3 の「作図台 — 式をいじる」）。
// 関数空間の方眼紙。盤面ではないので、ここで打つ点は格子点（整数）に吸着する。
// 「係数をいじる」＝式中の数値をスライダーで動かす／「点から作る」＝打った点に式を合わせる。
// 点フィットは **いま書いている式の係数**を自動で動かす（＝スライダーの自動調節・#67）。
// 式に数値が無いときだけ多項式（1〜3次）へ落ちる。結果は必ず**上書き**する（元の式に足さない）。
import { useEffect, useRef, useState } from 'react'
import type { Vec2 } from '../game/types'
import { parseExpression } from '../game/functions'
import { fitToGraphAdaptive, type DetectedParam, type ParamValues } from '../game/exprFit'
import {
  type ComposerState,
  applyFitValuesPatch,
  applyZFitValuesPatch,
  recenterCoeffPatch,
  recenterZCoeffPatch,
  setCoeffPatch,
  setZCoeffPatch,
  yTextOf,
  yTextPatch,
  zTextPatch,
} from './composer'
import CoefSliders from './CoefSliders'
import { formatPoly, polyFit } from './polyFit'
import { PAD_H, PAD_TMAX, PAD_W, PAD_Y_RANGE, drawDraftPad, padGeo } from '../render/draftpad'

interface Props {
  composer: ComposerState
  onChange: (next: Partial<ComposerState>) => void
  /** 射線上の的までの距離 r（縦の破線） */
  rDistance: number
  /** いま編集しているのは y か z か */
  focus: 'y' | 'z'
  onClose: () => void
  /** 盤面で通過点を拾うモード（#46）。射出（rotate）で係数が検出できるときだけ渡す */
  boardPick?: {
    active: boolean
    count: number
    onToggle: () => void
    onRun: () => void
    onClear: () => void
  }
}

export default function DraftPad({ composer: c, onChange, rDistance, focus, onClose, boardPick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'coef' | 'pts'>('coef')
  const [deg, setDeg] = useState(2)
  const [pts, setPts] = useState<Vec2[]>([])

  const onZ = focus === 'z'
  const barrier = !onZ && c.mode === 'polar'
  // 結界（r=f(θ)）は輪であって片道のグラフではないので、点から作るは出さない（係数で調整する）
  const canPickPoints = !barrier
  const view = canPickPoints ? mode : 'coef'
  const source = onZ ? c.zText : c.yText
  const params = onZ ? c.zFitParams : c.fitParams
  const values = onZ ? c.zFitValues : c.fitValues
  const template = onZ ? c.zFitTemplate : c.fitTemplate
  const varName: 'x' | 't' = onZ ? 't' : 'x'
  // いまの式に係数（数値リテラル）があれば、その係数を点に合わせる。無ければ多項式に落ちる
  const byExpr = params.length > 0 && template !== ''
  const poly = !byExpr && pts.length >= 2 ? polyFit(pts, deg) : null
  const polyExpr = poly ? formatPoly(poly, varName) : '—'

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    drawDraftPad(ctx, {
      f: parseExpression(onZ ? c.zFreeExpr : c.freeExpr, barrier || onZ ? 't' : 'x'),
      barrier,
      onZ,
      rDistance,
      points: view === 'pts' ? pts : [],
      fitted: view === 'pts' ? poly : null,
    })
  }, [c.freeExpr, c.zFreeExpr, view, pts, poly, rDistance, onZ, barrier])

  const onPadPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (view !== 'pts') return
    const cv = ref.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    const g = padGeo()
    const px = ((e.clientX - rect.left) * PAD_W) / rect.width
    const py = ((e.clientY - rect.top) * PAD_H) / rect.height
    const mx = Math.round((px - g.ox) / g.sx)
    const my = Math.round((g.oy - py) / g.sy)
    if (mx < 0 || mx > PAD_TMAX || Math.abs(my) > PAD_Y_RANGE) return
    setPts((prev) => {
      const i = prev.findIndex((p) => p.x === mx && p.y === my)
      const next = i >= 0 ? prev.filter((_, k) => k !== i) : [...prev, { x: mx, y: my }]
      return next.sort((a, b) => a.x - b.x)
    })
  }

  /** いまの式の係数を点へ合わせる（スライダーが自動で動く）。式は上書きする。 */
  const applyExprFit = () => {
    const spec = { template, params, varName }
    const samples = pts.map((p) => ({ u: p.x, v: p.y }))
    const fit: { params: DetectedParam[]; values: ParamValues } = fitToGraphAdaptive(spec, values, samples)
    onChange(
      onZ
        ? applyZFitValuesPatch(c, fit.params, fit.values)
        : applyFitValuesPatch(c, fit.params, fit.values),
    )
  }

  /** 多項式で作り直す（いまの式に係数が無いときの受け皿）。式は上書きする。 */
  const applyPolyFit = () => {
    if (!poly) return
    if (onZ) onChange(zTextPatch(polyExpr))
    else onChange(yTextPatch(yTextOf(polyExpr, c.mode)))
  }

  const setCoef = (key: string, v: number) =>
    onChange(onZ ? setZCoeffPatch(c, key, v) : setCoeffPatch(c, key, v))
  const commitCoef = (key: string) => {
    const patch = onZ ? recenterZCoeffPatch(c, key) : recenterCoeffPatch(c, key)
    if (patch) onChange(patch)
  }

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
        <canvas ref={ref} width={PAD_W} height={PAD_H} onPointerDown={onPadPointer} aria-label="作図台" />
        <div className="draft-note">
          {barrier
            ? '結界は極座標 r=f(θ)。輪の大きさは方眼紙の縦目盛りと同じ尺度で描いている'
            : '横軸 = 射線方向の距離 ・「点から作る」では格子点のみ（敵は格子に乗らない）'}
        </div>
      </div>
      <div className="draft-controls">
        <div className="draft-tabs">
          <button
            type="button"
            className={`btn small${view === 'coef' ? ' selected' : ''}`}
            onClick={() => setMode('coef')}
          >
            係数をいじる
          </button>
          {canPickPoints && (
            <button
              type="button"
              className={`btn small${view === 'pts' ? ' selected' : ''}`}
              onClick={() => setMode('pts')}
            >
              点から作る
            </button>
          )}
          <span className="draft-target">
            {onZ ? 'z = ' : barrier ? 'r = ' : 'y = '}
            {source || '0'}
          </span>
        </div>
        {view === 'coef' && (
          <div className="coef-row">
            {params.length > 0 ? (
              <CoefSliders params={params} values={values} onSet={setCoef} onCommit={commitCoef} />
            ) : (
              <span className="hint">式に数値が無いと係数スライダーは出ない。</span>
            )}
          </div>
        )}
        {view === 'pts' && (
          <div className="draft-pts-row">
            {byExpr ? (
              <span className="hint">いまの式の係数（{params.map((p) => p.label).join('・')}）を点に合わせる</span>
            ) : (
              <>
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
                <span className="draft-expr">{polyExpr}</span>
              </>
            )}
            <button type="button" className="btn small danger" onClick={() => setPts([])}>
              消す
            </button>
            <button
              type="button"
              className="btn small primary"
              disabled={byExpr ? pts.length === 0 : !poly}
              onClick={byExpr ? applyExprFit : applyPolyFit}
            >
              {byExpr ? '係数を合わせる ▸' : '式にする ▸'}
            </button>
          </div>
        )}
        {view === 'pts' && boardPick && (
          <div className="draft-pts-row">
            <span className="hint">盤面で通過点</span>
            <button
              type="button"
              className={`btn small${boardPick.active ? ' selected' : ''}`}
              onClick={boardPick.onToggle}
            >
              {boardPick.active ? '点を置く…' : '点を選ぶ'}
            </button>
            <button
              type="button"
              className="btn small primary"
              disabled={boardPick.count < 1}
              onClick={boardPick.onRun}
            >
              フィット（{boardPick.count}）
            </button>
            <button
              type="button"
              className="btn small"
              disabled={boardPick.count < 1 && !boardPick.active}
              onClick={boardPick.onClear}
            >
              クリア
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
