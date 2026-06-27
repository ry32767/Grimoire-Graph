import { describe, it, expect } from 'vitest'
import { STAGES } from './stages'
import { ALL_PRESETS, buildTrajectory } from '../game/functions'
import { createBattleState, prepareTurn, resolvePlayerAction } from '../game/battle'
import { FIELD } from './constants'
import { dist } from '../game/coords'

describe('ステージ定義（機能14）', () => {
  it('3ステージある', () => {
    expect(STAGES).toHaveLength(3)
  })

  it('段階的導入：メカニクスが後半ほど増える（機能17）', () => {
    const count = (m: { obstacles: boolean; shield: boolean; enemyFire: boolean; parry: boolean }) =>
      [m.obstacles, m.shield, m.enemyFire, m.parry].filter(Boolean).length
    const c1 = count(STAGES[0].mechanics)
    const c2 = count(STAGES[1].mechanics)
    const c3 = count(STAGES[2].mechanics)
    expect(c1).toBeLessThan(c2)
    expect(c2).toBeLessThan(c3)
    // ステージ1は命中だけ
    expect(STAGES[0].mechanics).toEqual({ obstacles: false, shield: false, enemyFire: false, parry: false })
    // ステージ3はパリィまで解禁
    expect(STAGES[2].mechanics.parry).toBe(true)
  })

  it('敵・障害物は場内に配置され、HP/耐久は正', () => {
    for (const s of STAGES) {
      expect(s.enemies.length).toBeGreaterThan(0)
      expect(s.introText.length).toBeGreaterThan(0)
      expect(s.clearText.length).toBeGreaterThan(0)
      for (const e of s.enemies) {
        expect(dist(e.pos)).toBeLessThan(FIELD.rField)
        expect(e.hp).toBeGreaterThan(0)
      }
      for (const o of s.obstacles) {
        expect(dist(o.pos)).toBeLessThan(FIELD.rField)
        expect(o.durability).toBeGreaterThan(0)
      }
    }
  })

  it('おすすめプリセットIDはカタログに存在する', () => {
    for (const s of STAGES) {
      expect(ALL_PRESETS.some((p) => p.id === s.recommendedPresetId)).toBe(true)
    }
  })
})

describe('エンジンとの結線（スモーク）', () => {
  it('ステージ1でおすすめ直線を敵に当てるとHPが減る', () => {
    const stage = STAGES[0]
    const target = stage.enemies[0]
    const preset = ALL_PRESETS.find((p) => p.id === stage.recommendedPresetId)!
    const angle = Math.atan2(target.pos.y, target.pos.x)
    const trajectory = buildTrajectory(preset, stage.recommendedCoeffs ?? {}, angle)

    let s = createBattleState(stage, 0, 100)
    const prep = prepareTurn(s)
    const out = resolvePlayerAction(prep.state, { kind: 'attack', trajectory, initialSpeed: stage.recommendedSpeed ?? 8 }, prep.castingEnemyIds)
    s = out.state
    expect(s.enemies[0].hp).toBeLessThan(target.maxHp)
  })
})
