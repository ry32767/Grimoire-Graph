// 暴発の不安定化・累積・崩壊（04b）のテスト。
import { describe, it, expect } from 'vitest'
import {
  varianceOf,
  misfireRadius,
  misfireRadiusBand,
  anomalyLevel,
  shouldFirstCollapse,
  isLethal,
  remainingMisfires,
  applyStageClearRelief,
} from './misfireInstability'
import { resolveTurn } from './turn'
import { FIELD, INSTABILITY } from '../data/constants'
import type { Ally, Enemy } from './types'

const ally = (id: string, pos: { x: number; y: number }, hp = 500): Ally => ({
  id, name: id, pos, hp, maxHp: hp, element: 'neutral', statuses: [],
})
const ruptor = (pos: { x: number; y: number }): Enemy => ({
  id: 'r', name: '崩し手', pos, hp: 100, maxHp: 100, element: 'dark', hitboxRadius: 1.8,
  statuses: [], family: 'wave', role: 'ruptor',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 }, castInitialSpeed: 8, castZ: -3,
})

describe('半径ばらつき v(count)（04b §4b.3）', () => {
  it('vStart 未満はブレなし・count 単調増・上限 vMax', () => {
    expect(varianceOf(0)).toBe(0)
    expect(varianceOf(INSTABILITY.vStart)).toBe(0)
    expect(varianceOf(5)).toBeGreaterThan(varianceOf(3))
    expect(varianceOf(INSTABILITY.misfireLimit)).toBeCloseTo(INSTABILITY.vMax, 10)
    expect(varianceOf(99)).toBeCloseTo(INSTABILITY.vMax, 10)
  })

  it('roll=0.5 で実半径はちょうど aoeRadius（平均不変）', () => {
    expect(misfireRadius(0, 0.5)).toBeCloseTo(FIELD.aoeRadius, 10)
    expect(misfireRadius(12, 0.5)).toBeCloseTo(FIELD.aoeRadius, 10)
  })

  it('実半径はブレ帯 [min,max] の範囲に収まる', () => {
    const band = misfireRadiusBand(8)
    expect(band.min).toBeLessThan(FIELD.aoeRadius)
    expect(band.max).toBeGreaterThan(FIELD.aoeRadius)
    for (const roll of [0, 0.25, 0.75, 0.999]) {
      const r = misfireRadius(8, roll)
      expect(r).toBeGreaterThanOrEqual(band.min - 1e-9)
      expect(r).toBeLessThanOrEqual(band.max + 1e-9)
    }
  })
})

describe('三段階の開示（04b §4b.2）', () => {
  it('異変の段階は count 単調増', () => {
    expect(anomalyLevel(0)).toBe(0)
    expect(anomalyLevel(2)).toBe(1)
    expect(anomalyLevel(4)).toBe(2)
    expect(anomalyLevel(5)).toBe(3)
  })

  it('初回崩壊：閾値到達で起きる（閾値優先）', () => {
    expect(shouldFirstCollapse(INSTABILITY.firstCollapseThreshold, 3, 1, false)).toBe(true)
    expect(shouldFirstCollapse(INSTABILITY.firstCollapseThreshold - 1, 3, 5, false)).toBe(false)
  })

  it('初回崩壊：閾値未達でも保証面（第6面）で必ず起きる', () => {
    expect(shouldFirstCollapse(0, INSTABILITY.firstCollapseStage, 2, false)).toBe(true)
    expect(shouldFirstCollapse(0, INSTABILITY.firstCollapseStage - 1, 9, false)).toBe(false)
  })

  it('初回崩壊は一度きり（collapseSeen なら二度と起きない）', () => {
    expect(shouldFirstCollapse(99, 7, 9, true)).toBe(false)
  })

  it('致死判定と残り回数', () => {
    expect(isLethal(INSTABILITY.misfireLimit - 1)).toBe(false)
    expect(isLethal(INSTABILITY.misfireLimit)).toBe(true)
    expect(remainingMisfires(INSTABILITY.misfireLimit - 3)).toBe(3)
    expect(remainingMisfires(99)).toBe(0)
  })

  it('暴発ゼロクリアの緩和（下限0）', () => {
    expect(applyStageClearRelief(3, 0)).toBe(2)
    expect(applyStageClearRelief(3, 1)).toBe(3)
    expect(applyStageClearRelief(0, 0)).toBe(0)
  })
})

describe('resolveTurn への統合：暴発 AoE 半径が instability でばらつく', () => {
  it('instability が高くロールが大きいと、既定半径の外の対象まで巻き込む', () => {
    const e = ruptor({ x: 0, y: 10 })
    const t = ally('t', { x: 0, y: -8 })
    // 既定半径(5)の少し外・最大ブレ半径(5×1.6=8)の内側に置く
    const bystander = ally('b', { x: 6.5, y: -8 })
    const base = {
      allies: [t, bystander],
      casts: [],
      enemies: [e],
      castingEnemyIds: ['r'],
      obstacles: [],
      mechanics: { obstacles: true, enemyFire: true },
    }
    // ブレなし（roll=0.5）：巻き込まれない
    const calm = resolveTurn({ ...base, instability: INSTABILITY.misfireLimit, misfireRoll: 0.5 })
    expect(calm.allies.find((a) => a.id === 'b')!.hp).toBe(bystander.hp)
    // 最大側のロール：半径が広がって巻き込まれる
    const wild = resolveTurn({ ...base, instability: INSTABILITY.misfireLimit, misfireRoll: 0.999 })
    expect(wild.allies.find((a) => a.id === 'b')!.hp).toBeLessThan(bystander.hp)
  })
})
