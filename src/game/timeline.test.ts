// 魔法の干渉を「ゲーム時刻の早い順」に解き、演出もその時刻で発火することの回帰テスト（#72）。
// 旧実装は結界の迎撃を幾何交差でパリィより先に全部解いていたため、
// 「先に相殺されて消えたはずの弾が、後方の結界を壊す」因果の逆転が起きていた。
import { describe, it, expect } from 'vitest'
import { resolveTurn } from './turn'
import { bulletRadius, powerFraction } from './collision'
import { bulletCollision } from './parry'
import { ringContact, attachRingSpeeds, buildRing } from './orbit'
import { simulateFlight } from './physics'
import { powerSizeFrac } from '../render/draw'
import { COMBAT, FIELD } from '../data/constants'
import type { Ally, AllyCast, Enemy, Mechanics, Trajectory } from './types'

const zLightMid = () => FIELD.zRef
const zDarkMid = () => -FIELD.zRef
const withFire: Mechanics = { obstacles: false, enemyFire: true }

const ally = (id: string, pos: { x: number; y: number }, element: Ally['element'], hp = 100): Ally => ({
  id, name: id, pos, hp, maxHp: hp, element, statuses: [],
})

const enemy = (id: string, pos: { x: number; y: number }, element: Enemy['element'], hp = 100, speed = 10): Enemy => ({
  id, name: id, pos, hp, maxHp: hp, element, hitboxRadius: 1.1, statuses: [],
  family: 'line',
  castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
  castInitialSpeed: speed,
  castZ: element === 'dark' ? -FIELD.zRef : FIELD.zRef,
  castZField: element === 'dark' ? zDarkMid : zLightMid,
})

const cast = (allyId: string, trajectory: Trajectory, speed = 10): AllyCast => ({ allyId, trajectory, initialSpeed: speed })

/** 原点に光の結界（半径5）を張る味方 a と、(20,0) から闇弾で a を狙う敵 e。 */
const guarded = () => ({
  a: ally('a', { x: 0, y: 0 }, 'light', 40),
  ring: cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zLightMid }),
  e: enemy('e', { x: 20, y: 0 }, 'dark', 100, 10),
})

describe('干渉は時刻順に解く（#72）', () => {
  it('迎撃されなければ結界は敵弾に破られ、破壊時刻と火花の時刻が一致する', () => {
    const { a, ring, e } = guarded()
    const res = resolveTurn({
      allies: [a], casts: [ring], enemies: [e], castingEnemyIds: ['e'], obstacles: [], mechanics: withFire,
    })
    const orb = res.allyShots.find((s) => s.kind === 'orbit')
    expect(orb?.broken).toBe(true)
    expect(res.orbits.length).toBe(0)
    // 破壊時刻はゲーム秒として妥当（0 でも Infinity でもない）
    expect(orb?.breakTime).toBeGreaterThan(0)
    expect(Number.isFinite(orb!.breakTime!)).toBe(true)
    // 火花はその破壊と同じ時刻で弾ける（演出が推定でなくエンジンの時刻で動く）
    expect(res.clashes.length).toBe(1)
    expect(res.clashes[0].t).toBeCloseTo(orb!.breakTime!, 6)
  })

  it('結界に届く前に敵弾が相殺されれば、結界は壊れない（因果の逆転をしない）', () => {
    const { a, ring, e } = guarded()
    // b は (14,-6) から真上へ撃つ。敵弾が x=14 を通る時刻と一致し、手前で相殺される
    const b = ally('b', { x: 14, y: -6 }, 'dark', 300)
    const bCast = cast('b', {
      mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: { x: 14, y: -6 }, z: zLightMid,
    }, 10)
    const res = resolveTurn({
      allies: [a, b], casts: [ring, bCast], enemies: [e], castingEnemyIds: ['e'], obstacles: [], mechanics: withFire,
    })
    expect(res.log.some((l) => l.kind === 'parry')).toBe(true)
    const orb = res.allyShots.find((s) => s.kind === 'orbit')
    expect(orb?.broken).toBe(false) // 敵弾はここまで届かない
    expect(orb?.breakTime).toBeNull()
    expect(res.orbits.length).toBe(1) // 結界は次ターンへ持ち越す
    // 相殺の時刻は、迎撃なしのときの結界破壊時刻より早い（＝時刻順に解けている）
    const alone = resolveTurn({
      allies: [a], casts: [ring], enemies: [e], castingEnemyIds: ['e'], obstacles: [], mechanics: withFire,
    })
    expect(res.clashes[0].t).toBeLessThan(alone.clashes[0].t)
  })

  it('暴発に呑まれた結界は爆発の時刻に霧散し、その状態が描画データにも載る', () => {
    const a = ally('a', { x: 0, y: 0 }, 'light', 100)
    const ring = cast('a', { mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zLightMid })
    // b の z 場は y=7（＝発射点から 5 進んだ所）に極を持つ＝そこで暴発し、AoE が結界を呑む
    const b = ally('b', { x: 0, y: -12 }, 'light', 100)
    const bCast = cast('b', {
      mode: 'rotate', g: () => 0, angle: Math.PI / 2, origin: { x: 0, y: -12 },
      z: (_x: number, y: number) => 1 / (7 - y),
    }, 10)
    const res = resolveTurn({
      allies: [a, b],
      casts: [ring, bCast],
      enemies: [enemy('e', { x: 30, y: 30 }, 'dark')],
      castingEnemyIds: [],
      obstacles: [],
      mechanics: withFire,
    })
    const orb = res.allyShots.find((s) => s.kind === 'orbit')
    // 結界を張った plan は暴発した plan より先に処理されるが、描画データは全解決後に組む
    expect(orb?.broken).toBe(true)
    expect(orb?.breakTime).toBeGreaterThan(0)
    // 爆発の火花と同じ時刻に霧散する（弾の経路上に無い破壊点でも演出がズレない）
    const blast = res.clashes.find((c) => c.power >= FIELD.sMax * FIELD.maxFlightSpeed - 1e-9)
    expect(blast).toBeDefined()
    expect(orb!.breakTime!).toBeCloseTo(blast!.t, 6)
  })
})

