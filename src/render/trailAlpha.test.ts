// 軌跡ドットの濃さ規則の回帰テスト（光＝パッと点く／闇＝遅れて滲み出て尾が長く残る）。
// 戦闘アニメ（board.drawFlightPath）とエンドロールが同じ見た目になるよう、
// `trailDotAlpha` 1か所に集約した規則をここで固定する。
import { describe, expect, it } from 'vitest'
import { trailDotAlpha } from './board'

describe('trailDotAlpha（軌跡ドットの濃さ）', () => {
  it('光は闇より、頭寄り（head=0.6付近）で濃い', () => {
    const light = trailDotAlpha(1, 0.6)
    const dark = trailDotAlpha(-1, 0.6)
    expect(light).toBeGreaterThan(dark)
  })

  it('闇は頭の直近（head=0.95）で光より薄い＝遅れて現れる', () => {
    const light = trailDotAlpha(1, 0.95)
    const dark = trailDotAlpha(-1, 0.95)
    expect(dark).toBeLessThan(light)
  })

  it('闇は尾（head=0.1）で光より濃い＝長く残る', () => {
    const light = trailDotAlpha(1, 0.1)
    const dark = trailDotAlpha(-1, 0.1)
    expect(dark).toBeGreaterThan(light)
  })

  it('無は現状どおりの3段を返す', () => {
    expect(trailDotAlpha(0, 0.8)).toBeCloseTo(0.75)
    expect(trailDotAlpha(0, 0.5)).toBeCloseTo(0.5)
    expect(trailDotAlpha(0, 0.1)).toBeCloseTo(0.25)
  })

  it('返り値は常に0〜1', () => {
    for (const z of [-3, -1, 0, 1, 3]) {
      for (let head = 0; head <= 1; head += 0.1) {
        const a = trailDotAlpha(z, head)
        expect(a).toBeGreaterThanOrEqual(0)
        expect(a).toBeLessThanOrEqual(1)
      }
    }
  })
})
