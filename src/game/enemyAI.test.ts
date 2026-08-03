import { describe, it, expect } from 'vitest'
import { planEnemyShot, enemyFlight, ARCHETYPES, AVOIDER_FAMILIES } from './enemyAI'
import { firstHit } from './collision'
import { isSolidAt } from './obstacle'
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
  it('全familyが存在し、ラベルを持つ（abs=折れを含む・#46）', () => {
    for (const f of ['line', 'arc', 'wave', 'spiral', 'exp', 'poly34', 'abs'] as EnemyFamily[]) {
      expect(ARCHETYPES[f].label.length).toBeGreaterThan(0)
    }
  })

  it('abs（折れ）型も狙った味方に命中する軌道を組める（05b §2・#46）', () => {
    const e = enemy({ x: 0, y: 8 }, 'abs')
    const target = ally('t', { x: 0, y: -8 })
    const plan = planEnemyShot(e, [target])
    expect(plan).not.toBeNull()
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    expect(firstHit(flight.samples, target.pos, GAME.allyHitbox)).not.toBeNull()
  })

  it('迂回型（attacker）が使う family は abs/arc/poly34 のみ＝AVOIDER_FAMILIES（#46）', () => {
    // AVOIDER_FAMILIES 集合そのものの不変条件：wave/exp/line/spiral は含まれない
    expect([...AVOIDER_FAMILIES].sort()).toEqual(['abs', 'arc', 'poly34'])
    for (const forbidden of ['wave', 'exp', 'line', 'spiral'] as EnemyFamily[]) {
      expect(AVOIDER_FAMILIES.includes(forbidden)).toBe(false)
    }
  })

  it('迂回型が abs/arc/poly34 を1つでも持てば、wave/exp を混ぜても選ばない（#46）', () => {
    // 壁ごしの相手に回り込む迂回型。families に wave/exp を混ぜても、選ばれる軌道は
    // 命中まで壁に触れず回り込む＝周期蛇行の wave では安定して閉じられない曲線が選ばれる。
    const wall: Obstacle = {
      id: 'w', element: 'dark',
      solids: [{ x: -2, y: 0, r: 2.4 }, { x: 0, y: 0, r: 2.4 }, { x: 2, y: 0, r: 2.4 }],
      carves: [],
    }
    const e: Enemy = { ...enemy({ x: 0, y: 10 }, 'arc'), families: ['wave', 'exp', 'poly34'] }
    const target = ally('t', { x: 0, y: -10 }, 'light')
    const plan = planEnemyShot(e, [target], [wall])
    expect(plan).not.toBeNull()
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    const hit = firstHit(flight.samples, target.pos, GAME.allyHitbox)
    expect(hit).not.toBeNull()
    // 命中までに壁の素材へ触れない＝安定して隙間を抜けている（wave/exp では困難な回避）
    const touches = flight.samples.some((sm) => sm.arcLen < hit!.arcLen && isSolidAt(wall, sm.pos))
    expect(touches).toBe(false)
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
    // 敵(0,8)→味方(0,-8) の直線上に壁（反対極＝闇弾で安く削れる）。breaker は貫通して
    // 直進の高威力弾を通し、迂回する attacker より高評価になる。
    // ※ #64 の削り物理修正後は削り減速が本当に効く（1発で貫けない厚さは実際に止まる）ため、
    //   1手で貫通が成立する厚さ（r=1.6）の反対極の壁で本来の役割分担を検証する。
    const wall: Obstacle = { id: 'w', element: 'light', solids: [{ x: 0, y: 0, r: 1.6 }], carves: [] }
    const target = ally('t', { x: 0, y: -8 }, 'light')
    const attacker: Enemy = enemy({ x: 0, y: 8 }, 'line')
    const breaker: Enemy = { ...attacker, role: 'breaker' }
    const aPlan = planEnemyShot(attacker, [target], [wall])
    const bPlan = planEnemyShot(breaker, [target], [wall])
    expect(aPlan).not.toBeNull()
    expect(bPlan).not.toBeNull()
    expect(bPlan!.expectedDamage).toBeGreaterThan(0) // 貫通して実際に届く
    expect(bPlan!.expectedDamage).toBeGreaterThan(aPlan!.expectedDamage)
  })

  it('壁を避ける：壁ごしの相手に回り込む曲線軌道を選ぶ（#28）', () => {
    // 敵(0,10)→味方(0,-10) の直線を塞ぐ横長の壁。attacker は貫けないので通過点を選んで回り込む。
    const wall: Obstacle = {
      id: 'w',
      element: 'dark',
      solids: [
        { x: -2, y: 0, r: 2.4 },
        { x: 0, y: 0, r: 2.4 },
        { x: 2, y: 0, r: 2.4 },
      ],
      carves: [],
    }
    const e = enemy({ x: 0, y: 10 }, 'line')
    const target = ally('t', { x: 0, y: -10 }, 'light')
    const plan = planEnemyShot(e, [target], [wall])
    expect(plan).not.toBeNull()
    const { flight } = enemyFlight(plan!.trajectory, e.castInitialSpeed)
    const hit = firstHit(flight.samples, target.pos, GAME.allyHitbox)
    expect(hit).not.toBeNull()
    // 選ばれた軌道は命中までに壁の素材へ触れない＝回り込んでいる（直進では貫けない壁）
    const touchesWall = flight.samples.some(
      (sm) => sm.arcLen < hit!.arcLen && isSolidAt(wall, sm.pos),
    )
    expect(touchesWall).toBe(false)
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

// ===== #69：掘削（壁削り）の効率と多重サイン軌道 =====
describe('掘削の軌道が最適化される（#69）', () => {
  /** 厚い tough の横壁（x0..x1・厚み thickness）を1枚だけ置いた盤面。 */
  const thickWall = (x0: number, x1: number, y: number, thickness: number): Obstacle => ({
    id: 'w',
    element: 'neutral',
    solids: [],
    rects: [{ x: x0, y: y - thickness / 2, w: x1 - x0, h: thickness }],
    carves: [],
    kind: 'tough',
  })

  it('火力型は壁を「斜めに舐める」のでなく最短の厚みを抜く軌道で掘る', async () => {
    const { evaluateEnemyShot } = await import('./enemyPlanning/evaluate')
    const THICK = 5
    const wall = thickWall(-30, 30, 0, THICK)
    // 敵は壁の真上、味方は真下。壁が厚くクリーン命中は無いので掘削フォールバックに入る
    const e: Enemy = { ...enemy({ x: 0, y: 18 }, 'line', 'light'), role: 'breaker', level: 6, castInitialSpeed: 8 }
    const a = ally('a', { x: 0, y: -18 }, 'dark')
    const plan = planEnemyShot(e, [a], [wall], [], [e], 40)
    expect(plan).not.toBeNull()
    const ev = evaluateEnemyShot(plan!.trajectory, e.castInitialSpeed, [wall], [], { aimPos: a.pos })
    // 素材の中を通る長さが「壁の厚みの2倍」を超えるような、壁沿いに長く舐める軌道は選ばれない
    expect(ev.materialLenBefore).toBeLessThan(THICK * 2)
    // かつ、実際に素材を削っている（牽制で終わっていない）
    expect(ev.materialLenBefore - ev.materialLenAfter).toBeGreaterThan(0)
  })

  it('掘り進めるほど残り素材が減り、同じトンネルを掘り続ける', async () => {
    const { evaluateEnemyShot } = await import('./enemyPlanning/evaluate')
    const wall = thickWall(-30, 30, 0, 5)
    const e: Enemy = { ...enemy({ x: 0, y: 18 }, 'line', 'light'), role: 'breaker', level: 6, castInitialSpeed: 8 }
    const a = ally('a', { x: 0, y: -18 }, 'dark')
    const obstacles = [wall]
    let prevRemain = Infinity
    for (let turn = 0; turn < 3; turn++) {
      const plan = planEnemyShot(e, [a], obstacles, [], [e], 40)!
      const ev = evaluateEnemyShot(plan.trajectory, e.castInitialSpeed, obstacles, [], { aimPos: a.pos })
      // 本番と同じ削りを盤面へ反映する（次ターンの計画は掘った穴を見る）
      const cloned = obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
      evaluateEnemyShot(plan.trajectory, e.castInitialSpeed, cloned, [], { aimPos: a.pos })
      obstacles[0] = cloned[0]
      expect(ev.materialLenAfter).toBeLessThanOrEqual(prevRemain + 1e-6)
      prevRemain = ev.materialLenAfter
    }
  })
})

describe('多重サイン（harmonic・#69）', () => {
  it('フーリエ正弦級数フィットは g(0)=g(L)=0 を厳密に満たし、通過点へ寄る', async () => {
    const { fitRouteToFamilies } = await import('./enemyPlanning/routeFit')
    const origin = { x: 0, y: 0 }
    // ジグザグに折れる経路（柱の隙間を縫う想定）
    const route = [origin, { x: 10, y: 6 }, { x: 20, y: -6 }, { x: 30, y: 5 }, { x: 40, y: 0 }]
    const fits = fitRouteToFamilies(route, origin, ['harmonic'])
    expect(fits).toHaveLength(1)
    const f = fits[0]
    expect(f.family).toBe('harmonic')
    // 基底 sin(kπx/L) は両端で必ず 0＝狙点を外さない
    expect(Math.abs(f.g(0))).toBeLessThan(1e-9)
    expect(Math.abs(f.g(f.goalX))).toBeLessThan(1e-9)
    // 式（自由入力へ転記する形）も同じ形を表す
    expect(f.expr).toContain('sin(')
  })

  it('harmonic の直接候補は複数のサイン波の重ね合わせで、単純な弧より多く向きを変える', async () => {
    const { familyTrajectories } = await import('./enemyPlanning/trajectories')
    const z = () => 0
    const trajs = familyTrajectories('harmonic', { x: 0, y: 0 }, 0, z, 20, 40)
    expect(trajs.length).toBeGreaterThan(0)
    // 代表候補の g(x) が 0..40 の間で3回以上向きを変える（人手では追いにくいうねり）
    const g = trajs[0].mode === 'rotate' ? trajs[0].g : null
    expect(g).not.toBeNull()
    let turns = 0
    let prev = g!(0.5) - g!(0)
    for (let x = 1; x <= 40; x += 0.5) {
      const d = g!(x) - g!(x - 0.5)
      if ((prev > 0 && d < 0) || (prev < 0 && d > 0)) turns++
      if (Math.abs(d) > 1e-12) prev = d
    }
    expect(turns).toBeGreaterThanOrEqual(3)
  })
})

// ===== #70：命中を最優先し、届かないなら壁を貫いてでも最短で相手へ向かう =====
describe('命中最優先と壁越しの最短経路（#70）', () => {
  /** 全幅を塞ぐ厚み thickness の normal 壁（迂回路なし）。 */
  const fullWall = (y: number, thickness: number): Obstacle => ({
    id: 'w',
    element: 'neutral',
    solids: [],
    rects: [{ x: -30, y: y - thickness / 2, w: 60, h: thickness }],
    carves: [],
  })

  /**
   * 迂回型（abs 主体）。牽制は「折れ点 h=20 固定・最小傾き」の決め打ちなので、
   * 距離25 の対象へは自由飛行でも 6.75 も外す＝「相手へ向かう一手」と明確に区別できる。
   */
  const avoider = (over: Partial<Enemy> = {}): Enemy => ({
    ...enemy({ x: 0, y: 12 }, 'abs', 'dark'),
    families: ['abs'],
    level: 5,
    castInitialSpeed: 8,
    ...over,
  })

  it('壁を貫けば当たる局面では、迂回できなくても命中する候補を選ぶ', async () => {
    const { evaluateEnemyShot } = await import('./enemyPlanning/evaluate')
    const wall = fullWall(0, 1) // 薄い壁で全幅を塞ぐ＝迂回路は無いが貫通はできる
    const e = avoider({ castInitialSpeed: 14 })
    const a = ally('a', { x: 0, y: -13 }, 'light')
    const plan = planEnemyShot(e, [a], [wall], [], [e], 40)!
    expect(plan).not.toBeNull()
    expect(plan.expectedDamage).toBeGreaterThan(0) // 牽制でなく命中候補
    const ev = evaluateEnemyShot(plan.trajectory, e.castInitialSpeed, [wall], [], { aimPos: a.pos })
    const hit = firstHit(ev.flight.samples, a.pos, GAME.allyHitbox)
    expect(hit).not.toBeNull() // 本番の削り込みでも実際に届く
    expect(hit!.speed).toBeGreaterThan(0)
  })

  it('厚い壁で完全に塞がれた迂回型は牽制せず、相手へ最短で届く経路を掘り進めて命中する', async () => {
    const { resolveTurn } = await import('./turn')
    const { evaluateEnemyShot } = await import('./enemyPlanning/evaluate')
    const e = avoider({ id: 'e0' })
    let obstacles: Obstacle[] = [fullWall(0, 5)] // 厚み5＝1発では抜けない・迂回路なし
    let allies: Ally[] = [ally('a', { x: 0, y: -13 }, 'light', 5000, 5000)]
    const straight = Math.hypot(allies[0].pos.x - e.pos.x, allies[0].pos.y - e.pos.y)
    let prevRemain = Infinity
    let hitTurn = -1
    for (let turn = 1; turn <= 10; turn++) {
      const plan = planEnemyShot(e, allies, obstacles, [], [e], 40)!
      expect(plan).not.toBeNull()
      // 障害物が無ければ必ず対象へ届く軌道＝「相手へ向かう一手」（牽制の折れは自由飛行でも外す）
      const free = enemyFlight(plan.trajectory, e.castInitialSpeed).flight
      const freeHit = firstHit(free.samples, allies[0].pos, GAME.allyHitbox)
      expect(freeHit, `turn ${turn}`).not.toBeNull()
      // 最短で届く：対象までの弧長が直線距離の1.3倍以内＝遠回りの掘削を選ばない
      expect(freeHit!.arcLen).toBeLessThan(straight * 1.3)
      const ev = evaluateEnemyShot(plan.trajectory, e.castInitialSpeed, obstacles, [], { aimPos: allies[0].pos })
      // まだ届かない間は、必ず壁を削り進める（牽制で足踏みしない）＝残り素材は単調に減る
      if (!firstHit(ev.flight.samples, allies[0].pos, GAME.allyHitbox)) {
        expect(ev.materialLenBefore - ev.materialLenAfter, `turn ${turn}`).toBeGreaterThan(0)
        expect(ev.materialLenAfter).toBeLessThanOrEqual(prevRemain + 1e-6)
        prevRemain = ev.materialLenAfter
      }
      // 本番のターン解決で盤面へ削りを反映する（次ターンの計画は掘った穴を見る）
      const res = resolveTurn({
        allies, casts: [], enemies: [e], castingEnemyIds: [e.id],
        obstacles, mechanics: { obstacles: true, enemyFire: true },
      })
      obstacles = res.obstacles
      allies = res.allies
      if (res.enemyShots.some((sh) => sh.hits.length > 0)) {
        hitTurn = turn
        break
      }
    }
    expect(hitTurn).toBeGreaterThan(0) // 掘り抜いていずれ命中する
  })
})
