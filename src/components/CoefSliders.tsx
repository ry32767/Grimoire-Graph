// 係数スライダー（式中の数値リテラルを1本ずつ動かす）。詠唱コンソールと作図台で共有する。
// 端まで振り切って手を離すと、呼び出し側が レンジを取り直す（つまみが中央へ戻る・#67）。
import type { DetectedParam } from '../game/exprFit'

interface Props {
  params: DetectedParam[]
  values: Record<string, number>
  /** つまみを動かしている間（値だけ更新する） */
  onSet: (key: string, value: number) => void
  /** 操作を終えた時（ここでレンジを取り直す。ドラッグ中に呼ぶと際限なく走る） */
  onCommit: (key: string) => void
}

export default function CoefSliders({ params, values, onSet, onCommit }: Props) {
  return (
    <>
      {params.map((p) => (
        <div className="coef-ctrl" key={p.key}>
          <span className="coef-label">{p.label}</span>
          <span className="coef-val">{(values[p.key] ?? p.value).toFixed(2)}</span>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={values[p.key] ?? p.value}
            onChange={(e) => onSet(p.key, Number(e.target.value))}
            onPointerUp={() => onCommit(p.key)}
            onKeyUp={() => onCommit(p.key)}
            onBlur={() => onCommit(p.key)}
            aria-label={`係数 ${p.label}`}
          />
        </div>
      ))}
    </>
  )
}
