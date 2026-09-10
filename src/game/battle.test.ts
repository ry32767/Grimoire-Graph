import { describe, it, expect } from 'vitest'
import { createBattleState, prepareTurn, resolveAllyCasts } from './battle'
import { FIELD } from '../data/constants'
import type { Ally, AllyCast, Enemy, Mechanics, Stage, Trajectory } from './types'

const mech: Mechanics = { obstacles: false, enemyFire: true }

const party = (...allies: Ally[]): Ally[] => allies
const ally = (id: string, pos: { x: number; y: number }, hp = 100, element: Ally['element'] = 'neutral'): Ally => ({
  id,
  name: id,
  pos,
  hp,
  maxHp: hp,
  element,
  statuses: [],
})

const enemy = (id: string, pos: { x: number; y: number }, hp: number, speed = 5): Enemy => ({
  id,
  name: id,
  pos,
  hp,
  maxHp: hp,
  element: 'dark',
  hitboxRadius: 1.1,
  statuses: [],
  family: 'line',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: speed,
  castZ: -5,
})

const stage = (enemies: Enemy[]): Stage => ({
  id: 's',
  name: 'テスト',
  enemies,
  obstacles: [],
  introText: [],
  clearText: [],
  mechanics: mech,
})

const cast = (allyId: string, trajectory: Trajectory, speed = 8): AllyCast => ({ allyId, trajectory, initialSpeed: speed })
// 原点から +x の光線（経路は g=x、属性は z 場で光）。減速しない zRef で敵まで確実に届く（#31）
const ray = (origin: { x: number; y: number }): Trajectory => ({ mode: 'rotate', g: (x) => x, angle: -Math.PI / 4, origin, z: () => FIELD.zRef })

describe('戦闘状態の初期化', () => {
  it('味方HP満タン・敵クローン・ターン1で開始', () => {
    const s = createBattleState(stage([enemy('e', { x: 0, y: 8 }, 100)]), 0, party(ally('a', { x: 0, y: 0 })))
    expect(s.allies[0].hp).toBe(100)
    expect(s.enemies).toHaveLength(1)
    expect(s.turn).toBe(1)
    expect(s.outcome).toBe('ongoing')
  })
})

describe('勝敗判定（#15）', () => {
  it('敵を全滅させるとクリア', () => {
    let s = createBattleState(stage([enemy('e', { x: 5, y: 0 }, 10)]), 0, party(ally('a', { x: 0, y: 0 })))
    const prep = prepareTurn(s)
    const out = resolveAllyCasts(prep.state, [cast('a', ray({ x: 0, y: 0 }))], [])
    s = out.state
    expect(s.enemies[0].hp).toBe(0)
    expect(s.outcome).toBe('cleared')
  })

  it('全味方のHPが0でゲームオーバー', () => {
    let s = createBattleState(stage([enemy('e', { x: 0, y: 6 }, 1000, 12)]), 0, party(ally('a', { x: 0, y: 0 }, 5)))
    const prep = prepareTurn(s)
    // 敵だけ発射（味方は当てない＝原点から上へ逸らす）
    const out = resolveAllyCasts(prep.state, [cast('a', { mode: 'rotate', g: () => 0, angle: 0, origin: { x: 0, y: 0 } })], prep.castingEnemyIds)
    s = out.state
    expect(s.allies[0].hp).toBe(0)
    expect(s.outcome).toBe('gameover')
  })

  it('HPは0未満にならない', () => {
    let s = createBattleState(stage([enemy('e', { x: 5, y: 0 }, 5)]), 0, party(ally('a', { x: 0, y: 0 })))
    const prep = prepareTurn(s)
    const out = resolveAllyCasts(prep.state, [cast('a', ray({ x: 0, y: 0 }), 10)], [])
    s = out.state
    expect(s.enemies[0].hp).toBeGreaterThanOrEqual(0)
  })
})

