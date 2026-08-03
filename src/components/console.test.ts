// 詠唱コンソール（y/z の別入力・z 整形・作図台・読み出し）の回帰テスト。
// エンジンは触らず、UI 側の派生計算だけを固める（DC プロトタイプ v3 の移植分）。
import { describe, it, expect } from 'vitest'
import type { Ally, Enemy, Obstacle } from '../game/types'
import { FIELD } from '../data/constants'
import { buildZAt, buildZField, yTextPatch, zTextPatch, type ComposerState } from './composer'
import { genZShape, parseZShape, patchZShape } from './zshape'
import { formatPoly, polyFit } from './polyFit'
import { computeReadout } from './readout'
import { rayInfo, refAt, poleOf } from './rayInfo'

function makeComposer(yText: string, zText: string): ComposerState {
  const base: ComposerState = {
    mode: 'rotate',
    presetId: 'line',
    coeffs: {},
    angle: Math.PI / 2,
    speed: FIELD.fixedSpeed,
    useFree: true,
    freeExpr: '0',
    freeError: null,
    yText: '0',
    zText: '0',
    fitTemplate: '',
    fitParams: [],
    fitValues: {},
    zRadial: true,
    zPresetId: 'const',
    zCoeffs: {},
    zUseFree: true,
    zFreeExpr: '0',
    zFreeError: null,
    zFitTemplate: '',
    zFitParams: [],
    zFitValues: {},
  }
  return { ...base, ...yTextPatch(yText), ...zTextPatch(zText) } as ComposerState
}

const ally: Ally = {
  id: 'a1',
  name: 'ミラ',
  pos: { x: 0, y: 0 },
  hp: 100,
  maxHp: 100,
  element: 'light',
  statuses: [],
}

function makeEnemy(x: number, y: number, element: Enemy['element'] = 'dark'): Enemy {
  return {
    id: 'e1',
    name: '石像の番人',
    pos: { x, y },
    hp: 100,
    maxHp: 100,
    element,
    hitboxRadius: 1.8,
    statuses: [],
    family: 'line',
    castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
    castInitialSpeed: FIELD.fixedSpeed,
    castZ: 0,
  }
}

const wall: Obstacle = { id: 'w', element: 'neutral', solids: [{ x: 0, y: 12, r: 2 }], carves: [] }

describe('y 欄の入力（`r=` で結界へ切り替わる）', () => {
  it('通常の式は発射型（rotate）として受け取られる', () => {
    const p = yTextPatch('0.03*x^2')
    expect(p.mode).toBe('rotate')
    expect(p.yText).toBe('0.03*x^2')
    expect(p.freeError).toBeNull()
  })

  it('`r=` で始めると結界（polar）になり、式本体だけが freeExpr に入る', () => {
    const p = yTextPatch('r=6 + 1.6*cos(3*t)')
    expect(p.mode).toBe('polar')
    expect(p.yText).toBe('r=6 + 1.6*cos(3*t)')
    expect(p.freeExpr).not.toMatch(/^r\s*=/)
  })

  it('θ・π・√ は mathjs が読める記号へ寄せる', () => {
    const p = yTextPatch('r=5 + sin(2θ)')
    expect(p.mode).toBe('polar')
    expect(p.freeExpr).toContain('t')
    expect(p.freeError).toBeNull()
  })

  it('読めない式はエラーを返し、直前の有効な式（freeExpr）は書き換えない', () => {
    const p = yTextPatch('sin(')
    expect(p.freeError).toBeTruthy()
    expect(p.freeExpr).toBeUndefined()
  })
})

describe('z 欄は z=g(t)（t＝術者からの距離）として距離場へ持ち上がる', () => {
  it('山形の頂点 t₀ で |z| が最大になる', () => {
    const c = makeComposer('0', '5*exp(-((t - 20)/6)^2)')
    const g = buildZAt(c)
    expect(g).not.toBeNull()
    expect(g!(20)).toBeCloseTo(5, 3)
    expect(Math.abs(g!(0))).toBeLessThan(0.2)
    // 場としては術者を中心とした同心円（θ に依らない）
    const field = buildZField(c)
    expect(field(20, 0)).toBeCloseTo(5, 3)
    expect(field(0, 20)).toBeCloseTo(5, 3)
    expect(field(20 / Math.SQRT2, 20 / Math.SQRT2)).toBeCloseTo(5, 3)
  })

  it('定数式（おまかせが作る z）はどこでも同じ値', () => {
    const c = makeComposer('0', '-5')
    const field = buildZField(c)
    expect(field(3, 4)).toBe(-5)
    expect(field(-11, 2)).toBe(-5)
  })
})

describe('z の整形（正準形の解析と生成）', () => {
  it('生成した式は必ず解析し直せる（4 形すべて）', () => {
    for (const kind of ['gauss', 'step', 'wave', 'flat'] as const) {
      const expr = genZShape(kind, kind === 'flat' ? 3 : 5, 18.5, 6)
      const parsed = parseZShape(expr)
      expect(parsed, `${kind}: ${expr}`).not.toBeNull()
      expect(parsed!.kind).toBe(kind)
      expect(parsed!.h).toBeCloseTo(kind === 'flat' ? 3 : 5, 5)
    }
  })

  it('t₀ だけ差し替えても形と高さは保たれる', () => {
    const src = genZShape('gauss', -4, 20, 6)
    const next = patchZShape(src, { t0: 27.3 })
    const parsed = parseZShape(next)!
    expect(parsed.kind).toBe('gauss')
    expect(parsed.h).toBeCloseTo(-4, 5)
    expect(parsed.t0).toBeCloseTo(27.3, 5)
  })

  it('自由式は解析できない（スライダーが無効になる）', () => {
    expect(parseZShape('5*sin(t) + 0.2*t')).toBeNull()
  })

  it('生成した式はそのまま z(t) として評価できる', () => {
    const c = makeComposer('0', genZShape('step', 5, 24, 4))
    const g = buildZAt(c)!
    expect(g(24)).toBeCloseTo(0, 6)
    expect(g(40)).toBeGreaterThan(4)
    expect(g(8)).toBeLessThan(-4)
  })
})

