import { describe, it, expect } from 'vitest'
import { planEnemyShot, enemyFlight, ARCHETYPES } from './enemyAI'
import { firstHit } from './collision'
import { GAME } from '../data/constants'
import type { Ally, Enemy, EnemyFamily } from './types'

const ally = (id: string, pos: { x: number; y: number }, element: Ally['element'] = 'neutral', hp = 100, maxHp = 100): Ally => ({
  id,
  name: id,
  pos,
  hp,
  maxHp,
  element,
  statuses: [],
})

const enemy = (pos: { x: number; y: number }, family: EnemyFamily, element: Enemy['element'] = 'dark'): Enemy => ({
  id: 'e',
  name: 'e',
  pos,
  hp: 100,
  maxHp: 100,
  element,
  hitboxRadius: 1.2,
  statuses: [],
  family,
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: 6,
  castZ: -4,
})

describe('敵AIの攻撃計画（#2/#17）', () => {
  it('全familyが存在し、ラベルを持つ', () => {
    for (const f of ['line', 'arc', 'wave', 'spiral'] as EnemyFamily[]) {
      expect(ARCHETYPES[f].label.length).toBeGreaterThan(0)
    }
  })

  it('直進型は狙った味方に命中する軌道を選ぶ', () => {
    const e = enemy({ x: 0, y: 8 }, 'line')
    const target = ally('t', { x: 0, y: -8 })
    const plan = planEnemyShot(e, [ally('o', { x: 9, y: 9 }), target])
    expect(plan).not.toBeNull()
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed, e.castZ)
    expect(firstHit(flight.samples, target.pos, GAME.allyHitbox)).not.toBeNull()
  })

  it('相性有利（反対極）かつ低HPの相手を優先して狙う', () => {
    // 闇の敵：光の味方に×1.5。光(低HP)と中立(満タン)を並べると光を狙う
    const e = enemy({ x: 0, y: 8 }, 'line')
    const lightLow = ally('light', { x: -4, y: -8 }, 'light', 30)
    const neutralFull = ally('neutral', { x: 4, y: -8 }, 'neutral', 100)
    const plan = planEnemyShot(e, [neutralFull, lightLow])
    expect(plan?.targetId).toBe('light')
  })

  it('味方が全滅していれば null', () => {
    const e = enemy({ x: 0, y: 8 }, 'wave')
    expect(planEnemyShot(e, [ally('d', { x: 0, y: 0 }, 'neutral', 0)])).toBeNull()
  })

  it('波・弧・渦型も軌道を返す（牽制含む）', () => {
    for (const f of ['arc', 'wave', 'spiral'] as EnemyFamily[]) {
      const plan = planEnemyShot(enemy({ x: 0, y: 8 }, f), [ally('t', { x: 0, y: -8 })])
      expect(plan).not.toBeNull()
    }
  })
})
