// ObstacleForm が種別ごとに使い回す共通入力部品（#67 §4.1/§4.3）。
import type { Attribute, ObstacleKind } from '../game/types'

const ELEMENTS: Attribute[] = ['light', 'dark', 'neutral']
const ELEMENT_LABELS: Record<Attribute, string> = { light: '光', dark: '闇', neutral: '無属性' }
const KINDS: ObstacleKind[] = ['normal', 'fragile', 'tough', 'unbreakable']
const KIND_LABELS: Record<ObstacleKind, string> = {
  normal: '通常（normal）',
  fragile: '壊れやすい（fragile）',
  tough: '硬い（tough）',
  unbreakable: '不壊（unbreakable）',
}

/** 属性プルダウン。 */
export function ElementSelect({ value, onChange }: { value: Attribute; onChange: (v: Attribute) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Attribute)}>
      {ELEMENTS.map((el) => (
        <option key={el} value={el}>
          {ELEMENT_LABELS[el]}
        </option>
      ))}
    </select>
  )
}

/**
 * 種別（耐久）プルダウン。fallback は「未指定（undefined）」時に実際に使われる既定値
 * （pillar/block/wall/ring は normal、roomWalls/roomWallsOpenEnds は unbreakable・stageBuilders 側の既定と一致させる）。
 * 選択値が fallback と一致するときは onChange(undefined) にして「未指定＝既定」を保つ。
 */
export function KindSelect({
  value,
  fallback,
  onChange,
}: {
  value?: ObstacleKind
  fallback: ObstacleKind
  onChange: (v?: ObstacleKind) => void
}) {
  return (
    <select
      value={value ?? fallback}
      onChange={(e) => {
        const v = e.target.value as ObstacleKind
        onChange(v === fallback ? undefined : v)
      }}
    >
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {KIND_LABELS[k]}
        </option>
      ))}
    </select>
  )
}

/** ラベル付き数値入力。 */
export function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
