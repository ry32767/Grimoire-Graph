import { describe, it, expect } from 'vitest'
import {
  ROTATE_PRESETS,
  POLAR_PRESETS,
  ALL_PRESETS,
  defaultCoeffs,
  buildTrajectory,
  parseExpression,
  parseZExpression,
  sampleOutputs,
} from './functions'

describe('関数カタログ（§3.10）', () => {
  it('直交5種・極座標4種が揃っている', () => {
    expect(ROTATE_PRESETS).toHaveLength(5)
    expect(POLAR_PRESETS).toHaveLength(4)
    expect(ALL_PRESETS).toHaveLength(9)
  })

  it('各プリセットに説明文がある（チュートリアル文）', () => {
    for (const p of ALL_PRESETS) {
      expect(p.description.length).toBeGreaterThan(0)
      expect(p.coeffs.length).toBeGreaterThan(0)
    }
  })

  it('直線 y=a·x+b が定義どおり評価される', () => {
    const line = ROTATE_PRESETS[0]
    const g = line.buildG({ a: 2, b: 1 })
    expect(g(0)).toBe(1)
    expect(g(3)).toBe(7)
  })

  it('放物線 y=a(x−h)²+k が定義どおり', () => {
    const g = ROTATE_PRESETS[1].buildG({ a: 1, h: 2, k: -1 })
    expect(g(2)).toBe(-1) // 頂点
    expect(g(4)).toBe(3) // 1*4 -1
  })

  it('サイン波 y=A·sin(B·x)+C', () => {
    const g = ROTATE_PRESETS[2].buildG({ A: 2, B: 1, C: 1 })
    expect(g(0)).toBeCloseTo(1, 6)
    expect(g(Math.PI / 2)).toBeCloseTo(3, 6)
  })

  it('指数 y=a·e^(b·x)+c', () => {
    const g = ROTATE_PRESETS[3].buildG({ a: 1, b: 1, c: 0 })
    expect(g(0)).toBeCloseTo(1, 6)
    expect(g(1)).toBeCloseTo(Math.E, 6)
  })

  it('絶対値 y=a·|x−h|+k', () => {
    const g = ROTATE_PRESETS[4].buildG({ a: 1, h: 3, k: 0 })
    expect(g(3)).toBe(0)
    expect(g(0)).toBe(3)
    expect(g(5)).toBe(2)
  })

  it('円 r=R は一定', () => {
    const f = POLAR_PRESETS[0].buildF({ R: 6 })
    expect(f(0)).toBe(6)
    expect(f(5)).toBe(6)
  })

  it('らせん r=a·θ', () => {
    const f = POLAR_PRESETS[1].buildF({ a: 2 })
    expect(f(3)).toBe(6)
  })

  it('バラ曲線 r=a·cos(k·θ)', () => {
    const f = POLAR_PRESETS[2].buildF({ a: 4, k: 2 })
    expect(f(0)).toBeCloseTo(4, 6)
    expect(f(Math.PI / 2)).toBeCloseTo(-4, 6) // cos(π)= -1
  })

  it('リマソン r=a+b·cos(θ)', () => {
    const f = POLAR_PRESETS[3].buildF({ a: 3, b: 2 })
    expect(f(0)).toBeCloseTo(5, 6)
    expect(f(Math.PI)).toBeCloseTo(1, 6)
  })

  it('buildTrajectory は回転/極座標を組み立てる', () => {
    const rot = buildTrajectory(ROTATE_PRESETS[0], defaultCoeffs(ROTATE_PRESETS[0]), 0.5)
    expect(rot.mode).toBe('rotate')
    const pol = buildTrajectory(POLAR_PRESETS[0], defaultCoeffs(POLAR_PRESETS[0]), 0)
    expect(pol.mode).toBe('polar')
  })
})