describe('当たり判定は描画される大きさと一致する（#72）', () => {
  it('弾の当たり半径は描画（powerSizeFrac）と同じ威力割合から引かれる', () => {
    // draw.powerSizeFrac は game.powerFraction の再輸出＝定義がひとつしかない
    expect(powerSizeFrac).toBe(powerFraction)
    const r0 = bulletRadius(0, 0)
    const rMax = bulletRadius(FIELD.maxFlightSpeed, FIELD.zPeak)
    expect(r0).toBeCloseTo(COMBAT.bulletRadiusMin, 10)
    expect(rMax).toBeCloseTo(COMBAT.bulletRadiusMax, 10)
    // 威力が上がるほど単調に大きくなる
    expect(bulletRadius(10, FIELD.zRef)).toBeGreaterThan(r0)
    expect(bulletRadius(10, FIELD.zRef)).toBeLessThan(rMax)
  })

  it('基準の弾（|z|=zRef・初速10）どうしは中心間およそ2.0で衝突する（旧 parryHitDist 相当）', () => {
    const reach = 2 * bulletRadius(10, FIELD.zRef)
    expect(reach).toBeGreaterThan(1.9)
    expect(reach).toBeLessThan(2.1)
  })

  it('正面から向かい合う2弾は互いの半径の和で衝突し、時刻を返す', () => {
    const left = simulateFlight({ mode: 'rotate', g: () => 0, angle: 0, origin: { x: -10, y: 0 }, z: zLightMid }, 10)
    const right = simulateFlight({ mode: 'rotate', g: () => 0, angle: Math.PI, origin: { x: 10, y: 0 }, z: zDarkMid }, 10)
    const rl = () => bulletRadius(10, FIELD.zRef)
    const col = bulletCollision(left.samples, right.samples, rl, rl)
    expect(col).not.toBeNull()
    expect(col!.time).toBeGreaterThan(0)
    // 中点（原点付近）で、両者が同じ時刻に居るところ
    expect(Math.hypot(col!.pos.x, col!.pos.y)).toBeLessThan(1.5)
  })

  it('結界への接触は「弾の半径＋帯の半厚み」で成立し、素通りする弾は接触しない', () => {
    const ring = attachRingSpeeds(buildRing({ mode: 'polar', f: () => 5, origin: { x: 0, y: 0 }, z: zLightMid }), 10)
    const r = () => bulletRadius(10, FIELD.zRef)
    // 原点を通る弾＝必ずリングへ触れる
    const through = simulateFlight({ mode: 'rotate', g: () => 0, angle: Math.PI, origin: { x: 20, y: 0 }, z: zDarkMid }, 10)
    const hit = ringContact(ring, through.samples, r)
    expect(hit).not.toBeNull()
    expect(hit!.time).toBeGreaterThan(0)
    // 接触点はリング半径のあたり（帯＋弾の半径ぶんの誤差内）
    const rr = Math.hypot(hit!.pos.x, hit!.pos.y)
    expect(Math.abs(rr - 5)).toBeLessThan(COMBAT.orbitBandHalf + bulletRadius(10, FIELD.zRef) + 0.2)
    // リングから十分離れて走る弾は触れない
    const far = simulateFlight({ mode: 'rotate', g: () => 0, angle: Math.PI, origin: { x: 20, y: 12 }, z: zDarkMid }, 10)
    expect(ringContact(ring, far.samples, r)).toBeNull()
  })
})
