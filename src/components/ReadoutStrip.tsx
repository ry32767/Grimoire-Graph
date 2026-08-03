// 上部読み出しストリップ（DC プロトタイプ v3）。式エラー／暴発予告／命中予測／
// 結界の立ちはだかり を 1 行で出し分ける。盤面のすぐ上に置く「今なにが読めているか」の帯。
import type { Readout } from './readout'

export default function ReadoutStrip({ readout }: { readout: Readout }) {
  return (
    <div className={`readout-strip tone-${readout.tone}`} role="status" aria-live="polite">
      <span className="readout-title">{readout.title}</span>
      <span className="readout-sub">{readout.sub}</span>
    </div>
  )
}

/** 右レール／編集窓に出す 4 マスの読み取り値。 */
export function ReadoutStats({ readout }: { readout: Readout }) {
  return (
    <div className="readout-stats">
      <div className="readout-stats-head">解 · t=r（{readout.ray.label}）</div>
      <div className="readout-stats-grid">
        {readout.stats.map((s) => (
          <div key={s.key} className="readout-stat">
            <div className="k">{s.key}</div>
            <div className={`v tone-${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
