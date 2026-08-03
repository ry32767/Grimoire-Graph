// z(t) の「整形（正準形）」（DC プロトタイプ v3 の _zParse / _zGen）。
// z の式は自由入力だが、よく使う4つの形はスライダーで直接いじれるようにする。
//   山 h·exp(−((t−t₀)/w)²) ／ 段 h·u/√(w²+u²)（u=t−t₀）／ 波 h·sin((t−t₀)/w) ／ 平 h
// 変数は t（術者からの距離）。UI 専用の文字列処理なのでエンジンには置かない。
//
// 段（シグモイド）に tanh を使わないのは、このプロジェクトの mathjs が
// 必要な関数だけの限定インスタンス（mathEngine.ts）で、tanh を持たないため。
// 代数シグモイド u/√(w²+u²) は sqrt だけで書けて、±h に漸近する同じ形になる。

export type ZShapeKind = 'gauss' | 'step' | 'wave' | 'flat'

export interface ZShape {
  kind: ZShapeKind
  /** 高さ（符号が属性：+ 光 / − 闇） */
  h: number
  /** 頂点の距離 */
  t0: number
  /** 幅 */
  w: number
}

export const Z_SHAPE_LABEL: Record<ZShapeKind, string> = {
  gauss: '山',
  step: '段',
  wave: '波',
  flat: '平',
}

export const Z_SHAPE_DESC: Record<ZShapeKind, string> = {
  gauss: 't₀ の一点だけ強く帯びる。最大火力の定石',
  step: 't₀ で光↔闇が入れ替わる',
  wave: '周期で属性が入れ替わる',
  flat: 'どこでも同じ属性・同じ強度',
}

const NUM = '(\\d+(?:\\.\\d+)?)'
const PATTERNS: [ZShapeKind, RegExp][] = [
  ['gauss', new RegExp(`^(-?)${NUM}\\*?exp\\(-\\(\\(t-${NUM}\\)/${NUM}\\)\\^2\\)$`)],
  ['step', new RegExp(`^(-?)${NUM}\\*?\\(t-${NUM}\\)/sqrt\\(${NUM}\\^2\\+\\(t-\\3\\)\\^2\\)$`)],
  ['wave', new RegExp(`^(-?)${NUM}\\*?sin\\(\\(t-${NUM}\\)/${NUM}\\)$`)],
]

/** 式が正準形なら {kind,h,t0,w} を返す。自由式なら null（＝スライダーは効かない）。 */
export function parseZShape(src: string): ZShape | null {
  const s = (src ?? '').replace(/\s+/g, '')
  for (const [kind, re] of PATTERNS) {
    const m = s.match(re)
    if (m) {
      return {
        kind,
        h: (m[1] === '-' ? -1 : 1) * Number.parseFloat(m[2]),
        t0: Number.parseFloat(m[3]),
        w: Number.parseFloat(m[4]),
      }
    }
  }
  const flat = s.match(/^(-?\d+(?:\.\d+)?)$/)
  if (flat) return { kind: 'flat', h: Number.parseFloat(flat[1]), t0: 20, w: 6 }
  return null
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** 正準形の式文字列を作る（mathjs が読める形。`*` は明示する）。 */
export function genZShape(kind: ZShapeKind, h: number, t0: number, w: number): string {
  const H = round1(h)
  const T = round1(t0)
  const W = Math.max(0.5, round1(w))
  if (kind === 'flat' || Math.abs(H) < 0.05) return String(kind === 'flat' ? H : 0)
  // 代数シグモイド：t₀ で 0、±∞ で ±H に漸近（tanh 相当の形を sqrt だけで書く）
  if (kind === 'step') return `${H}*(t - ${T})/sqrt(${W}^2 + (t - ${T})^2)`
  if (kind === 'wave') return `${H}*sin((t - ${T})/${W})`
  return `${H}*exp(-((t - ${T})/${W})^2)`
}

/** 既存の式を保ったまま一部だけ差し替える（自由式なら山形の既定値から作り直す）。 */
export function patchZShape(src: string, patch: Partial<ZShape>): string {
  const cur = parseZShape(src) ?? { kind: 'gauss' as ZShapeKind, h: 5, t0: 20, w: 6 }
  const next = { ...cur, ...patch }
  return genZShape(next.kind, next.h, next.t0, next.w)
}
