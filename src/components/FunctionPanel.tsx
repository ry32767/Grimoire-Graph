// 詠唱コンソール（DC プロトタイプ v3 の CONSOLE）。
// y（軌道）と z（属性場）を別入力として並べ、いま編集している側のコントロールだけを出す。
// 上段は「y= / r=」の切り替えボタン＋式。接頭辞は**ボタン側**が持ち、入力欄には書かない（#68）。
// 術式チップも同じ切り替えで軌道／結界を出し分ける。z 欄の変数は t＝術者からの距離。
import { useRef } from 'react'
import {
  type ComposerState,
  barrierBody,
  isBarrierText,
  recenterCoeffPatch,
  setCoeffPatch,
  swapExprVar,
  yTextPatch,
  zTextPatch,
  yTextOf,
} from './composer'
import type { Readout } from './readout'
import { elementReadout } from './readout'
import CoefSliders from './CoefSliders'
import ZFieldControls from './ZFieldControls'

export type ConsoleFocus = 'y' | 'z'

interface Props {
  composer: ComposerState
  onChange: (next: Partial<ComposerState>) => void
  readout: Readout
  focus: ConsoleFocus
  onFocusChange: (f: ConsoleFocus) => void
  /** ⟳ 解く：いまの式のまま的を通る θ を数値的に探す */
  onSolveAngle: () => void
  solving?: boolean
  /** 作図台（点入力→多項式フィット）の開閉 */
  onToggleDraft: () => void
  draftOpen: boolean
  /** 記号盤（キーパッド）を出すか（開閉ボタンは発射列にある） */
  padOpen: boolean
  /** 盤面の通過点フィット（#46・射出のみ） */
}

/** y（軌道）の術式 */
const Y_SPELLS = [
  { name: '直線', tag: 'y=0', expr: '0', title: '最短距離。曲がらない' },
  { name: '放物', tag: 'x²', expr: '0.03*x^2', title: '重力弾。係数で曲率が変わる' },
  { name: '波', tag: 'sin', expr: '6*sin(0.4*x)', title: '振幅・周期を係数で振る' },
  { name: '減衰波', tag: 'sin·e⁻', expr: '8*sin(0.3*x)*exp(-0.06*x)', title: '振れながら直線に収束する' },
  { name: '折れ', tag: '|x|', expr: 'abs(x - 14) - 14', title: 'x=14 で折れ曲がる' },
  { name: '極', tag: '1/x', expr: '1/(x - 26)', title: 'x=26 で発散 → その点で暴発' },
]

/** 結界（r=f(θ)）の術式。θ は t と書く */
const WARD_SPELLS = [
  { name: '円', tag: 'r=6', expr: '6', title: '極座標の結界。半径6の円。弾は撃たない' },
  { name: '花', tag: '+cos3θ', expr: '6 + 1.6*cos(3*t)', title: '三花弁の結界。θ で向きが回る' },
  { name: '楯', tag: '放物', expr: '5/(1 - 0.55*cos(t))', title: '放物線状の楯。前方が厚い' },
  { name: '棘', tag: '+|sin4θ|', expr: '5 + 1.4*abs(sin(4*t))', title: '四方に棘。角度で厚みが変わる' },
  { name: '螺', tag: '+0.5θ', expr: '4 + 0.5*t', title: '螺旋。θ=0 と 2π で段差ができる' },
]

/** z（属性場）の術式。変数は t＝術者からの距離 */
const Z_SPELLS = [
  { name: '尖峰', tag: 'exp(−t²)', expr: '5*exp(-((t - 27)/6)^2)', title: '着弾の t だけ強度5。最大火力の定石' },
  { name: '闇尖峰', tag: '−exp(−t²)', expr: '-5*exp(-((t - 27)/6)^2)', title: '同じ形を闇で' },
  { name: '反転', tag: '段', expr: '5*(t - 24)/sqrt(4^2 + (t - 24)^2)', title: 't=24 で闇→光に切り替わる' },
  { name: '振動', tag: 'sin', expr: '5*sin((t - 6)/7)', title: '周期で属性が入れ替わる' },
  { name: '一定', tag: 'z=4', expr: '4', title: 'ずっと同じ属性。強度も一定' },
  { name: '中立', tag: 'z=0', expr: '0', title: '最速。ただし強度 0' },
]

const PAD_KEYS = [
  '7', '8', '9', '/', '(', ')', 'x', 't', 'π', '←', 'CLR',
  '4', '5', '6', '*', '^', 'sin(', 'cos(', 'tan(', 'log(', 'a', 'b',
  '1', '2', '3', '-', '0', '.', '+', 'exp(', 'sqrt(', 'abs(', 'c',
]