describe('自由入力式（mathjs）', () => {
  it('正しい式はパースされ評価できる', () => {
    const g = parseExpression('x^2 + 1')
    expect(g).not.toBeNull()
    expect(g!(3)).toBe(10)
  })

  it('sin など mathjs 関数が使える', () => {
    const g = parseExpression('sin(x)')
    expect(g).not.toBeNull()
    expect(g!(0)).toBeCloseTo(0, 6)
  })

  it('不正な式（構文エラー）は null', () => {
    expect(parseExpression('x +')).toBeNull()
    expect(parseExpression('')).toBeNull()
  })

  it('未知の記号（別変数）は null', () => {
    expect(parseExpression('y + 1')).toBeNull()
  })

  it('非実数になる式は NaN を返す（暴発扱い）', () => {
    const g = parseExpression('sqrt(x)')
    expect(g).not.toBeNull()
    expect(g!(4)).toBeCloseTo(2, 6)
    expect(Number.isNaN(g!(-4))).toBe(true) // 複素数 → NaN
  })

  it('非有限（Infinity）も NaN に正規化する（#3）', () => {
    const g = parseExpression('log(x)')
    expect(g).not.toBeNull()
    expect(Number.isNaN(g!(0))).toBe(true) // log(0) = -Infinity → NaN
  })

  it('未知変数は入力値に関わらず null（暴発と区別・#4）', () => {
    // 旧実装は x=1,2 の評価結果が NaN かで判定していた。静的検査なので確実に弾く。
    expect(parseExpression('a*x + b')).toBeNull()
  })

  it('代入・複文は拒否する（#4 安全性）', () => {
    expect(parseExpression('x = 5')).toBeNull()
    expect(parseExpression('x; 5')).toBeNull()
  })

  it('定数 pi / e は許可する', () => {
    const g = parseExpression('pi + x')
    expect(g).not.toBeNull()
    expect(g!(0)).toBeCloseTo(Math.PI, 6)
  })
})

describe('z 場の自由入力（f(x,y)・#30）', () => {
  it('x,y 二変数の式を評価できる', () => {
    const f = parseZExpression('0.3*y + 2')
    expect(f).not.toBeNull()
    expect(f!(0, 10)).toBeCloseTo(5, 6)
  })

  it('x,y 以外の変数は null', () => {
    expect(parseZExpression('a + x')).toBeNull()
  })

  it('非有限/非実数は 0（中立）に正規化する', () => {
    const f = parseZExpression('log(x)')
    expect(f).not.toBeNull()
    expect(f!(0, 0)).toBe(0) // log(0) = -Infinity → 0
  })
})

describe('極座標の自由入力（θ は t・#19）', () => {
  it('t を変数とする式をパースできる', () => {
    const f = parseExpression('8*cos(2*t)', 't')
    expect(f).not.toBeNull()
    expect(f!(0)).toBeCloseTo(8, 6)
    expect(f!(Math.PI / 2)).toBeCloseTo(-8, 6) // cos(π) = -1
  })

  it('定数式（円）も受け付ける', () => {
    const f = parseExpression('11', 't')
    expect(f).not.toBeNull()
    expect(f!(3)).toBe(11)
  })

  it('x のパーサに t の式を渡すと未知変数で null', () => {
    expect(parseExpression('cos(t)', 'x')).toBeNull()
  })

  it('各回転プリセットの toExpr が buildG と一致する（係数を式へコピーしても変わらない・#5）', () => {
    for (const p of ROTATE_PRESETS) {
      // 既定値から各係数を1ステップずらした、スライダーで到達可能な値で検証
      const coeffs = defaultCoeffs(p)
      for (const cf of p.coeffs) coeffs[cf.key] = cf.default + cf.step
      const fromExpr = parseExpression(p.toExpr(coeffs), 'x')
      const fromBuild = p.buildG(coeffs)
      expect(fromExpr).not.toBeNull()
      for (const x of [0, 1.5, 4]) {
        const a = fromExpr!(x)
        const b = fromBuild(x)
        if (Number.isFinite(b)) expect(a).toBeCloseTo(b, 6)
      }
    }
  })

  it('各極座標プリセットの toExpr が自身の buildF と一致する', () => {
    for (const p of POLAR_PRESETS) {
      const coeffs = defaultCoeffs(p)
      const fromExpr = parseExpression(p.toExpr(coeffs), 't')
      const fromBuild = p.buildF(coeffs)
      expect(fromExpr).not.toBeNull()
      for (const t of [0, 1, 2.5]) expect(fromExpr!(t)).toBeCloseTo(fromBuild(t), 6)
    }
  })
})

describe('サンプル出力（機能2）', () => {
  it('既定で f(0), f(2), f(5) を返す', () => {
    const out = sampleOutputs((x) => x * x)
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 4 },
      { x: 5, y: 25 },
    ])
  })
})
