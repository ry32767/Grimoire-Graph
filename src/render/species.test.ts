// 種族ビジュアル（05c §0/§6・#46）の純粋関数のテスト。描画は手動確認、ここはパラメータ導出のみ検証する。
import { describe, it, expect } from 'vitest'
import { speciesOf, tierOf, speciesStyle, GUARD_LIGHT, GUARD_DARK } from './species'
import type { Enemy } from '../game/types'

describe('speciesOf（role からのフォールバック・05c §0）', () => {
  it('species が明示されていればそれを優先する', () => {
    expect(speciesOf({ species: 'golem', role: 'breaker', boss: false })).toBe('golem')
  })
  it('breaker→oni／ruptor→redWraith／guardian→golem／attacker→wraith', () => {
    expect(speciesOf({ role: 'breaker' })).toBe('oni')
    expect(speciesOf({ role: 'ruptor' })).toBe('redWraith')
    expect(speciesOf({ role: 'guardian' })).toBe('golem')
    expect(speciesOf({ role: 'attacker' })).toBe('wraith')
  })
  it('role 未設定・その他は proto（原型）', () => {
    expect(speciesOf({})).toBe('proto')
  })
})

describe('tierOf（level→3段階・05c §6）', () => {
  it('1〜3=I／4〜5=II／6〜7=III に丸める', () => {
    expect(tierOf(1)).toBe(1)
    expect(tierOf(3)).toBe(1)
    expect(tierOf(4)).toBe(2)
    expect(tierOf(5)).toBe(2)
    expect(tierOf(6)).toBe(3)
    expect(tierOf(7)).toBe(3)
  })
  it('未指定は最低ティア', () => {
    expect(tierOf(undefined)).toBe(1)
  })
})

describe('speciesStyle（ティアで装飾が単調増加・05c §6）', () => {
  it('鋼鬼・ゴーレム・亡霊は ornaments がティアと共に増える', () => {
    for (const sp of ['oni', 'golem', 'wraith', 'redWraith'] as const) {
      const s1 = speciesStyle(sp, 1, 'dark')
      const s2 = speciesStyle(sp, 2, 'dark')
      const s3 = speciesStyle(sp, 3, 'dark')
      expect(s2.ornaments).toBeGreaterThan(s1.ornaments)
      expect(s3.ornaments).toBeGreaterThan(s2.ornaments)
    }
  })
  it('亡霊系はティアで実体に近づく（alpha が単調増加・半透明→濃く）', () => {
    for (const sp of ['wraith', 'redWraith'] as const) {
      const a1 = speciesStyle(sp, 1, 'light').alpha
      const a3 = speciesStyle(sp, 3, 'light').alpha
      expect(a3).toBeGreaterThan(a1)
      expect(a1).toBeLessThan(1) // 実体ではない
    }
  })
  it('実体系（鋼鬼・ゴーレム・原型）は不透明（alpha=1）', () => {
    for (const sp of ['oni', 'golem', 'proto'] as const) {
      expect(speciesStyle(sp, 2, 'light').alpha).toBe(1)
    }
  })
  it('紅亡霊だけ亀裂の明滅（crackPulse>0）を持ち、ティアで速くなる', () => {
    expect(speciesStyle('wraith', 3, 'dark').crackPulse).toBe(0)
    const c1 = speciesStyle('redWraith', 1, 'dark').crackPulse
    const c3 = speciesStyle('redWraith', 3, 'dark').crackPulse
    expect(c1).toBeGreaterThan(0)
    expect(c3).toBeGreaterThan(c1)
  })
  it('紅亡霊のアクセントは紅（亡霊と見分けがつく配色・05c 受け入れ条件）', () => {
    expect(speciesStyle('redWraith', 1, 'dark').accent.toLowerCase()).toBe('#ff3b3b')
    // 通常の亡霊は紅アクセントを持たない
    expect(speciesStyle('wraith', 1, 'dark').accent.toLowerCase()).not.toBe('#ff3b3b')
  })
  it('属性で基調色が変わる（光≠闇）', () => {
    expect(speciesStyle('oni', 1, 'light').base).not.toBe(speciesStyle('oni', 1, 'dark').base)
  })
})

describe('ゴーレムの目の色は結界属性色（05c §4・GUARD_LIGHT/DARK）', () => {
  // golemEyeColor は draw.ts 内部だが、色定数の対応は 05c §4（光=金/闇=紫）と一致することを確認する。
  it('定数が図鑑の指定色に一致する', () => {
    expect(GUARD_LIGHT.toLowerCase()).toBe('#f4c430')
    expect(GUARD_DARK.toLowerCase()).toBe('#7b5cc4')
  })
})

// 型の健全性：Enemy から speciesOf を呼べる（species/role/boss のみ参照）。
it('Enemy 部分型から speciesOf を導出できる', () => {
  const e: Pick<Enemy, 'species' | 'role' | 'boss'> = { role: 'guardian' }
  expect(speciesOf(e)).toBe('golem')
})