function padKeyClass(t: string): string {
  if (t === '←' || t === 'CLR') return 'pad-key del'
  if (['x', 't', 'a', 'b', 'c', 'π'].includes(t)) return 'pad-key var'
  if (/^[0-9.]$/.test(t)) return 'pad-key num'
  return 'pad-key fn'
}

export default function FunctionPanel(props: Props) {
  const { composer: c, onChange, readout, focus } = props
  const yRef = useRef<HTMLInputElement>(null)
  const zRef = useRef<HTMLInputElement>(null)
  const onZ = focus === 'z'
  const el = elementReadout(readout.ref.z)

  const ward = c.mode === 'polar'
  // 入力欄には `r=` を書かない。表示も編集も式の本体だけを扱う
  const yBody = ward ? barrierBody(c.yText) : c.yText

  const setZ = (text: string) => onChange(zTextPatch(text))
  const setY = (text: string) => {
    // 親切機能として `r=` と打たれたら結界へ切り替える（接頭辞は入力欄には残さない）
    const typed = isBarrierText(text)
    const body = typed ? barrierBody(text) : text
    onChange(yTextPatch(yTextOf(body, typed ? 'polar' : c.mode)))
  }
  /** 軌道 y= と結界 r= を切り替える（式の変数 x↔t も入れ替える）。 */
  const setKind = (next: 'rotate' | 'polar') => {
    props.onFocusChange('y')
    if (c.mode === next) return
    let body = swapExprVar(yBody, next === 'polar' ? 't' : 'x')
    // 直線 y=0 のまま結界にすると半径 0（張れない）になるので、既定の円を入れておく
    if (next === 'polar' && (body.trim() === '' || body.trim() === '0')) body = '6'
    onChange(yTextPatch(yTextOf(body, next)))
  }

  /** 記号盤：いま編集中の欄のキャレット位置へ記号を差し込む。 */
  const insert = (token: string) => {
    const input = onZ ? zRef.current : yRef.current
    const cur = onZ ? c.zText : yBody
    let s = cur.length
    let e = cur.length
    if (input && input.selectionStart != null) {
      s = input.selectionStart
      e = input.selectionEnd ?? s
    }
    let next: string
    let caret: number
    if (token === '←') {
      if (s !== e) {
        next = cur.slice(0, s) + cur.slice(e)
        caret = s
      } else {
        next = cur.slice(0, Math.max(0, s - 1)) + cur.slice(s)
        caret = Math.max(0, s - 1)
      }
    } else if (token === 'CLR') {
      next = ''
      caret = 0
    } else {
      next = cur.slice(0, s) + token + cur.slice(e)
      caret = s + token.length
    }
    if (onZ) setZ(next)
    else setY(next)
    setTimeout(() => {
      if (!input) return
      input.focus()
      try {
        input.setSelectionRange(caret, caret)
      } catch {
        /* 対応していないブラウザは無視 */
      }
    }, 0)
  }

  const applySpell = (expr: string, kind: 'y' | 'ward' | 'z') => {
    if (kind === 'z') setZ(expr)
    else setY(yTextOf(expr, kind === 'ward' ? 'polar' : 'rotate'))
  }

  // 係数スライダーは結界（r=f(θ)）でも出す。setCoeffPatch が mode に応じて接頭辞を付け直す（#68）
  const canFit = c.fitParams.length > 0
  const aim = `${((c.angle * 180) / Math.PI).toFixed(0)}°`

  return (
    <div className="spell-console">
      {/* y = f(x)／結界 r = f(θ)。接頭辞はタグ側が持つ */}
      <div className="expr-row">
        <button
          type="button"
          className={`expr-tag kind-tag ${ward ? 'ward' : 'y'}`}
          onClick={() => setKind(ward ? 'rotate' : 'polar')}
          title={ward ? '押すと軌道 y= に戻る' : '押すと結界 r= に切り替える'}
          aria-label={ward ? '結界 r=（押すと軌道 y= に切り替え）' : '軌道 y=（押すと結界 r= に切り替え）'}
        >
          <span className="kind-now">{ward ? 'r=' : 'y='}</span>
          <span className="kind-swap">⇄</span>
        </button>
        <input
          ref={yRef}
          className={`expr-input y${c.freeError ? ' invalid' : ''}${!onZ ? ' focused' : ''}`}
          value={yBody}
          onChange={(e) => setY(e.target.value)}
          onFocus={() => props.onFocusChange('y')}
          spellCheck={false}
          autoComplete="off"
          placeholder={ward ? '6 + 1.6*cos(3*t)　（t = θ）' : '0.06*x^2 - 2'}
          aria-label={ward ? '結界の式 r = f(θ)' : '軌道の式 y = f(x)'}
        />
        <button
          type="button"
          className={`btn small draft-toggle${props.draftOpen ? ' selected' : ''}`}
          title="編集中の式を方眼紙で調整する"
          onClick={props.onToggleDraft}
        >
          作図 ⊹
        </button>
        <button
          type="button"
          className="btn small solve-angle"
          title="いまの f(x) が的の座標を通る θ を数値的に解く"
          onClick={props.onSolveAngle}
          disabled={props.solving || c.mode === 'polar'}
        >
          <span className="solve-label">θ 回転 <em>⟳ 解く</em></span>
          <span className="solve-value">{props.solving ? '…' : aim}</span>
        </button>
      </div>

      {/* z = g(t)（t＝術者からの距離） */}
      <div className="expr-row">
        <span className="expr-tag z">z=</span>
        <input
          ref={zRef}
          className={`expr-input z${c.zFreeError ? ' invalid' : ''}${onZ ? ' focused' : ''}`}
          value={c.zText}
          onChange={(e) => setZ(e.target.value)}
          onFocus={() => props.onFocusChange('z')}
          spellCheck={false}
          autoComplete="off"
          placeholder="5*exp(-((t-27)/6)^2)"
          aria-label="属性場の式 z = g(t)"
        />
        <span className="el-auto">
          <span className="k">属性 自動</span>
          <span className={`v tone-${el.tone}`}>{el.label}</span>
        </span>
      </div>

      <div className={`console-hint${c.freeError || c.zFreeError ? ' error' : ''}`}>
        {c.freeError ||
          c.zFreeError ||
          `z(t) は完全情報 — t=r（${readout.ray.kind === 'enemy' ? '敵' : '的'}まで ${readout.ray.d.toFixed(1)}）に強度の頂点を合わせる。命中するかは撃つまで分からない。`}
      </div>

      {/* z を編集中：整形（山/段/波/平）とスライダー */}
      {onZ && <ZFieldControls composer={c} onChange={onChange} rDistance={readout.ray.d} />}

      {/* y／r を編集中：式から自動検出した係数スライダー */}
      {!onZ && canFit && (
        <div className="coef-row">
          <CoefSliders
            params={c.fitParams}
            values={c.fitValues}
            onSet={(key, v) => onChange(setCoeffPatch(c, key, v))}
            onCommit={(key) => {
              const patch = recenterCoeffPatch(c, key)
              if (patch) onChange(patch)
            }}
          />
        </div>
      )}

      {/* 術式（スペルブック）。y のときは軌道／結界をトグルで出し分ける */}
      <div className="spellbook">
        {onZ ? (
          <span className="spellbook-label y">術式 · 属性場 z</span>
        ) : (
          <div className="kind-toggle" role="group" aria-label="術式の種類">
            <button
              type="button"
              className={`kind-btn y${ward ? '' : ' selected'}`}
              onClick={() => setKind('rotate')}
              title="弾を撃つ軌道 y=f(x)"
            >
              y= 軌道
            </button>
            <button
              type="button"
              className={`kind-btn ward${ward ? ' selected' : ''}`}
              onClick={() => setKind('polar')}
              title="弾を撃たず身を守る結界 r=f(θ)"
            >
              r= 結界
            </button>
          </div>
        )}
        <div className="spellbook-row">
          {(onZ ? Z_SPELLS : ward ? WARD_SPELLS : Y_SPELLS).map((sp) => (
            <button
              key={sp.name}
              type="button"
              className={`spell-chip${!onZ && ward ? ' ward' : ''}`}
              title={`${sp.title} ${onZ ? 'z' : ward ? 'r' : 'y'} = ${sp.expr}`}
              onClick={() => applySpell(sp.expr, onZ ? 'z' : ward ? 'ward' : 'y')}
            >
              <span className="nm">{sp.name}</span>
              <span className="fx">{sp.tag}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 記号盤（開閉は発射列の「記号盤」ボタン） */}
      {props.padOpen && (
        <div className="keypad">
          {PAD_KEYS.map((t, i) => (
            <button key={`${t}-${i}`} type="button" className={padKeyClass(t)} onClick={() => insert(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
