import { describe, it, expect } from 'vitest'
import {
  shieldSpeedLoss,
  shieldDurabilityDamage,
  shieldContains,
  crossesShield,
  applyShieldHit,
} from './shield'
import type { Shield, Vec2 } from './types'

const circleShield = (durability: number): Shield => ({
  shape: 'circle',
  params: { R: 4 },
  element: 'light',
  durability,
  maxDurability: durability,
})

describe('結界の速度削り（§3.6）', () => {
  it('同極ほど大きく削る（吸収しやすい）', () => {
    const same = shieldSpeedLoss('light', 'light')
    const opposite = shieldSpeedLoss('dark', 'light')
    expect(same).toBeGreaterThan(opposite)
  })
})

describe('結界の属性別耐久', () => {
  it('反対極の被弾は耐久を大きく削る', () => {
    const opposite = shieldDurabilityDamage(10, 'dark', 'light')
    const same = shieldDurabilityDamage(10, 'light', 'light')
    expect(opposite).toBeGreaterThan(same)
  })
})

describe('結界の内外判定と横断（全方向）', () => {
  it('円結界の内外', () => {
    expect(shieldContains(circleShield(10), { x: 0, y: 0 })).toBe(true)
    expect(shieldContains(circleShield(10), { x: 5, y: 0 })).toBe(false)
  })

  it('楕円結界の内外', () => {
    const ell: Shield = {
      shape: 'ellipse',
      params: { a: 5, b: 2 },
      element: 'light',
      durability: 10,
      maxDurability: 10,
    }
    expect(shieldContains(ell, { x: 4, y: 0 })).toBe(true)
    expect(shieldContains(ell, { x: 0, y: 3 })).toBe(false)
  })

  it('どの方向から原点へ向かう敵弾も横断を検知する', () => {
    const dirs: Vec2[] = [
      { x: 10, y: 0 },
      { x: -10, y: 0 },
      { x: 0, y: 10 },
      { x: 7, y: 7 },
    ]
    for (const start of dirs) {
      const path = [start, { x: 0, y: 0 }] // 外から原点へ
      expect(crossesShield(path, circleShield(10))).not.toBeNull()
    }
  })
})

describe('結界の被弾解決（消滅条件＝吸収量）', () => {
  it('敵弾速度を削り、速度0で敵弾を止める', () => {
    const r = applyShieldHit(circleShield(100), 5, 'light', 2) // 同極・低速
    expect(r.newBulletSpeed).toBe(0)
    expect(r.blocked).toBe(true)
  })

  it('耐久0で結界が割れる', () => {
    const r = applyShieldHit(circleShield(3), 100, 'dark', 10) // 反対極・大威力
    expect(r.broken).toBe(true)
    expect(r.shield.durability).toBe(0)
  })
})
