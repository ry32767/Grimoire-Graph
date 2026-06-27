// チュートリアル／初心者ガイド（機能16）。図つきページ送りで分かりやすく。
import { useState, type ReactNode } from 'react'

const GOLD = '#f4c430'
const PURPLE = '#7b5cc4'
const CREAM = '#fff8e1'
const GREY = '#9aa'
const DIM = '#b9aedd'

/** z=関数値 の曲線（符号で色分け）を描く図。 */
function ZCurve({ showZones = false }: { showZones?: boolean }) {
  const axisY = 78
  const pts: { x: number; y: number }[] = []
  for (let x = 18; x <= 282; x += 6) {
    pts.push({ x, y: axisY - 46 * Math.sin((x - 18) / 40) })
  }
  return (
    <svg viewBox="0 0 300 150" width="100%" height="150" role="img" aria-label="関数の値zで属性が決まる図">
      <rect x="0" y="0" width="300" height="150" fill="#0d0b14" />
      {/* 中立帯 */}
      <rect x="0" y={axisY - 7} width="300" height="14" fill="rgba(150,150,160,0.18)" />
      <line x1="0" y1={axisY} x2="300" y2={axisY} stroke="#3a3470" strokeWidth="2" />
      {pts.slice(1).map((p, i) => {
        const a = pts[i]
        const mid = (a.y + p.y) / 2
        const near = Math.abs(mid - axisY) < 7
        const col = near ? GREY : mid < axisY ? GOLD : PURPLE
        return <line key={i} x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke={col} strokeWidth={near ? 2 : 4} strokeLinecap="round" />
      })}
      <text x="6" y="20" fill={GOLD} fontSize="11">z＞0 光</text>
      <text x="6" y="142" fill={PURPLE} fontSize="11">z＜0 闇</text>
      <text x="120" y={axisY - 10} fill={GREY} fontSize="10">z≈0 中立</text>
      {showZones && (
        <>
          <text x="150" y="20" fill={CREAM} fontSize="10">中立帯=加速</text>
          <text x="210" y="138" fill={CREAM} fontSize="10">強く帯びる=威力</text>
        </>
      )}
    </svg>
  )
}

function TurnFlow() {
  const box = (x: number, label: string, color: string) => (
    <g>
      <rect x={x} y="45" width="78" height="46" rx="4" fill="#14101e" stroke={color} strokeWidth="2" />
      <text x={x + 39} y="72" fill={CREAM} fontSize="11" textAnchor="middle">{label}</text>
    </g>
  )
  const arrow = (x: number) => <text x={x} y="74" fill={DIM} fontSize="18">→</text>
  return (
    <svg viewBox="0 0 300 150" width="100%" height="150" role="img" aria-label="ターンの流れ">
      <rect width="300" height="150" fill="#0d0b14" />
      {box(8, '敵が公開', PURPLE)}
      {arrow(90)}
      {box(110, '自分が作成', GOLD)}
      {arrow(192)}
      {box(212, '同時発射→解決', CREAM)}
      <text x="150" y="120" fill={DIM} fontSize="11" textAnchor="middle">敵の弾(紫の点線)を見てから組み立てる</text>
    </svg>
  )
}

function Affinity() {
  return (
    <svg viewBox="0 0 300 150" width="100%" height="150" role="img" aria-label="属性相性">
      <rect width="300" height="150" fill="#0d0b14" />
      <circle cx="60" cy="75" r="16" fill={GOLD} />
      <text x="60" y="110" fill={GOLD} fontSize="11" textAnchor="middle">光の弾</text>
      <text x="150" y="70" fill={CREAM} fontSize="22" textAnchor="middle">→</text>
      <text x="150" y="100" fill={CREAM} fontSize="14" textAnchor="middle">×1.5</text>
      <rect x="224" y="59" width="32" height="32" fill={PURPLE} />
      <text x="240" y="110" fill={PURPLE} fontSize="11" textAnchor="middle">闇の敵</text>
      <text x="150" y="135" fill={DIM} fontSize="11" textAnchor="middle">反対の理=×1.5 / 同極=×0.5</text>
    </svg>
  )
}

