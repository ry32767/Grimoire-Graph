// 敵の読み（#75）：一つ前のターンに味方が撃った魔法が「次のターンも同じように飛んでくる」と
// 仮定して、相殺されない経路・狙いを選ぶ。敵の LVL には依存しない（全個体が読む）。
import { describe, it, expect } from 'vitest'
import { planEnemyShot, enemyFlight } from './enemyAI'
import { predictAllyShots, foreseeInterception, type PredictedShot } from './enemyPlanning/foresight'
import { zfieldAt } from './attribute'
import { constZField } from './zfields'
import { FIELD } from '../data/constants'
import type { Ally, AllyCast, Enemy, EnemyFamily, Trajectory, Vec2 } from './types'

const ally = (id: string, pos: Vec2, hp = 100): Ally => ({
  id,
  name: id,
  pos,
  hp,
  maxHp: 100,
  element: 'neutral',
  statuses: [],
})

const enemy = (pos: Vec2, family: EnemyFamily): Enemy => ({
  id: 'e',
  name: 'e',
  pos,
  hp: 100,
  maxHp: 100,
  element: 'dark',
  hitboxRadius: 1.2,
  statuses: [],
  family,
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: 6,
  castZ: -4,
})

/** 味方 from から to へ真っ直ぐ飛ぶ手（z は一定・強さ mag）。 */
const straightCast = (allyId: string, from: Vec2, to: Vec2, mag: number, speed: number): AllyCast => ({
  allyId,
  trajectory: {
    mode: 'rotate',
    g: () => 0,
    angle: Math.atan2(to.y - from.y, to.x - from.x),
    origin: from,
    z: constZField(mag),
  } as Trajectory,
  initialSpeed: speed,
})

/** 計画した敵弾が予測した味方弾に相殺されるか（残速度の比。null=当たらない）。 */
const interceptOf = (traj: Trajectory, speed: number, predicted: PredictedShot[]) => {
  const { flight } = enemyFlight(traj, speed)
  return foreseeInterception(flight.samples, (p) => zfieldAt(traj, p), predicted)
}

