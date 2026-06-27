import { describe, it, expect } from 'vitest'
import { STAGES } from './stages'
import { ROTATE_PRESETS, buildTrajectory } from '../game/functions'
import { createBattleState, prepareTurn, resolveAllyCasts } from '../game/battle'
import { makeParty } from './party'
import { FIELD } from './constants'
import { dist } from '../game/coords'

describe('ステージ定義（機能14・#15）', () => {
  it('3ステージ以上ある', () => {
    expect(STAGES.length).toBeGreaterThanOrEqual(3)
  })

  it('段階的導入：序盤は命中だけ、後半は敵弾・障害物が登場', () => {
    expect(STAGES[0].mechanics).toEqual({ obstacles: false, enemyFire: false })
    const last = STAGES[STAGES.length - 1]
    expect(last.mechanics.enemyFire).toBe(true)
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
})

describe('エンジンとの結線（スモーク）', () => {
  it('ステージ1でおすすめ光線を敵に当てるとHPが減る', () => {
    const stage = STAGES[0]
    const target = stage.enemies[0]
    const party = makeParty()
    const caster = party[1] // 中央の術者
    // おすすめ：敵の反対極を作る直線 g(x)=a·x（闇の敵→光 a=1）
    const a = target.element === 'light' ? -1 : 1
    const line = ROTATE_PRESETS[0]
    const angle = Math.atan2(target.pos.y - caster.pos.y, target.pos.x - caster.pos.x) - Math.atan(a)
    const trajectory = buildTrajectory(line, { a, b: 0 }, angle, caster.pos)

    let s = createBattleState(stage, 0, party)
    const prep = prepareTurn(s)
    const out = resolveAllyCasts(prep.state, [{ allyId: caster.id, trajectory, initialSpeed: FIELD.fixedSpeed }], prep.castingEnemyIds)
    s = out.state
    expect(s.enemies[0].hp).toBeLessThan(target.maxHp)
  })
})
