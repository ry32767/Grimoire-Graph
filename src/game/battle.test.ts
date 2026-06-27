import { describe, it, expect } from 'vitest'
import { createBattleState, prepareTurn, resolvePlayerAction } from './battle'
import type { Enemy, Mechanics, Stage, Trajectory } from './types'

const mech: Mechanics = { obstacles: false, shield: false, enemyFire: true, parry: false }

const enemy = (id: string, pos: { x: number; y: number }, hp: number, speed = 4): Enemy => ({
  id,
  name: id,
  pos,
  hp,
  maxHp: hp,
  element: 'dark',
  hitboxRadius: 1.1,
  statuses: [],
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: speed,
  castZ: -3, // 闇の敵弾
})

const stage = (enemies: Enemy[]): Stage => ({
  id: 's',
  name: 'テスト',
  enemies,
  obstacles: [],
  introText: [],
  clearText: [],
  mechanics: mech,
  recommendedPresetId: 'line',
})

// +x 軸に沿って飛び、関数値 z=x で光を帯びる光線（敵を反対極で撃てる）
const rayAttack = (speed = 8): { kind: 'attack'; trajectory: Trajectory; initialSpeed: number } => ({
  kind: 'attack',
  trajectory: { mode: 'rotate', g: (x) => x, angle: -Math.PI / 4 },
  initialSpeed: speed,
})

describe('戦闘状態の初期化', () => {
  it('プレイヤーHP満タン・敵クローン・ターン1で開始', () => {
    const s = createBattleState(stage([enemy('e', { x: 5, y: 0 }, 100)]), 0, 120)
    expect(s.player.hp).toBe(120)
    expect(s.enemies).toHaveLength(1)
    expect(s.turn).toBe(1)
    expect(s.outcome).toBe('ongoing')
  })
})

describe('勝敗判定（機能13）', () => {
  it('敵を全滅させるとクリア', () => {
    let s = createBattleState(stage([enemy('e', { x: 5, y: 0 }, 10)]), 0, 120)
    const prep = prepareTurn(s)
    const out = resolvePlayerAction(prep.state, rayAttack(9), [])
    s = out.state
    expect(s.enemies[0].hp).toBe(0)
    expect(s.outcome).toBe('cleared')
  })

  it('プレイヤーHPが0でゲームオーバー', () => {
    let s = createBattleState(stage([enemy('e', { x: 6, y: 0 }, 1000, 10)]), 0, 5)
    const prep = prepareTurn(s)
    const out = resolvePlayerAction(prep.state, rayAttack(3), prep.castingEnemyIds)
    s = out.state
    expect(s.player.hp).toBe(0)
    expect(s.outcome).toBe('gameover')
  })

  it('HPは0未満にならない', () => {
    let s = createBattleState(stage([enemy('e', { x: 5, y: 0 }, 5)]), 0, 120)
    const prep = prepareTurn(s)
    const out = resolvePlayerAction(prep.state, rayAttack(10), [])
    s = out.state
    expect(s.enemies[0].hp).toBeGreaterThanOrEqual(0)
  })
})

describe('状態異常のターン処理', () => {
  it('継続ダメージ（DoT）でターン開始時にHPが減る', () => {
    let s = createBattleState(stage([enemy('e', { x: 5, y: 0 }, 100)]), 0, 120)
    s = { ...s, player: { ...s.player, statuses: [{ kind: 'burn', magnitude: 5, remainingTurns: 2 }] } }
    const prep = prepareTurn(s)
    expect(prep.state.player.hp).toBeLessThan(120)
  })

  it('ひるみ中の敵は発射しない', () => {
    let s = createBattleState(stage([enemy('e', { x: 5, y: 0 }, 100)]), 0, 120)
    s = {
      ...s,
      enemies: [{ ...s.enemies[0], statuses: [{ kind: 'flinch', magnitude: 3, remainingTurns: 1 }] }],
    }
    const prep = prepareTurn(s)
    expect(prep.castingEnemyIds).not.toContain('e')
  })
})