describe('状態異常のターン処理', () => {
  it('DoTで死亡した敵味方の結界だけを準備時に消し、回復効果も残さない', () => {
    const s = createBattleState(stage([
      enemy('dead-e', { x: 10, y: 0 }, 1), enemy('live-e', { x: 15, y: 0 }, 100),
    ]), 0, party(ally('dead-a', { x: -10, y: 0 }, 1), ally('live-a', { x: 0, y: 0 })))
    s.allies[0].statuses = [{ kind: 'burn', magnitude: 2, remainingTurns: 1 }]
    s.enemies[0].statuses = [{ kind: 'burn', magnitude: 2, remainingTurns: 1 }]
    s.allies[1].hp = 50
    s.orbits = [
      { id: 'dead-a-ring', owner: 'player', ownerId: 'dead-a', ringSpeed: 8,
        ring: Array.from({ length: 64 }, (_, i) => ({ pos: { x: 3 * Math.cos(i * Math.PI / 32), y: 3 * Math.sin(i * Math.PI / 32) }, z: 5 })) },
      { id: 'dead-e-ring', owner: 'enemy', ownerId: 'dead-e', ringSpeed: 8, ring: [] },
      { id: 'live-a-ring', owner: 'player', ownerId: 'live-a', ringSpeed: 8, ring: [] },
      { id: 'live-e-ring', owner: 'enemy', ownerId: 'live-e', ringSpeed: 8, ring: [] },
    ]
    const prep = prepareTurn(s)
    expect(prep.state.orbits?.map((o) => o.id)).toEqual(['live-a-ring', 'live-e-ring'])
    expect(resolveAllyCasts(prep.state, [], []).state.allies[1].hp).toBe(50)
    expect(s.orbits).toHaveLength(4)
  })

  it('継続ダメージ（DoT）でターン開始時に味方HPが減る', () => {
    let s = createBattleState(stage([enemy('e', { x: 0, y: 8 }, 100)]), 0, party(ally('a', { x: 0, y: 0 })))
    s = { ...s, allies: [{ ...s.allies[0], statuses: [{ kind: 'burn', magnitude: 5, remainingTurns: 2 }] }] }
    const prep = prepareTurn(s)
    expect(prep.state.allies[0].hp).toBeLessThan(100)
  })

  it('ひるみ中の敵は発射しない／味方は impaired に入る', () => {
    let s = createBattleState(stage([enemy('e', { x: 0, y: 8 }, 100)]), 0, party(ally('a', { x: 0, y: 0 })))
    s = {
      ...s,
      enemies: [{ ...s.enemies[0], statuses: [{ kind: 'flinch', magnitude: 3, remainingTurns: 1 }] }],
      allies: [{ ...s.allies[0], statuses: [{ kind: 'flinch', magnitude: 3, remainingTurns: 1 }] }],
    }
    const prep = prepareTurn(s)
    expect(prep.castingEnemyIds).not.toContain('e')
    expect(prep.impairedAllyIds).toContain('a')
  })
})

describe('壁狙いデモの崩し手（#42・06 第4面）', () => {
  it('最初の1発を解決したら以後は味方狙い（ruptorTarget が allies へ切り替わる）', () => {
    const demo: Enemy = {
      ...enemy('r', { x: 0, y: 12 }, 100),
      role: 'ruptor',
      family: 'wave',
      ruptorTarget: 'obstacles',
    }
    const s0 = createBattleState(stage([demo]), 0, party(ally('a', { x: 0, y: -12 })))
    // 1ターン目：壁狙いのまま発射 → 解決後に allies へ切り替わる
    const r1 = resolveAllyCasts(s0, [], ['r'])
    expect(r1.state.enemies[0].ruptorTarget).toBe('allies')
    // 発射しなかったターンでは切り替わらない
    const s1 = createBattleState(stage([demo]), 0, party(ally('a', { x: 0, y: -12 })))
    const r2 = resolveAllyCasts(s1, [], [])
    expect(r2.state.enemies[0].ruptorTarget).toBe('obstacles')
  })
})
