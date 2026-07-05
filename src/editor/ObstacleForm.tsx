// 選択中の障害物 op の詳細フォーム（#67・docs/11-stage-editor.md §4.1/§4.3）。
// op の種別ごとに全パラメータを数値/プルダウンで編集できるようにする。変更は即座に呼び出し側へ通知する。
import type { Attribute } from '../game/types'
import type { ObstacleOp } from './model'
import { ElementSelect, KindSelect, NumField } from './ObstacleFormFields'

interface Props {
  op: ObstacleOp
  onChange: (next: ObstacleOp) => void
  onDelete: () => void
}

export default function ObstacleForm({ op, onChange, onDelete }: Props) {
  const del = (
    <button className="btn small danger" onClick={onDelete}>
      この壁を削除
    </button>
  )

  if (op.kind === 'raw') {
    return (
      <div className="obstacle-form">
        <p className="hint">既存ステージの壁（個別パラメータへ未逆変換）。ドラッグでの移動と削除のみ可能。</p>
        {del}
      </div>
    )
  }

  if (op.kind === 'disc') {
    const p = op.params
    return (
      <div className="obstacle-form">
        <NumField label="中心 x (cx)" value={p.cx} onChange={(v) => onChange({ ...op, params: { ...p, cx: v } })} />
        <NumField label="中心 y (cy)" value={p.cy} onChange={(v) => onChange({ ...op, params: { ...p, cy: v } })} />
        <NumField label="半径 (r)" value={p.r} onChange={(v) => onChange({ ...op, params: { ...p, r: Math.max(0.1, v) } })} />
        <label>
          属性
          <ElementSelect value={p.element} onChange={(v) => onChange({ ...op, params: { ...p, element: v } })} />
        </label>
        <label>
          種別
          <KindSelect value={p.kind} fallback="normal" onChange={(v) => onChange({ ...op, params: { ...p, kind: v } })} />
        </label>
        {del}
      </div>
    )
  }

  if (op.kind === 'rect') {
    const p = op.params
    return (
      <div className="obstacle-form">
        <NumField label="左下 x (x)" value={p.x} onChange={(v) => onChange({ ...op, params: { ...p, x: v } })} />
        <NumField label="左下 y (y)" value={p.y} onChange={(v) => onChange({ ...op, params: { ...p, y: v } })} />
        <NumField label="幅 (w)" value={p.w} onChange={(v) => onChange({ ...op, params: { ...p, w: Math.max(0.1, v) } })} />
        <NumField label="高さ (h)" value={p.h} onChange={(v) => onChange({ ...op, params: { ...p, h: Math.max(0.1, v) } })} />
        <label>
          属性
          <ElementSelect value={p.element} onChange={(v) => onChange({ ...op, params: { ...p, element: v } })} />
        </label>
        <label>
          種別
          <KindSelect value={p.kind} fallback="normal" onChange={(v) => onChange({ ...op, params: { ...p, kind: v } })} />
        </label>
        {del}
      </div>
    )
  }

  if (op.kind === 'pillar') {
    const p = op.params
    return (
      <div className="obstacle-form">
        <NumField label="中心 x (cx)" value={p.cx} onChange={(v) => onChange({ ...op, params: { ...p, cx: v } })} />
        <NumField label="開始 y (y0)" value={p.y0} onChange={(v) => onChange({ ...op, params: { ...p, y0: v } })} />
        <NumField label="段数 (n)" value={p.n} onChange={(v) => onChange({ ...op, params: { ...p, n: v } })} />
        <label>
          属性
          <ElementSelect value={p.element} onChange={(v) => onChange({ ...op, params: { ...p, element: v } })} />
        </label>
        <label>
          種別
          <KindSelect value={p.kind} fallback="normal" onChange={(v) => onChange({ ...op, params: { ...p, kind: v } })} />
        </label>
        {del}
      </div>
    )
  }

  if (op.kind === 'block') {
    const p = op.params
    return (
      <div className="obstacle-form">
        <NumField label="左下 x (x0)" value={p.x0} onChange={(v) => onChange({ ...op, params: { ...p, x0: v } })} />
        <NumField label="左下 y (y0)" value={p.y0} onChange={(v) => onChange({ ...op, params: { ...p, y0: v } })} />
        <NumField label="列数 (cols)" value={p.cols} onChange={(v) => onChange({ ...op, params: { ...p, cols: v } })} />
        <NumField label="行数 (rows)" value={p.rows} onChange={(v) => onChange({ ...op, params: { ...p, rows: v } })} />
        <label>
          属性
          <ElementSelect value={p.element} onChange={(v) => onChange({ ...op, params: { ...p, element: v } })} />
        </label>
        <label>
          種別
          <KindSelect value={p.kind} fallback="normal" onChange={(v) => onChange({ ...op, params: { ...p, kind: v } })} />
        </label>
        {del}
      </div>
    )
  }

  if (op.kind === 'wall') {
    const p = op.params
    return (
      <div className="obstacle-form">
        <NumField label="始点 x (x0)" value={p.x0} onChange={(v) => onChange({ ...op, params: { ...p, x0: v } })} />
        <NumField label="終点 x (x1)" value={p.x1} onChange={(v) => onChange({ ...op, params: { ...p, x1: v } })} />
        <NumField label="開始 y (y0)" value={p.y0} onChange={(v) => onChange({ ...op, params: { ...p, y0: v } })} />
        <NumField label="段数 (rows)" value={p.rows} onChange={(v) => onChange({ ...op, params: { ...p, rows: v } })} />
        <label>
          属性
          <ElementSelect value={p.element} onChange={(v) => onChange({ ...op, params: { ...p, element: v } })} />
        </label>
        <label>
          種別
          <KindSelect value={p.kind} fallback="normal" onChange={(v) => onChange({ ...op, params: { ...p, kind: v } })} />
        </label>
        {del}
      </div>
    )
  }

  if (op.kind === 'colonnade') {
    const p = op.params
    const setElem = (i: number, v: Attribute) => {
      const elems = [...p.elems]
      elems[i] = v
      onChange({ ...op, params: { ...p, elems } })
    }
    return (
      <div className="obstacle-form">
        <NumField label="始点 x (x0)" value={p.x0} onChange={(v) => onChange({ ...op, params: { ...p, x0: v } })} />
        <NumField label="終点 x (x1)" value={p.x1} onChange={(v) => onChange({ ...op, params: { ...p, x1: v } })} />
        <NumField label="柱間隔 (step)" value={p.step} onChange={(v) => onChange({ ...op, params: { ...p, step: v } })} />
        <NumField label="開始 y (y0)" value={p.y0} onChange={(v) => onChange({ ...op, params: { ...p, y0: v } })} />
        <NumField label="段数 (n)" value={p.n} onChange={(v) => onChange({ ...op, params: { ...p, n: v } })} />
        <div className="elems-editor">
          属性配列（順に割当）
          {p.elems.map((el, i) => (
            <div key={i} className="elems-row">
              <ElementSelect value={el} onChange={(v) => setElem(i, v)} />
              {p.elems.length > 1 && (
                <button
                  className="btn small"
                  onClick={() => onChange({ ...op, params: { ...p, elems: p.elems.filter((_, j) => j !== i) } })}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button className="btn small" onClick={() => onChange({ ...op, params: { ...p, elems: [...p.elems, 'neutral'] } })}>
            + 属性を追加
          </button>
        </div>
        {del}
      </div>
    )
  }

  if (op.kind === 'spiralArm') {
    const p = op.params
    return (
      <div className="obstacle-form">
        <NumField label="中心 x (cx)" value={p.cx} onChange={(v) => onChange({ ...op, params: { ...p, cx: v } })} />
        <NumField label="中心 y (cy)" value={p.cy} onChange={(v) => onChange({ ...op, params: { ...p, cy: v } })} />
        <NumField label="点数 (n)" value={p.n} onChange={(v) => onChange({ ...op, params: { ...p, n: v } })} />
        <NumField label="巻き数 (turns)" value={p.turns} onChange={(v) => onChange({ ...op, params: { ...p, turns: v } })} />
        <NumField label="位相 (phase)" value={p.phase} onChange={(v) => onChange({ ...op, params: { ...p, phase: v } })} />
        <NumField label="開始半径 (r0)" value={p.r0 ?? 2.5} onChange={(v) => onChange({ ...op, params: { ...p, r0: v } })} />
        <label>
          属性
          <ElementSelect value={p.element} onChange={(v) => onChange({ ...op, params: { ...p, element: v } })} />
        </label>
        {del}
      </div>
    )
  }

  if (op.kind === 'ring') {
    const p = op.params
    return (
      <div className="obstacle-form">
        <NumField label="中心 x (cx)" value={p.cx} onChange={(v) => onChange({ ...op, params: { ...p, cx: v } })} />
        <NumField label="中心 y (cy)" value={p.cy} onChange={(v) => onChange({ ...op, params: { ...p, cy: v } })} />
        <NumField label="半径 (radius)" value={p.radius} onChange={(v) => onChange({ ...op, params: { ...p, radius: v } })} />
        <NumField label="円の数 (n)" value={p.n ?? 14} onChange={(v) => onChange({ ...op, params: { ...p, n: v } })} />
        <label>
          属性
          <ElementSelect value={p.element} onChange={(v) => onChange({ ...op, params: { ...p, element: v } })} />
        </label>
        <label>
          種別
          <KindSelect value={p.kind} fallback="normal" onChange={(v) => onChange({ ...op, params: { ...p, kind: v } })} />
        </label>
        {del}
      </div>
    )
  }

  if (op.kind === 'roomWalls') {
    const p = op.params
    return (
      <div className="obstacle-form">
        <NumField label="左端 (xL)" value={p.xL} onChange={(v) => onChange({ ...op, params: { ...p, xL: v } })} />
        <NumField label="右端 (xR)" value={p.xR} onChange={(v) => onChange({ ...op, params: { ...p, xR: v } })} />
        <NumField label="下端 (yB)" value={p.yB} onChange={(v) => onChange({ ...op, params: { ...p, yB: v } })} />
        <NumField label="上端 (yT)" value={p.yT} onChange={(v) => onChange({ ...op, params: { ...p, yT: v } })} />
        <label>
          属性
          <ElementSelect value={p.element ?? 'neutral'} onChange={(v) => onChange({ ...op, params: { ...p, element: v } })} />
        </label>
        <label>
          種別
          <KindSelect value={p.kind} fallback="unbreakable" onChange={(v) => onChange({ ...op, params: { ...p, kind: v } })} />
        </label>
        {del}
      </div>
    )
  }

  // roomWallsOpenEnds
  const p = op.params
  return (
    <div className="obstacle-form">
      <NumField label="左端 (xL)" value={p.xL} onChange={(v) => onChange({ ...op, params: { ...p, xL: v } })} />
      <NumField label="右端 (xR)" value={p.xR} onChange={(v) => onChange({ ...op, params: { ...p, xR: v } })} />
      {del}
    </div>
  )
}
