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
// 原点から +x の光線（経路は g=x、属性は z 場で光・最強）
const ray = (origin: { x: number; y: number }): Trajectory => ({ mode: 'rotate', g: (x) => x, angle: -Math.PI / 4, origin, z: () => FIELD.zPeak })

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
