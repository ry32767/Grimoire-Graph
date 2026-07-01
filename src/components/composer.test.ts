import { describe, it, expect } from 'vitest'
import {
  computePreview,
  makeZField,
  buildComposerTrajectory,
  setZCoeffPatch,
  zParametricPatch,
  parametricPatch,
  NO_FIT,
  type ComposerState,
  type ZFieldState,
} from './composer'
import type { Obstacle, Trajectory } from '../game/types'
import { FIELD } from '../data/constants'

// 原点から +x へまっすぐ進む光弾。減速しない zRef（|z|>zRef は失速して停止位置が壁と無関係になるため・#31）
const straight: Trajectory = { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 }, z: () => FIELD.zRef }
// x≈6〜14 を塞ぐ闇の壁
const wall: Obstacle = {
  id: 'w',
  element: 'dark',
  solids: [
    { x: 8, y: 0, r: 2 },
    { x: 10, y: 0, r: 2 },
    { x: 12, y: 0, r: 2 },
  ],
  carves: [],
}

describe('プレビューの障害物クリップ（壁すり抜け表示の防止）', () => {
  it('壁に阻まれる弾の予測軌道は壁の手前/内部で止まり、障害物なしより短い', () => {
    const open = computePreview(straight, 6, [])
    const blocked = computePreview(straight, 6, [wall])
    const lastOpen = open.path[open.path.length - 1].pos.x
    const lastBlocked = blocked.path[blocked.path.length - 1].pos.x
    expect(open.path.length).toBeGreaterThan(0)
    expect(blocked.path.length).toBeGreaterThan(0)
    // 壁で止まる＝予測線が壁を抜けきらない（素通りしない）
    expect(lastBlocked).toBeLessThan(lastOpen)
    expect(lastBlocked).toBeLessThan(14)
  })

  it('障害物が無ければ従来どおり全経路を予測する', () => {
    const open = computePreview(straight, 6, [])
    const noObs = computePreview(straight, 6)
    expect(noObs.path.length).toBe(open.path.length)
  })
})

describe('共通 z 場（3人で共通・#57）', () => {
  // 直線を撃つだけの最小コンポーザ（z は持たない）
  const lineComposer = (): ComposerState => ({
    mode: 'rotate',
    presetId: 'line',
    coeffs: { a: 1 },
    angle: 0,
    speed: FIELD.fixedSpeed,
    useFree: false,
    freeExpr: '1*x',
    freeError: null,
    ...NO_FIT,
    ...parametricPatch('1*x', 'x'),
  })

  it('共通 z 場を別々の術者へ渡すと、同じ z 関数が両方の弾に付く', () => {
    const z: ZFieldState = { ...makeZField(), ...zParametricPatch('0.3*y + 1') }
    const a = buildComposerTrajectory(lineComposer(), z, { x: -5, y: -5 })!
    const b = buildComposerTrajectory(lineComposer(), z, { x: 5, y: -5 })!
    // 軌道は別（origin が違う）だが、z 関数は共通＝同じ入力に同じ値を返す
    for (const [x, y] of [[0, 0], [2, 3], [-4, 1]]) {
      expect(a.z!(x, y)).toBeCloseTo(b.z!(x, y), 9)
      expect(a.z!(x, y)).toBeCloseTo(0.3 * y + 1, 9)
    }
  })

  it('setZCoeffPatch で共通 z の係数を更新できる', () => {
    const z: ZFieldState = { ...makeZField(), ...zParametricPatch('0.3*y + 1') }
    const key = z.zFitParams[0].key // 0.3
    const next = { ...z, ...setZCoeffPatch(z, key, 2) }
    expect(next.zFitValues[key]).toBe(2)
    // 式が再生成され、y 係数が 2 になっている（評価で確認）
    const traj = buildComposerTrajectory(lineComposer(), next, { x: 0, y: 0 })!
    expect(traj.z!(0, 5)).toBeCloseTo(2 * 5 + 1, 9)
  })
})
