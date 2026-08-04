// Canvas 描画用パレット。値は src/styles/tokens.css と同一（DESIGN.md 正典）。
// tokens.css は CSS カスタムプロパティのため Canvas からは直接参照できず、
// ここに TS 定数として複製する（DESIGN.md §7：ビルド時 or 手動同期の一元置き場）。
export const TOKENS = {
  bg: '#08070f',
  arenaBg: '#0d0b16',
  win: '#17132a',
  win2: '#100c1e',

  edgeDark: '#05040a',
  edgeLite: '#7d8fc4',
  cursor: '#9fb3ff',

  light: '#f4c430',
  lightSoft: '#fff3c4',
  dark: '#8a6fd6',
  darkSoft: '#362a66',

  text: '#eef0fb',
  textDim: '#8b8fae',
  hpOk: '#6bd58c',
  hpLow: '#e2596b',
  warn: '#e2a04a',
} as const

/** 盤面グリッド・座標軸（DESIGN.md §4.3）。 */
export const ARENA = {
  gridLine: 'rgba(125,143,196,0.09)',
  axisLine: 'rgba(125,143,196,0.20)',
  originFill: TOKENS.cursor,
  originStroke: TOKENS.edgeDark,
  lightGlow: 'rgba(244,196,48,0.08)',
  darkGlow: 'rgba(138,111,214,0.12)',
} as const