describe('敵の読み：前ターンと同じ魔法が飛んでくると仮定する（#75）', () => {
  it('倒れた味方の手と周回結界は予測しない（結界は standingRings で既に見えている）', () => {
    const alive = ally('a', { x: -6, y: -8 })
    const down = ally('b', { x: 6, y: -8 }, 0)
    const casts: AllyCast[] = [
      straightCast('a', alive.pos, { x: 0, y: 8 }, -FIELD.zRef, 6),
      straightCast('b', down.pos, { x: 0, y: 8 }, -FIELD.zRef, 6), // 倒れている＝撃ってこない
      // 周回結界（orbit）は二重計上になるので除外する
      {
        allyId: 'a',
        trajectory: { mode: 'polar', f: () => 5, origin: alive.pos, z: constZField(-FIELD.zRef) },
        initialSpeed: 6,
      },
    ]
    expect(predictAllyShots(casts, [alive, down])).toHaveLength(1)
    expect(predictAllyShots(undefined, [alive, down])).toHaveLength(0)
  })

  it('撃ち返しの正面を避けて狙いを選び直す（レベルの指定が無い個体でも読む）', () => {
    const A = ally('A', { x: 0, y: -9 })
    const B = ally('B', { x: 11, y: -9 })
    const e = enemy({ x: 0, y: 9 }, 'line') // level 未設定＝LVL に依らず読む
    // A は前ターン、敵へ真っ直ぐ強い闇弾（減速しない zRef・高速）を撃った
    const predicted = predictAllyShots([straightCast('A', A.pos, e.pos, -FIELD.zRef, 12)], [A, B])
    expect(predicted).toHaveLength(1)

    // 読み無し：正面の A を狙い、その一撃は A の撃ち返しに完全に消される
    const naive = planEnemyShot(e, [A, B])!
    expect(naive.targetId).toBe('A')
    expect(interceptOf(naive.trajectory, e.castInitialSpeed, predicted)?.speedRatio).toBe(0)

    // 読みあり：撃ち返しの来ない B へ切り替え、威力を落とさず届かせる
    const wary = planEnemyShot(e, [A, B], [], [], [], undefined, 0, [], { predicted })!
    expect(wary.targetId).toBe('B')
    expect(interceptOf(wary.trajectory, e.castInitialSpeed, predicted)).toBeNull()
    expect(wary.expectedDamage).toBeCloseTo(naive.expectedDamage, 5)
  })

  it('撃ち落とされる通路を捨てて、別の通路から回り込む（#76）', () => {
    // 壁（unbreakable）に通路が2本：中央（|x|<2）と右（7.5<x<12.5）。
    // 味方は中央の通路を真っ直ぐ上って撃ち返してくる＝中央を通る一撃は必ず消される。
    const A = ally('A', { x: 0, y: -16 })
    const e = { ...enemy({ x: 0, y: 16 }, 'arc'), families: ['arc', 'abs', 'poly34'] as EnemyFamily[], level: 6 }
    const walls = [
      {
        id: 'W', element: 'neutral' as const, carves: [], solids: [], kind: 'unbreakable' as const,
        rects: [
          { x: -30, y: -3, w: 28, h: 6 },
          { x: 2, y: -3, w: 5.5, h: 6 },
          { x: 12.5, y: -3, w: 17.5, h: 6 },
        ],
      },
    ]
    const predicted = predictAllyShots([straightCast('A', A.pos, e.pos, -FIELD.zRef, 12)], [A])
    const plan = (opts: { predicted?: PredictedShot[] }) =>
      planEnemyShot(e, [A], walls, [], [], FIELD.rField, 0, [], opts)!

    // 読み無し：最短の中央通路を撃ち、その一撃は撃ち返しに完全に消される
    const naive = plan({})
    expect(interceptOf(naive.trajectory, e.castInitialSpeed, predicted)?.speedRatio).toBe(0)

    // 読みあり：右の通路へ回り込み、消されずに同じだけの威力で当てる
    const wary = plan({ predicted })
    expect(interceptOf(wary.trajectory, e.castInitialSpeed, predicted)).toBeNull()
    expect(wary.expectedDamage).toBeGreaterThan(0)
  })

  it('暴発型も迎撃確定の直通候補を成功扱いせず、予測弾を避ける経路を探す', () => {
    const A = ally('A', { x: 0, y: -16 })
    const e = {
      ...enemy({ x: 0, y: 16 }, 'arc'),
      role: 'ruptor' as const,
      families: ['arc', 'abs', 'poly34'] as EnemyFamily[],
      level: 6,
    }
    const naive = planEnemyShot(e, [A], [], [], [], FIELD.rField)!
    const { flight } = enemyFlight(naive.trajectory, e.castInitialSpeed)
    const total = flight.samples[flight.samples.length - 1].arcLen
    const predicted: PredictedShot[] = [{
      samples: [...flight.samples].reverse().map((s) => ({
        ...s,
        arcLen: total - s.arcLen,
        speed: 12,
      })),
      zAt: () => FIELD.zRef,
    }]
    const wary = planEnemyShot(e, [A], [], [], [], FIELD.rField, 0, [], { predicted })!

    expect(interceptOf(naive.trajectory, e.castInitialSpeed, predicted)?.speedRatio).toBe(0)
    expect(interceptOf(wary.trajectory, e.castInitialSpeed, predicted)).toBeNull()
  })

  it('逃げ場が無ければ期待ダメージが相殺ぶん割り引かれる（見込みを偽らない）', () => {
    const A = ally('A', { x: 0, y: -9 })
    const e = enemy({ x: 0, y: 9 }, 'line')
    const predicted = predictAllyShots([straightCast('A', A.pos, e.pos, -FIELD.zRef, 12)], [A])
    const naive = planEnemyShot(e, [A])!
    const wary = planEnemyShot(e, [A], [], [], [], undefined, 0, [], { predicted })!
    expect(naive.expectedDamage).toBeGreaterThan(0)
    expect(wary.expectedDamage).toBe(0) // 撃ち落とされる＝見込み 0（それでも撃つ手は返す）
    expect(wary.trajectory).toBeTruthy()
  })

  it('同極の味方弾はすり抜けるので読みの対象にならない（反対極だけが相殺する）', () => {
    const A = ally('A', { x: 0, y: -9 })
    const e = enemy({ x: 0, y: 9 }, 'line')
    // 敵は無属性の相手へ光（+z）で撃つ。味方も光なら相殺しない＝計画は変わらない
    const same = predictAllyShots([straightCast('A', A.pos, e.pos, FIELD.zRef, 12)], [A])
    const naive = planEnemyShot(e, [A])!
    const wary = planEnemyShot(e, [A], [], [], [], undefined, 0, [], { predicted: same })!
    expect(interceptOf(wary.trajectory, e.castInitialSpeed, same)).toBeNull()
    expect(wary.expectedDamage).toBe(naive.expectedDamage)
  })

  it('読みが無ければ従来どおりの計画（履歴の無い初手は挙動を変えない）', () => {
    const A = ally('A', { x: 0, y: -9 })
    const e = enemy({ x: 0, y: 9 }, 'arc')
    const a = planEnemyShot(e, [A])!
    const b = planEnemyShot(e, [A], [], [], [], undefined, 0, [], { predicted: [] })!
    expect(b.expectedDamage).toBe(a.expectedDamage)
    expect(b.targetId).toBe(a.targetId)
  })
})