describe('作図台の多項式フィット', () => {
  it('放物線上の点から元の係数を復元する', () => {
    const pts = [0, 5, 10, 15, 20].map((x) => ({ x, y: 0.05 * x * x - 2 * x + 1 }))
    const co = polyFit(pts, 2)!
    expect(co[2]).toBeCloseTo(0.05, 6)
    expect(co[1]).toBeCloseTo(-2, 6)
    expect(co[0]).toBeCloseTo(1, 6)
  })

  it('整形した式は mathjs 表記（`*` 明示）になる', () => {
    expect(formatPoly([1, -2, 0.05])).toBe('0.05*x^2 - 2*x + 1')
    expect(formatPoly([0, 0, 0])).toBe('0')
  })

  it('点が足りないときは次数を落として解く（1点なら定数）', () => {
    expect(polyFit([{ x: 1, y: 3 }], 2)).toEqual([3])
    expect(polyFit([], 2)).toBeNull()
  })
})

describe('射線読み取り（撃つ前に読める値）', () => {
  it('射線上の敵をその距離とともに拾う', () => {
    const r = rayInfo(ally.pos, Math.PI / 2, [makeEnemy(0, 15)], [])
    expect(r.kind).toBe('enemy')
    expect(r.d).toBeCloseTo(15 - 1.8 - 0.8, 1)
  })

  it('敵が居なければ射線上の壁を拾う', () => {
    const r = rayInfo(ally.pos, Math.PI / 2, [], [wall])
    expect(r.kind).toBe('wall')
    expect(r.d).toBeCloseTo(10, 1)
  })

  it('射線上に何も無ければ最寄りの障害物までの距離を返す', () => {
    const r = rayInfo(ally.pos, -Math.PI / 2, [], [wall])
    expect(r.kind).toBe('nearWall')
    expect(r.d).toBeGreaterThan(0)
  })

  it('中立（z=0）は速いが強度 0＝ダメージ 0', () => {
    const ref = refAt(() => 0, 15, 'dark')
    expect(ref.strength).toBe(0)
    expect(ref.damage).toBe(0)
    expect(ref.speed).toBeGreaterThan(FIELD.fixedSpeed)
  })

  it('反対極を強度ピークで当てると相性 1.5 が乗る（近ければ届く）', () => {
    const near = refAt(() => FIELD.zPeak, 3, 'dark')
    expect(near.attr).toBe('light')
    expect(near.affinity).toBeCloseTo(1.5, 5)
    expect(near.speed).toBeGreaterThan(0)
    expect(near.damage).toBeGreaterThan(0)
  })

  it('最強属性を張り続けると遠くへは届かない（|z|>zRef で減速し速度0）', () => {
    const far = refAt(() => FIELD.zPeak, 20, 'dark')
    expect(far.speed).toBe(0)
    expect(far.damage).toBe(0)
  })

  it('極（±∞ を跨ぐ符号反転）を t で検出する', () => {
    const pole = poleOf((t) => 1 / (t - 12))
    expect(pole).not.toBeNull()
    expect(pole!).toBeGreaterThan(11)
    expect(pole!).toBeLessThan(13)
    expect(poleOf(() => 1)).toBeNull()
    // 通常の符号反転（段・波）は極ではない
    expect(poleOf((t) => 5 * Math.sin(t / 7))).toBeNull()
  })
})

describe('読み出しストリップの出し分け', () => {
  const ctx = { enemies: [makeEnemy(0, 15)], obstacles: [], orbits: [], rField: FIELD.rField }

  it('命中予測：射線上の敵までの r と「当たれば」を出す', () => {
    const composer = makeComposer('0', genZShape('gauss', 5, 12, 6))
    const r = computeReadout({ ally, composer, ...ctx })
    expect(r.tone).toBe('good')
    expect(r.title).toContain('石像の番人 まで r =')
    expect(r.ref.damage).toBeGreaterThan(0)
  })

  it('z が的の手前で発散すると暴発予告になる', () => {
    const composer = makeComposer('0', '1/(t - 6)')
    const r = computeReadout({ ally, composer, ...ctx })
    expect(r.tone).toBe('danger')
    expect(r.title).toContain('発散')
    expect(r.pole).not.toBeNull()
  })

  it('最大強度を張り続けると失速として出る', () => {
    const composer = makeComposer('0', '5')
    const r = computeReadout({ ally, composer, ...ctx })
    expect(r.title).toContain('失速')
    expect(r.ref.speed).toBeLessThanOrEqual(0.4)
  })

  it('`r=` の結界は「弾は撃たない」読み出しになる', () => {
    const composer = makeComposer('r=6', '0')
    const r = computeReadout({ ally, composer, ...ctx })
    expect(r.barrier).toBe(true)
    expect(r.title).toContain('結界')
    expect(r.sub).toContain('半径')
  })

  it('式エラーはエラー表示（ひるみはひるみ表示）が最優先', () => {
    const broken = { ...makeComposer('0', '0'), freeError: '式が読めません' }
    expect(computeReadout({ ally, composer: broken, ...ctx }).tone).toBe('error')
    const ok = makeComposer('0', '0')
    expect(computeReadout({ ally, composer: ok, ...ctx, impaired: true }).title).toContain('ひるみ')
  })
})
