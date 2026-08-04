// エンドロールは本番の解決（resolveTurn）をそのまま呼ぶ（#72）。
// かつては迎撃順・ダメージ式・相殺距離を独自に書き直していて、
//   - 結界が壁を無視して張り続ける（orbitWallBreak を呼んでいなかった）
//   - 相殺より先に迎撃を解くので、消えたはずの弾が結界を壊す
// といった本番と食い違う挙動が出ていた。ここでは「本番の関数を通ること」を固定する。
import { describe, it, expect } from 'vitest'
import { createEndroll } from './endroll'
import { resolveTurn } from '../game/turn'
import { FIELD } from '../data/constants'
import type { Ally, Enemy, Mechanics, Obstacle } from '../game/types'

const withAll: Mechanics = { obstacles: true, enemyFire: true }

describe('エンドロールの自動対戦（#72）', () => {
  it('幕の組み立てが本番の解決を通って完走する（例外を出さない）', () => {
    const s = createEndroll(0)
    expect(s.obstacles.length).toBeGreaterThan(0)
    expect(s.round).not.toBeNull()
    expect(s.hpA).toBeGreaterThan(0)
    expect(s.hpB).toBeGreaterThan(0)
  })

  it('結界が壁の素材に触れれば霧散する（エンドロールでも本番と同じ扱いになる）', () => {
    // 半径5の周回リングの真上に壁を置く＝リング点が素材内に入る
    const wall: Obstacle = {
      id: 'w',
      element: 'neutral',
      solids: [{ x: 5, y: 0, r: 1.2 }],
      carves: [],
    }
    const a: Ally = { id: 'a', name: 'a', pos: { x: 0, y: 0 }, hp: 100, maxHp: 100, element: 'light', statuses: [] }
    const e: Enemy = {
      id: 'e', name: 'e', pos: { x: 25, y: 25 }, hp: 100, maxHp: 100, element: 'dark',
      hitboxRadius: 1.1, statuses: [], family: 'line',
      castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
      castInitialSpeed: 10, castZ: -FIELD.zRef,
    }
    const res = resolveTurn({
      allies: [a],
      casts: [{
        allyId: 'a',
        trajectory: { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: () => FIELD.zRef },
        initialSpeed: 10,
      }],
      enemies: [e],
      castingEnemyIds: [],
      obstacles: [wall],
      mechanics: withAll,
    })
    const orb = res.allyShots.find((s) => s.kind === 'orbit')
    expect(orb?.broken).toBe(true)
    expect(orb?.breakTime).toBe(0) // 壁による自壊は「回り始める前」＝時刻0
    expect(res.orbits.length).toBe(0) // 次の幕へ持ち越さない
  })
})
