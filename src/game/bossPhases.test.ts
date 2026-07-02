// 多重詠唱（#44）・ボス HP フェーズ（床崩落）・断末魔の暴発3連（#45）のテスト。
import { describe, it, expect } from 'vitest'
import { planEnemyShots } from './enemyAI'
import { createBattleState, prepareTurn, resolveAllyCasts } from './battle'
import { resolveTurn } from './turn'
import type { Ally, BossPhase, Enemy, Stage } from './types'

const ally = (id: string, pos: { x: number; y: number }, hp = 500): Ally => ({
  id, name: id, pos, hp, maxHp: hp, element: 'neutral', statuses: [],
})

const baseEnemy = (over: Partial<Enemy> = {}): Enemy => ({
  id: 'e0', name: '敵', pos: { x: 0, y: 20 }, hp: 300, maxHp: 300, element: 'dark',
  hitboxRadius: 1.8, statuses: [], family: 'line',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 }, castInitialSpeed: 8, castZ: -3,
  ...over,
})

describe('多重詠唱（#44・05b §5.5）', () => {
  it('castCount 本の弾を独立に計画し、基本は別々の味方へ1発ずつ分散する', () => {
    const boss = baseEnemy({ castCount: 3, patternPool: ['breaker', 'attacker'] })
    const allies = [ally('a', { x: -8, y: -14 }), ally('b', { x: 0, y: -14 }), ally('c', { x: 8, y: -14 })]
    const plans = planEnemyShots(boss, allies)
    expect(plans).toHaveLength(3)
    const targets = new Set(plans.map((p) => p.targetId))
    expect(targets.size).toBe(3) // 3人へ1発ずつ
  })

  it('resolveTurn は castCount ぶんの敵弾を同時発射する', () => {
    const boss = baseEnemy({ castCount: 2, patternPool: ['breaker', 'attacker'] })
    const res = resolveTurn({
      allies: [ally('a', { x: -6, y: -14 }), ally('b', { x: 6, y: -14 })],
      casts: [],
      enemies: [boss],
      castingEnemyIds: ['e0'],
      obstacles: [],
      mechanics: { obstacles: true, enemyFire: true },
    })
    expect(res.enemyShots).toHaveLength(2)
  })
})

describe('発射頻度（06b §2）', () => {
  const stage = (enemies: Enemy[]): Stage => ({
    id: 's', name: 'テスト', enemies, obstacles: [],
    introText: [], clearText: [], mechanics: { obstacles: true, enemyFire: true },
  })

  it('fireEvery=2 の敵は2ターンに1回だけ発射する', () => {
    const rupt = baseEnemy({ id: 'r', role: 'ruptor', family: 'wave', fireEvery: 2, fireOffset: 1 })
    const st = createBattleState(stage([rupt]), 0, [ally('a', { x: 0, y: -14 })])
    // turn=1: (1+1)%2=0 → 発射
    const p1 = prepareTurn(st)
    expect(p1.castingEnemyIds).toContain('r')
    // turn=2: (2+1)%2=1 → 撃たない
    const p2 = prepareTurn({ ...p1.state, turn: 2 })
    expect(p2.castingEnemyIds).not.toContain('r')
  })
})

describe('ボス HP フェーズと断末魔（#45）', () => {
  const phases: BossPhase[] = [
    { hpBelow: 0.66, castCount: 2, obstacles: [] },
    { hpBelow: 0.33, castCount: 3, obstacles: [], cullMinions: true },
  ]
  const bossStage = (): Stage => ({
    id: 'boss', name: 'ボス戦', boss: true,
    enemies: [
      baseEnemy({ id: 'boss', boss: true, castCount: 2, patternPool: ['breaker', 'attacker'], hp: 300, maxHp: 300 }),
      baseEnemy({ id: 'minion', pos: { x: 10, y: 18 }, hp: 100, maxHp: 100 }),
    ],
    obstacles: [],
    introText: [], clearText: [], mechanics: { obstacles: true, enemyFire: true },
    bossPhases: phases,
  })

  const party = [ally('a', { x: -8, y: -14 }), ally('b', { x: 0, y: -14 }), ally('c', { x: 8, y: -14 })]

  it('HP 66% を下回ると床が崩れ（フェーズ+1）、33% 未満で眷属が間引かれ castCount=3 になる', () => {
    let st = createBattleState(bossStage(), 6, party)
    // ボスを 60% まで削る（外部から直接 HP を操作して境界越えを再現）
    st = { ...st, enemies: st.enemies.map((e) => (e.boss ? { ...e, hp: 180 } : e)) }
    let r = resolveAllyCasts(st, [], [])
    expect(r.state.bossPhase).toBe(1)
    // さらに 30% へ
    st = { ...r.state, enemies: r.state.enemies.map((e) => (e.boss ? { ...e, hp: 90 } : e)) }
    r = resolveAllyCasts(st, [], [])
    expect(r.state.bossPhase).toBe(2)
    const boss = r.state.enemies.find((e) => e.boss)!
    expect(boss.castCount).toBe(3)
    // 眷属は崩落に呑まれた（下層＝ボス単独）
    expect(r.state.enemies.find((e) => e.id === 'minion')!.hp).toBe(0)
    // 勝敗はまだ ongoing（ボスが生きている）
    expect(r.state.outcome).toBe('ongoing')
  })

  it('ボス HP0 → 断末魔（暴発型3連）を挟んでから勝敗が確定する', () => {
    let st = createBattleState(bossStage(), 6, party)
    // ボスと眷属を撃破状態に
    st = { ...st, enemies: st.enemies.map((e) => ({ ...e, hp: 0 })) }
    let r = resolveAllyCasts(st, [], [])
    // 勝敗はまだ確定しない（finale=pending）
    expect(r.state.finale).toBe('pending')
    expect(r.state.outcome).toBe('ongoing')
    // 次ターン：ボスが暴発型3連の変異体として晒される
    const prep = prepareTurn(r.state)
    expect(prep.state.finale).toBe('cast')
    expect(prep.castingEnemyIds).toContain('boss')
    const bossNow = prep.state.enemies.find((e) => e.boss)!
    expect(bossNow.role).toBe('ruptor')
    expect(bossNow.castCount).toBe(3)
    // 解決：3本の暴発が飛ぶ（迎撃しなければ3回解決＝instability +3）
    const r2 = resolveAllyCasts(prep.state, [], prep.castingEnemyIds)
    expect(r2.resolution.enemyShots).toHaveLength(3)
    expect(r2.resolution.misfires.length).toBe(3)
    // 断末魔を解決し切ったので勝敗が確定する
    expect(r2.state.finale).toBe('done')
    expect(r2.state.outcome).toBe('cleared')
  })
})
