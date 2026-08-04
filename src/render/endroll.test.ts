// エンドロールは本番の解決（resolveTurn）をそのまま呼ぶ（#72）。
// かつては迎撃順・ダメージ式・相殺距離を独自に書き直していて、
//   - 結界が壁を無視して張り続ける（orbitWallBreak を呼んでいなかった）
//   - 相殺より先に迎撃を解くので、消えたはずの弾が結界を壊す
// といった本番と食い違う挙動が出ていた。ここでは「本番の関数を通ること」を固定する。
import { describe, it, expect } from 'vitest'
import { createEndroll, drawEndroll } from './endroll'
import { ringPhaseKey } from './ringPhase'
import { resolveTurn } from '../game/turn'
import { FIELD } from '../data/constants'
import type { Ally, Enemy, Mechanics, Obstacle, ZPoint } from '../game/types'

const withAll: Mechanics = { obstacles: true, enemyFire: true }

/** Canvas を持たない環境で drawEndroll を回すための最小のスタブ（描画命令は捨てる）。 */
function stubCtx(): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1, font: '', globalCompositeOperation: '' }
  const noop = () => undefined
  const gradient = { addColorStop: noop }
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient
      if (prop === 'measureText') return () => ({ width: 10 })
      return noop
    },
    set(target, prop, value) {
      target[prop as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

/** 半分が低速・半分が高速のリング（|z| による加減速を模した速度分布）。 */
function unevenRing(): ZPoint[] {
  const out: ZPoint[] = []
  const n = 72
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push({ pos: { x: Math.cos(a) * 5, y: Math.sin(a) * 5 }, z: 1, speed: i < n / 2 ? 1 : 20 })
  }
  return out
}

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

  it('次の幕の先取り計画は「この幕を解決し終えた盤面」で行う（A 側だけ古い盤面を見ない）', () => {
    // B 側は resolveTurn の中で最新の盤面を見る。先取りが古い状態のままだと
    // A 側だけ「削れる前の壁・古い結界・古い HP・古い読み」で計画する非対称になる。
    let s = createEndroll(0)
    for (let i = 0; i < 10 && !s.round; i++) s = createEndroll(0)
    const round = s.round
    if (!round) throw new Error('幕が組み立てられていない')
    round.obstacles = [] // 壁の描画はオフスクリーン Canvas を使うので外す
    round.damages = [] // 決着させない（先取りは決着していない幕でだけ動く）
    drawEndroll(stubCtx(), s, 800, 600, Math.max(0.1, round.duration - 2.0) * 1000)
    const pre = s.pre
    if (!pre) throw new Error('先取り計画が始まっていない')
    expect(pre.board.hpA).toBe(round.after.hpA)
    expect(pre.board.hpB).toBe(round.after.hpB)
    expect(pre.board.obstacles).toBe(round.after.obstacles)
    expect(pre.board.orbits).toBe(round.after.orbits)
    expect(pre.board.lastEnemyCasts).toBe(round.after.enemyCasts)
  })

  it('結界の粒は「その場のリング速度」で流れる（本編 drawOrbitRing と同じ規則）', () => {
    // かつては「3.4秒で必ず一周」の自前回転を描いていたため、|z|<zRef で加速するはずの
    // 結界が一定速度に見えていた。粒の位相が速度に比例して進むことを固定する。
    // 壁の配置は乱数なので、幕が組めた状態を得るまで数回試す（組めないのは resolveTurn の例外時だけ）
    let s = createEndroll(0)
    for (let i = 0; i < 10 && !s.round; i++) s = createEndroll(0)
    const round = s.round
    if (!round) throw new Error('幕が組み立てられていない')
    const ring = unevenRing()
    round.rings.push({ ring, side: 'B', breakT: null, fresh: false })
    round.obstacles = [] // 壁の描画はオフスクリーン Canvas を使うので、この検証では外す
    const ctx = stubCtx()
    for (let f = 0; f < 8; f++) drawEndroll(ctx, s, 800, 600, 16 * f)
    const ps = s.ringPhases[ringPhaseKey(ring, 'enemy')]
    expect(ps).toBeDefined()
    // 高速側（index 36〜71 から出発した粒）は低速側よりずっと大きく進む
    const advanced = (ps as number[]).map((p, k) => (p - (k * ring.length) / (ps as number[]).length + ring.length) % ring.length)
    const slow = advanced.filter((_, k) => k < (ps as number[]).length / 2)
    const fast = advanced.filter((_, k) => k >= (ps as number[]).length / 2)
    expect(Math.max(...fast)).toBeGreaterThan(Math.max(...slow) * 5)
  })
})
