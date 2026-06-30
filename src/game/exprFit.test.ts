import { describe, it, expect } from 'vitest'
import {
  detectParams,
  initialValues,
  renderExpr,
  buildParamFn,
  fitToPoints,
} from './exprFit'
import { parseExpression } from './functions'

describe('係数の自動検出（数値リテラル）', () => {
  it('式中の数値を係数化し、べき指数は除外する', () => {
    const spec = detectParams('2*sin(0.6*x) + 1 - 3*x^2', 'x')!
    expect(spec).not.toBeNull()
    // 2, 0.6, 1, 3 の4つ（x^2 の 2 は除外）
    expect(spec.params.map((p) => p.value)).toEqual([2, 0.6, 1, 3])
    expect(spec.template).toContain('p0')
    expect(spec.template).toContain('x ^ 2')
  })

  it('数値が無い式は係数0個（テンプレート＝元式相当）', () => {
    const spec = detectParams('sin(x)', 'x')!
    expect(spec.params.length).toBe(0)
  })

  it('不正な式は null', () => {
    expect(detectParams('2*sin(', 'x')).toBeNull()
  })

  it('スライダー範囲は値を含み、step は正', () => {
    const spec = detectParams('5*x', 'x')!
    const p = spec.params[0]
    expect(p.min).toBeLessThan(5)
    expect(p.max).toBeGreaterThan(5)
    expect(p.step).toBeGreaterThan(0)
  })
})

describe('係数値の反映（renderExpr / buildParamFn）', () => {
  it('係数値を変えると式文字列に反映される', () => {
    const spec = detectParams('1*x + 0', 'x')!
    const expr = renderExpr(spec, { p0: 3, p1: 2 })
    // 3*x + 2 と評価が一致する
    const f = parseExpression(expr, 'x')!
    expect(f(0)).toBeCloseTo(2)
    expect(f(2)).toBeCloseTo(8)
  })

  it('buildParamFn は係数値で評価する', () => {
    const spec = detectParams('2*x + 1', 'x')!
    const f = buildParamFn(spec, { p0: 4, p1: -3 })!
    expect(f(0)).toBeCloseTo(-3)
    expect(f(1)).toBeCloseTo(1)
  })
})

describe('通過点フィット（最小二乗・射出魔法）', () => {
  it('直線 a*x の傾きを点群に合わせる（原点・角度0）', () => {
    // 目標：傾き2の点群。初期は a=1。
    // 注：回転軌道は g(0) を引いて術者位置から発射するため、加算定数 b は経路に効かない（既存仕様）。
    const spec = detectParams('1*x', 'x')!
    const origin = { x: 0, y: 0 }
    const points = [
      { x: 2, y: 4 },
      { x: 5, y: 10 },
      { x: 8, y: 16 },
    ] // y=2x 上の点
    const fitted = fitToPoints(spec, initialValues(spec), 0, origin, points)
    expect(fitted.p0).toBeGreaterThan(1.7)
    expect(fitted.p0).toBeLessThan(2.3)
  })

  it('フィット後は点群との距離二乗和が初期より小さい', () => {
    const spec = detectParams('0.1*x^2 + 0', 'x')!
    const origin = { x: 0, y: 0 }
    const points = [
      { x: 3, y: 4.5 },
      { x: 6, y: 18 },
    ] // y=0.5x^2 上
    const before = initialValues(spec)
    const after = fitToPoints(spec, before, 0, origin, points)
    // p0 が 0.1 から 0.5 方向へ動く
    expect(after.p0).toBeGreaterThan(before.p0)
  })

  it('点が無ければ係数は変わらない', () => {
    const spec = detectParams('1*x + 0', 'x')!
    const v = initialValues(spec)
    expect(fitToPoints(spec, v, 0, { x: 0, y: 0 }, [])).toEqual(v)
  })

  it('高次多項式（4次）を5点へ精密フィットできる（LM・係数の桁違いに強い）', () => {
    // 目標の4次曲線（角度0・原点(-14,-20)）から実際に通る5点をサンプルし、
    // 別の初期係数からその点群へフィットして「ほぼ通る」ことを確認する。
    const origin = { x: -14, y: -20 }
    const target = detectParams('0.0008*x^4 - 0.045*x^3 + 0.7*x^2 - 2*x', 'x')!
    const gT = buildParamFn(target, initialValues(target))!
    const pts = [8, 16, 24, 32, 40].map((x) => ({
      x: origin.x + x,
      y: origin.y + (gT(x) - gT(0)),
    }))
    const spec = detectParams('0.0008*x^4 - 0.02*x^3 + 0.2*x^2 + 0.5*x', 'x')!
    const fitted = fitToPoints(spec, initialValues(spec), 0, origin, pts)
    const g = buildParamFn(spec, fitted)!
    // 各点で g(x)−g(0) が目標の縦オフセットにほぼ一致（残差 < 0.2 ユニット）
    for (const x of [8, 16, 24, 32, 40]) {
      const want = gT(x) - gT(0)
      expect(Math.abs(g(x) - g(0) - want)).toBeLessThan(0.2)
    }
  })
})
