/** 描画専用。戦闘時間・威力・当たり半径は変更しない。 */
export const SPELL_VFX = {
  colors: { light: '#f4c65a', dark: '#957dff', neutral: '#96a0b4', core: '#fff6e0' },
  cast: { steps: 8, sectors: 8, dotsPerSector: 4, radius: 26, innerRatio: 0.65, gatherEnd: 0.375 },
  impact: { steps: 9, minRadius: 36, maxRadius: 55, echoDelay: 0.18, fragments: 12, coreEnd: 0.4 },
  wake: { count: 7, stride: 2, minPower: 0.12, phaseSteps: 8 },
} as const
