import { describe, it, expect } from 'vitest'
import {
  detectParams,
  initialValues,
  renderExpr,
  buildParamFn,
  fitToPoints,
  type ParamSpec,
  type ParamValues,
} from './exprFit'
import { parseExpression } from './functions'
import { sampleTrajectory, validFinitePrefix } from './coords'
import type { Trajectory, Vec2 } from './types'

// 係数値・角度・原点から軌道（場内の世界座標列）を作る
function trajPoly(spec: ParamSpec, values: ParamValues, angle: number, origin: Vec2): Vec2[] {
  const g = buildParamFn(spec, values)!
  return validFinitePrefix(sampleTrajectory({ mode: 'rotate', g, angle, origin } as Trajectory)).map((s) => s.pos)
}
// 折れ線上で点 p に最も近いサンプルの { 距離, index }
function closest(poly: Vec2[], p: Vec2): { dist: number; idx: number } {
  let best = Infinity
  let bi = 0
  for (let i = 0; i < poly.length; i++) {
    const d = Math.hypot(poly[i].x - p.x, poly[i].y - p.y)
    if (d < best) {
      best = d
      bi = i
    }
  }
  return { dist: best, idx: bi }
}
// 目標式を角度0・原点からサンプルして「実際に通る点列」を作る
function pointsOnCurve(expr: string, origin: Vec2, xs: number[]): Vec2[] {
  const spec = detectParams(expr, 'x')!
  const g = buildParamFn(spec, initialValues(spec))!
  return xs.map((x) => ({ x: origin.x + x, y: origin.y + (g(x) - g(0)) }))
}

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
  it('点が無ければ係数は変わらない', () => {
    const spec = detectParams('1*x + 0', 'x')!
    const v = initialValues(spec)
    expect(fitToPoints(spec, v, 0, { x: 0, y: 0 }, [])).toEqual({ values: v, angle: 0 })
  })

  it('1点でも、その点を通る向きへ直線を合わせる', () => {
    const spec = detectParams('1*x', 'x')!
    const origin = { x: -14, y: -20 }
    const p = { x: 6, y: -6 }
    const res = fitToPoints(spec, initialValues(spec), 0, origin, [p])
    const poly = trajPoly(spec, res.values, res.angle, origin)
    expect(closest(poly, p).dist).toBeLessThan(0.6)
  })

  it('高次多項式（4次）を5点へ精密フィットできる', () => {
    const origin = { x: -14, y: -20 }
    const pts = pointsOnCurve('0.0008*x^4 - 0.045*x^3 + 0.7*x^2 - 2*x', origin, [8, 16, 24, 32, 40])
    const spec = detectParams('0.0008*x^4 - 0.02*x^3 + 0.2*x^2 + 0.5*x', 'x')!
    const res = fitToPoints(spec, initialValues(spec), 0, origin, pts)
    const poly = trajPoly(spec, res.values, res.angle, origin)
    for (const p of pts) expect(closest(poly, p).dist).toBeLessThan(0.6)
  })

  it('サイン関数を点群へフィットできる（多スタートで周波数を当てる）', () => {
    const origin = { x: 0, y: 0 }
    const pts = pointsOnCurve('4*sin(0.4*x)', origin, [1, 3, 5, 7, 9, 11, 13])
    // 初期は周波数違い（B=1.2）。多スタート LM で 0.4 付近へ
    const spec = detectParams('4*sin(0.4*x)', 'x')!
    const res = fitToPoints(spec, { p0: 4, p1: 1.2, p2: 0 }, 0, origin, pts)
    const poly = trajPoly(spec, res.values, res.angle, origin)
    for (const p of pts) expect(closest(poly, p).dist).toBeLessThan(1.0)
  })

  it('指数関数を点群へフィットできる', () => {
    const origin = { x: 0, y: 0 }
    const pts = pointsOnCurve('1.5*exp(0.25*x) - 1.5', origin, [1, 3, 5, 7, 9])
    const spec = detectParams('1*exp(0.1*x) - 1', 'x')!
    const res = fitToPoints(spec, initialValues(spec), 0, origin, pts)
    const poly = trajPoly(spec, res.values, res.angle, origin)
    for (const p of pts) expect(closest(poly, p).dist).toBeLessThan(1.0)
  })

  it('1/x（分数関数）を点群へフィットできる', () => {
    const origin = { x: 0, y: 0 }
    const pts = pointsOnCurve('12/(x + 4) - 3', origin, [1, 3, 5, 8, 12])
    const spec = detectParams('8/(x + 6) - 1', 'x')!
    const res = fitToPoints(spec, initialValues(spec), 0, origin, pts)
    const poly = trajPoly(spec, res.values, res.angle, origin)
    for (const p of pts) expect(closest(poly, p).dist).toBeLessThan(1.0)
  })

  it('打った順に通る：向きが合っていなくても tap 順で軌道が点を訪れる（#50）', () => {
    const origin = { x: 0, y: 0 }
    // x が増える順（=前方へ）にタップ。だが現在の狙いは上向き(90°)でズレている
    const pts: Vec2[] = [
      { x: 3, y: 9 },
      { x: 7, y: 11 },
      { x: 12, y: 8 },
      { x: 17, y: 12 },
    ]
    const spec = detectParams('0.05*x^2 + 0.5*x', 'x')!
    const res = fitToPoints(spec, initialValues(spec), Math.PI / 2, origin, pts)
    const poly = trajPoly(spec, res.values, res.angle, origin)
    // 各点に最も近い軌道サンプルの index が、タップ順に単調増加（＝順番に通る）
    const idxs = pts.map((p) => closest(poly, p).idx)
    for (let i = 1; i < idxs.length; i++) expect(idxs[i]).toBeGreaterThan(idxs[i - 1])
  })
})
