import { describe, it, expect } from 'vitest'
import { planEnemyShot, enemyFlight, ARCHETYPES } from './enemyAI'
import { firstHit } from './collision'
import { classifyTrajectory } from './loop'
import { GAME } from '../data/constants'
import type { Ally, Enemy, EnemyFamily, Obstacle } from './types'

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
    const decoy = ally('o', { x: 9, y: 9 })
    const allies = [decoy, target]
    const plan = planEnemyShot(e, allies)
    expect(plan).not.toBeNull()
    // AI が狙うと宣言した相手に実際に命中する軌道であること（誰を狙うかは AI 次第）
    const aimed = allies.find((a) => a.id === plan!.targetId)!
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    expect(firstHit(flight.samples, aimed.pos, GAME.allyHitbox)).not.toBeNull()
  })

  it('相性有利（反対極）かつ低HPの相手を優先して狙う', () => {
    // 闇の敵：光の味方に×1.5。光(低HP)と中立(満タン)を並べると光を狙う
    const e = enemy({ x: 0, y: 8 }, 'line')
    const lightLow = ally('light', { x: -4, y: -8 }, 'light', 30)
    const neutralFull = ally('neutral', { x: 4, y: -8 }, 'neutral', 100)
    const plan = planEnemyShot(e, [neutralFull, lightLow])
    expect(plan?.targetId).toBe('light')
  })

  it('闇の周回で完全に隠れた味方は狙わない（#35）', () => {
    // 闇の敵：低HPの光味方が居るが、完全隠蔽(concealed=full)なら視認不可で別の味方を狙う
    const e = enemy({ x: 0, y: 8 }, 'line')
    const hidden = { ...ally('hidden', { x: -4, y: -8 }, 'light', 20), concealed: 2 }
    const visible = ally('visible', { x: 4, y: -8 }, 'light', 90)
    const plan = planEnemyShot(e, [hidden, visible])
    expect(plan?.targetId).toBe('visible')
  })

  it('1重の闇周回は狙いをずらす（#35）', () => {
    // concealed=1 の味方を狙うと、見かけ位置（ずれた位置）へ撃つため真の位置から外れる
    const e = enemy({ x: 0, y: 10 }, 'line')
    const concealedTarget = { ...ally('t', { x: 0, y: -8 }, 'light', 100), concealed: 1 }
    const plan = planEnemyShot(e, [concealedTarget])
    expect(plan).not.toBeNull()
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    // 真の位置には当たりにくくなる（見かけ位置へ逸れる）
    expect(firstHit(flight.samples, concealedTarget.pos, GAME.allyHitbox)).toBeNull()
  })

  it('味方が全滅していれば null', () => {
    const e = enemy({ x: 0, y: 8 }, 'wave')
    expect(planEnemyShot(e, [ally('d', { x: 0, y: 0 }, 'neutral', 0)])).toBeNull()
  })

  it('guardian ロールは防御用の周回結界（閉軌道）を張る（#28）', () => {
    const guard: Enemy = { ...enemy({ x: 0, y: 10 }, 'spiral'), role: 'guardian' }
    const plan = planEnemyShot(guard, [ally('t', { x: 0, y: -8 })])
    expect(plan).not.toBeNull()
    expect(classifyTrajectory(plan!.trajectory)).toBe('orbit')
  })

  it('breaker ロールは壁ごしでも貫いて狙う（障害物ペナルティを受けない・#28）', () => {
    // 敵(0,8)→味方(0,-8) の直線上に壁。breaker は減点されず、attacker より高評価になる
    const wall: Obstacle = { id: 'w', element: 'dark', solids: [{ x: 0, y: 0, r: 2 }], carves: [] }
    const target = ally('t', { x: 0, y: -8 }, 'light')
    const attacker: Enemy = enemy({ x: 0, y: 8 }, 'line')
    const breaker: Enemy = { ...attacker, role: 'breaker' }
    const aPlan = planEnemyShot(attacker, [target], [wall])
    const bPlan = planEnemyShot(breaker, [target], [wall])
    expect(aPlan).not.toBeNull()
    expect(bPlan).not.toBeNull()
    expect(bPlan!.expectedDamage).toBeGreaterThan(aPlan!.expectedDamage)
  })

  it('複数得意関数（families）を持つ敵も軌道を返す（#28）', () => {
    const multi: Enemy = { ...enemy({ x: 0, y: 8 }, 'line'), families: ['arc', 'wave'] }
    const plan = planEnemyShot(multi, [ally('t', { x: 0, y: -8 })])
    expect(plan).not.toBeNull()
  })

  it('波・弧・渦型も軌道を返す（牽制含む）', () => {
    for (const f of ['arc', 'wave', 'spiral'] as EnemyFamily[]) {
      const plan = planEnemyShot(enemy({ x: 0, y: 8 }, f), [ally('t', { x: 0, y: -8 })])
      expect(plan).not.toBeNull()
    }
  })
})
