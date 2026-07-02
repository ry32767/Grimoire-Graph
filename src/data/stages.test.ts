import { describe, it, expect } from 'vitest'
import { STAGES } from './stages'
import { ROTATE_PRESETS, buildTrajectory } from '../game/functions'
import { createBattleState, prepareTurn, resolveAllyCasts } from '../game/battle'
import { planRuptorShot } from '../game/enemyAI'
import { makeParty, PARTY } from './party'
import { FIELD } from './constants'
import { dist } from '../game/coords'
import { isSolidAt } from '../game/obstacle'
import type { Obstacle, Trajectory, Vec2 } from '../game/types'

/** 線分 a→e のどこかが障害物の素材に当たるか（直線で射線が通らない＝壁で遮られる）。 */
function segmentBlocked(a: Vec2, e: Vec2, obstacles: Obstacle[]): boolean {
  const steps = 300
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const p = { x: a.x + (e.x - a.x) * t, y: a.y + (e.y - a.y) * t }
    for (const o of obstacles) if (isSolidAt(o, p)) return true
  }
  return false
}

describe('ステージ定義（機能14・#15）', () => {
  it('3ステージ以上ある', () => {
    expect(STAGES.length).toBeGreaterThanOrEqual(3)
  })

  it('段階的導入：序盤は命中だけ、後半は敵弾・障害物が登場', () => {
    expect(STAGES[0].mechanics).toEqual({ obstacles: false, enemyFire: false })
    const last = STAGES[STAGES.length - 1]
    expect(last.mechanics.enemyFire).toBe(true)
  })

  it('敵・障害物ブロブは場内に配置され、HP/円は正', () => {
    for (const s of STAGES) {
      expect(s.enemies.length).toBeGreaterThan(0)
      expect(s.introText.length).toBeGreaterThan(0)
      expect(s.clearText.length).toBeGreaterThan(0)
      for (const e of s.enemies) {
        expect(dist(e.pos)).toBeLessThan(FIELD.rField)
        expect(e.hp).toBeGreaterThan(0)
      }
      for (const o of s.obstacles) {
        expect(o.solids.length).toBeGreaterThan(0)
        expect(o.carves).toEqual([])
        for (const d of o.solids) {
          expect(dist({ x: d.x, y: d.y })).toBeLessThan(FIELD.rField)
          expect(d.r).toBeGreaterThan(0)
        }
      }
    }
  })

  it('障害物ありステージは開始時、全ての味方→敵の直線が壁で遮られる', () => {
    for (const s of STAGES) {
      if (!s.mechanics.obstacles) continue // チュートリアル等は直線可
      for (const a of PARTY) {
        for (const e of s.enemies) {
          expect(segmentBlocked(a.pos, e.pos, s.obstacles)).toBe(true)
        }
      }
    }
  })
})

describe('難易度フレームワーク（06b）', () => {
  it('castInitialSpeed は全敵・全LVLで 8 固定', () => {
    for (const s of STAGES) for (const e of s.enemies) expect(e.castInitialSpeed).toBe(8)
  })

  it('迂回型・暴発型は line family を持たない（05b §2）', () => {
    for (const s of STAGES) {
      for (const e of s.enemies) {
        const role = e.role ?? 'attacker'
        if (role !== 'attacker' && role !== 'ruptor') continue
        // attacker（迂回型）は line を含んでもよいのは第1面（迂回パターン未解禁）のみ
        if (role === 'ruptor') {
          expect(e.family).not.toBe('line')
          expect(e.families ?? []).not.toContain('line')
        }
      }
    }
  })

  it('第4面に暴発デモ（障害物狙い・低頻度）の崩し手が1体いる', () => {
    const demos = STAGES[3].enemies.filter((e) => e.role === 'ruptor')
    expect(demos).toHaveLength(1)
    expect(demos[0].ruptorTarget).toBe('obstacles')
    expect(demos[0].fireEvery).toBe(2)
    // 1ターン目に必ず撃つ（最低1回は暴発を見せる）
    expect((1 + (demos[0].fireOffset ?? 0)) % (demos[0].fireEvery ?? 1)).toBe(0)
  })

  it('第4面のデモ崩し手は、壁の近傍に暴発点つきの計画を返す（RUPTOR_DEMO）', () => {
    const s4 = STAGES[3]
    const demo = s4.enemies.find((e) => e.role === 'ruptor')!
    const obstacles = s4.obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
    const plan = planRuptorShot(demo, makeParty(), obstacles)
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    // 暴発点はいずれかの壁素材の近く（味方の近くではない）
    const nearWall = obstacles.some((o) => o.solids.some((d) => dist({ x: d.x, y: d.y }, plan!.misfirePos!) <= FIELD.aoeRadius + d.r))
    expect(nearWall).toBe(true)
  })

  it('第4面：味方が迎撃しなければ、1ターン目にデモの暴発が解決する', () => {
    const st = createBattleState(STAGES[3], 3, makeParty())
    const prep = prepareTurn(st)
    expect(prep.castingEnemyIds.some((id) => prep.state.enemies.find((e) => e.id === id)?.role === 'ruptor')).toBe(true)
    const { resolution } = resolveAllyCasts(prep.state, [], prep.castingEnemyIds)
    expect(resolution.misfires.filter((m) => m.owner === 'enemy').length).toBeGreaterThanOrEqual(1)
  })

  it('第6面に崩し手3体（低頻度・位相ずらし）と交互張りの守護型がいる', () => {
    const ruptors = STAGES[5].enemies.filter((e) => e.role === 'ruptor')
    expect(ruptors).toHaveLength(3)
    for (const r of ruptors) expect(r.fireEvery).toBe(2)
    expect(new Set(ruptors.map((r) => r.fireOffset)).size).toBeGreaterThan(1) // タイミングが揃わない
    const guardian = STAGES[5].enemies.find((e) => e.role === 'guardian')
    expect(guardian?.alternatingAura).toBe(true)
  })

  it('第7面ボスは多重詠唱（2本→フェーズで3本）と HP フェーズを持つ', () => {
    const s7 = STAGES[6]
    const boss = s7.enemies.find((e) => e.boss)!
    expect(boss.castCount).toBe(2)
    expect(boss.patternPool).toEqual(['breaker', 'attacker'])
    expect(s7.bossPhases).toHaveLength(2)
    expect(s7.bossPhases![0]).toMatchObject({ hpBelow: 0.66, castCount: 2 })
    expect(s7.bossPhases![1]).toMatchObject({ hpBelow: 0.33, castCount: 3, cullMinions: true })
    // 最下層は障害物なし（逃げ場が少ない）
    expect(s7.bossPhases![1].obstacles).toHaveLength(0)
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
    // 属性は z 場で別指定（#30）：敵の反対極を、減速しない zRef で当てる（#31：zPeak は失速して届かない）
    const zConst = target.element === 'light' ? -FIELD.zRef : FIELD.zRef
    const trajectory: Trajectory = { ...buildTrajectory(line, { a, b: 0 }, angle, caster.pos), z: () => zConst }

    let s = createBattleState(stage, 0, party)
    const prep = prepareTurn(s)
    const out = resolveAllyCasts(prep.state, [{ allyId: caster.id, trajectory, initialSpeed: FIELD.fixedSpeed }], prep.castingEnemyIds)
    s = out.state
    expect(s.enemies[0].hp).toBeLessThan(target.maxHp)
  })
})
