// 敵の強さ＝最適化できる式の複雑さ（#70・05b §2.1）の回帰テスト。
// 「より強い敵ほど、より複雑な式で経路に密着できる」ことを数値で固定する：
//   ① 多項式の次数（1次 → 2次 → 3〜5次 → 7次）
//   ② |x−h| の折れ点の枚数（1枚 → 何枚も重ねる）
//   ③ sin/cos/exp を掛け合わせた包絡（積の因子）の本数
import { describe, it, expect } from 'vitest'
import { fitRouteToFamilies, type FitResult } from './routeFit'
import { fitComplexityFor } from './fitComplexity'
import { parseExpression } from '../functions'
import type { Vec2 } from '../types'

const origin: Vec2 = { x: 0, y: 0 }
/** 柱の隙間を右へ左へ縫うジグザグ経路（曲がり角が4つ＝低次では表せない） */
const zigzag: Vec2[] = [
  origin,
  { x: 8, y: 7 },
  { x: 16, y: -7 },
  { x: 24, y: 6 },
  { x: 32, y: -6 },
  { x: 40, y: 0 },
]

/**
 * フィット結果が経路そのものからどれだけ外れるか（RMSE）。
 * 経路は原点→(40,0) が +x 軸なので、局所 y は折れ線を x で線形補間した値になる。
 */
function routeRmse(fit: FitResult): number {
  const yAt = (x: number): number => {
    for (let i = 1; i < zigzag.length; i++) {
      const a = zigzag[i - 1]
      const b = zigzag[i]
      if (x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
    }
    return zigzag[zigzag.length - 1].y
  }
  let sum = 0
  let n = 0
  for (let x = 0; x <= 40; x += 1) {
    const e = fit.g(x) - yAt(x)
    sum += e * e
    n++
  }
  return Math.sqrt(sum / n)
}

/** 系統を絞った最良フィット（経路への当てはまりが最小のもの）。 */
function bestRmse(level: number, families: readonly ('arc' | 'poly34' | 'abs' | 'harmonic')[]): number {
  const fits = fitRouteToFamilies(zigzag, origin, families, fitComplexityFor(level))
  expect(fits.length).toBeGreaterThan(0)
  return Math.min(...fits.map(routeRmse))
}

describe('敵の強さ＝最適化できる式の複雑さ（#70）', () => {
  it('多項式：弱い敵は1〜2次まで、強い敵ほど高次（最大7次）を使う', () => {
    const degOf = (level: number): number[] =>
      fitRouteToFamilies(zigzag, origin, ['poly34'], fitComplexityFor(level)).map(
        (f) => (f.expr.match(/\^(\d+)/g) ?? []).reduce((m, s) => Math.max(m, Number(s.slice(1))), 1),
      )
    expect(Math.max(...degOf(2))).toBe(2) // LVL1〜2：直線と放物線だけ
    expect(Math.max(...degOf(3))).toBe(3) // LVL3〜4：3次まで
    expect(Math.max(...degOf(6))).toBe(5) // LVL5〜6：5次まで
    expect(Math.max(...degOf(7))).toBe(7) // LVL7（ボス級）：7次まで
  })

  it('強いほど経路に密着できる（弱い敵はジグザグをまるで表せない）', () => {
    const fams = ['arc', 'abs', 'poly34', 'harmonic'] as const
    const weak = bestRmse(2, fams)
    const mid = bestRmse(3, fams)
    const strong = bestRmse(6, fams)
    const boss = bestRmse(7, fams)
    expect(mid).toBeLessThan(weak)
    expect(strong).toBeLessThan(mid)
    expect(boss).toBeLessThan(strong)
    // 1〜2次・V字1枚では曲がり角4つのジグザグは表せない（大きく外れる）
    expect(weak).toBeGreaterThan(3)
    // ボス級は経路のすぐそばを通る＝隙間を実際に縫える
    expect(boss).toBeLessThan(2)
    // 多項式だけで見ても、次数の解禁とともに当てはまりが良くなる
    expect(bestRmse(6, ['poly34'])).toBeLessThan(bestRmse(3, ['poly34']))
    expect(bestRmse(3, ['poly34'])).toBeLessThan(bestRmse(2, ['poly34']))
  })

  it('折れ（abs）：弱い敵はV字1枚、強い敵は折れ点を何枚も重ねる', () => {
    const foldsOf = (level: number): number =>
      Math.max(
        ...fitRouteToFamilies(zigzag, origin, ['abs'], fitComplexityFor(level)).map(
          (f) => (f.expr.match(/abs\(/g) ?? []).length,
        ),
      )
    expect(foldsOf(2)).toBe(1) // 単一のV字
    expect(foldsOf(6)).toBeGreaterThanOrEqual(2)
    expect(foldsOf(7)).toBeGreaterThanOrEqual(3) // ボス級：何枚も重ねた折れ線
    // 折れ点は壁内折れ点検査（§9.3）へ渡るので、重ねた枚数だけ turnXs にも出る
    const bossFit = fitRouteToFamilies(zigzag, origin, ['abs'], fitComplexityFor(7))[0]
    expect(bossFit.turnXs.length).toBeGreaterThanOrEqual(3)
    expect(bestRmse(7, ['abs'])).toBeLessThan(bestRmse(2, ['abs']))
  })

  it('多重サイン：強い敵は exp・cos を掛け合わせた包絡つきの式まで試せる', () => {
    const fitsOf = (level: number): FitResult[] =>
      fitRouteToFamilies(zigzag, origin, ['harmonic'], fitComplexityFor(level))
    expect(fitsOf(2)).toHaveLength(1) // 弱い敵は積なしの単一候補
    expect(fitsOf(6).length).toBeGreaterThan(fitsOf(2).length)
    const boss = fitsOf(7)
    expect(boss.length).toBeGreaterThan(fitsOf(6).length)
    // 積の因子（exp / cos）を掛けた式が候補に含まれる
    expect(boss.some((f) => f.expr.includes('exp('))).toBe(true)
    expect(boss.some((f) => f.expr.includes('cos('))).toBe(true)
    // 積にしても sin 側が両端で 0＝狙点は必ず通る（#69 の不変条件を壊さない）
    for (const f of boss) {
      expect(Math.abs(f.g(0))).toBeLessThan(1e-9)
      expect(Math.abs(f.g(f.goalX))).toBeLessThan(1e-9)
    }
  })

  it('返す式（自由入力へ転記する形）は g と一致する＝評価した軌道と食い違わない', () => {
    for (const level of [2, 3, 6, 7]) {
      const fits = fitRouteToFamilies(zigzag, origin, ['arc', 'abs', 'poly34', 'harmonic'], fitComplexityFor(level))
      expect(fits.length).toBeGreaterThan(0)
      for (const f of fits) {
        const ev = parseExpression(f.expr, 'x')
        expect(ev, `${f.family}: ${f.expr}`).not.toBeNull()
        for (let x = 0; x <= f.goalX; x += 2.5) {
          expect(Math.abs(ev!(x) - f.g(x))).toBeLessThan(1e-4)
        }
      }
    }
  })
})