function Mechanics() {
  return (
    <svg viewBox="0 0 300 150" width="100%" height="150" role="img" aria-label="各メカニクス">
      <rect width="300" height="150" fill="#0d0b14" />
      {/* 暴発 */}
      <g>
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2
          return <line key={i} x1={48} y1={50} x2={48 + Math.cos(a) * 16} y2={50 + Math.sin(a) * 16} stroke={i % 2 ? PURPLE : GOLD} strokeWidth="2" />
        })}
        <text x="48" y="86" fill={CREAM} fontSize="10" textAnchor="middle">暴発</text>
      </g>
      {/* 結界 */}
      <g>
        <circle cx="130" cy="50" r="18" fill="none" stroke="#8ab0ff" strokeWidth="3" />
        <circle cx="130" cy="50" r="3" fill={GOLD} />
        <text x="130" y="86" fill={CREAM} fontSize="10" textAnchor="middle">結界</text>
      </g>
      {/* パリィ */}
      <g>
        <line x1="196" y1="36" x2="224" y2="64" stroke={GOLD} strokeWidth="3" />
        <line x1="224" y1="36" x2="196" y2="64" stroke={PURPLE} strokeWidth="3" />
        <text x="210" y="86" fill={CREAM} fontSize="10" textAnchor="middle">パリィ</text>
      </g>
      {/* 障害物 */}
      <g>
        <rect x="262" y="36" width="26" height="26" fill="rgba(138,123,191,0.5)" stroke="#8a7bbf" strokeWidth="2" />
        <text x="275" y="86" fill={CREAM} fontSize="10" textAnchor="middle">障害物</text>
      </g>
      <text x="150" y="120" fill={DIM} fontSize="11" textAnchor="middle">同極はすり抜け、反対極は相殺。柱は避けるか壊す。</text>
    </svg>
  )
}

interface Page {
  title: string
  diagram: ReactNode
  body: ReactNode
}

const PAGES: Page[] = [
  {
    title: '① ターンの流れ',
    diagram: <TurnFlow />,
    body: (
      <p>
        まず<strong>敵が術式（関数）を公開</strong>します（紫の点線＝ゴースト）。それを見てから
        <strong>自分の関数を組み</strong>、「発射」で<strong>両者同時に</strong>解決します。
      </p>
    ),
  },
  {
    title: '② 関数の値が光と闇になる',
    diagram: <ZCurve />,
    body: (
      <p>
        術式は<strong>関数そのものが3次元（高さ z）</strong>。関数の値が<strong>正なら光・負なら闇</strong>、
        0 から離れるほど強く帯びます。軌道は関数のグラフで、線の色がその理（金=光／紫=闇／淡=中立）。
      </p>
    ),
  },
  {
    title: '③ 中立で加速・強属性で威力',
    diagram: <ZCurve showZones />,
    body: (
      <p>
        値が 0 に近い<strong>中立帯ほど弾が加速</strong>します。<strong>威力 = 命中時の速度 × 強度(|z|)</strong>。
        原点近くの中立で加速して、当てる瞬間に強く帯びさせる（関数値を大きくする）のがコツ。
        平らな関数（値0）はよく加速しますが威力は出ません。
      </p>
    ),
  },
  {
    title: '④ 属性の相性',
    diagram: <Affinity />,
    body: (
      <p>
        反対の理（光↔闇）に当てると<strong>×1.5</strong>、同極は×0.5。敵の属性（色）を見て、
        反対の理を強く帯びた関数で弱点を突こう。
      </p>
    ),
  },
  {
    title: '⑤ 暴発・結界・パリィ・障害物',
    diagram: <Mechanics />,
    body: (
      <p>
        関数がエラー（発散・場外）になると<strong>暴発</strong>＝光と闇を最大で放つ切り札（
        <code>1/x</code> は足元で自爆注意）。<strong>結界</strong>で敵弾を止め、敵弾とは
        <strong>反対の理同士で相殺（パリィ）</strong>。障害物は避けるか壊す。
      </p>
    ),
  },
  {
    title: '⑥ 操作のヒント',
    diagram: <Affinity />,
    body: (
      <ul className="tip-list">
        <li>プリセットを選び、スライダーで形を整え、θ（角度）と初速を決める。</li>
        <li>発射するまで何度でも調整でき、確定するまでターンは進みません。</li>
        <li>「困ったらこれ」で無難に当たるおすすめ関数をワンタップ。</li>
        <li>「図鑑」で各関数の式・見た目・使いどころを確認できます。</li>
      </ul>
    ),
  },
]

export default function Guide({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0)
  const p = PAGES[page]
  const last = PAGES.length - 1
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>はじめての術式ガイド</h2>
          <button className="btn small" onClick={onClose}>
            閉じる
          </button>
        </div>
        <h3 className="guide-title">{p.title}</h3>
        <div className="guide-diagram">{p.diagram}</div>
        <div className="guide-body">{p.body}</div>
        <div className="guide-nav">
          <button className="btn small" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
            ← 戻る
          </button>
          <span className="guide-dots">
            {PAGES.map((_, i) => (
              <span key={i} className={`dot${i === page ? ' on' : ''}`} />
            ))}
          </span>
          {page < last ? (
            <button className="btn small primary" onClick={() => setPage((n) => n + 1)}>
              次へ →
            </button>
          ) : (
            <button className="btn small primary" onClick={onClose}>
              はじめる！
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
