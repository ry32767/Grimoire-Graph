// フィットした式が壁へ食い込むときの再フィット（制約投影・#76）の回帰テスト。
// 経路探索が返す clean 経路は余白つきで安全なのに、有限自由度の式でなぞると通過点の**間**で
// 膨らんで壁に触れる。触れた点を通過点に足して組み直すと、同じ経路を素材に触れず通せる。
import { describe, it, expect } from 'vitest'
import { fitRouteToFamilies, type FitResult } from './routeFit'
import { fitCleanRoute } from './routeRepair'
import { fitComplexityFor } from './fitComplexity'
import { buildPlanningEnv } from './planningEnv'
import { findRoute } from './routeSearch'
import { isSolidAt } from '../obstacle'
import { FIELD } from '../../data/constants'
import type { Obstacle, Vec2 } from '../types'

const ORIGIN: Vec2 = { x: 0, y: 18 }
const GOAL: Vec2 = { x: 0, y: -18 }
const FAMS = ['arc', 'abs', 'poly34'] as const

/** 柱を左右→中央→左右と並べたスラローム（隙間 gap で幅が決まる）。 */
const slalom = (gap: number): Obstacle[] => [
  { id: 'p1', element: 'neutral', carves: [], solids: [{ x: -gap, y: 9, r: 3 }, { x: gap, y: 9, r: 3 }] },
  { id: 'p2', element: 'neutral', carves: [], solids: [{ x: 0, y: 0, r: 3.4 }] },
  { id: 'p3', element: 'neutral', carves: [], solids: [{ x: -gap, y: -9, r: 3 }, { x: gap, y: -9, r: 3 }] },
]

/** 式 g をワールドへ写して素材に触れないか（本番の isSolidAt で判定）。 */
function clearsMaterial(fit: FitResult, obstacles: Obstacle[]): boolean {
  for (let i = 1; i < 80; i++) {
    const x = (fit.goalX * i) / 80
    const y = fit.g(x)
    const p = {
      x: ORIGIN.x + x * Math.cos(fit.angle) - y * Math.sin(fit.angle),
      y: ORIGIN.y + x * Math.sin(fit.angle) + y * Math.cos(fit.angle),
    }
    if (obstacles.some((ob) => isSolidAt(ob, p))) return false
  }
  return true
}

/** その隙間幅で「素の1回フィット」と「再フィット込み」がそれぞれ何本安全に通せたか。 */
function cleanCounts(gap: number): { plain: number; repaired: number } {
  const obstacles = slalom(gap)
  const env = buildPlanningEnv(obstacles, FIELD.rField)
  const route = findRoute(env, ORIGIN, GOAL, 'clean')
  expect(route, `gap=${gap} の clean 経路`).not.toBeNull()
  const cx = fitComplexityFor(6)
  const plain = fitRouteToFamilies(route!.points, ORIGIN, FAMS, cx)
  const repaired = fitCleanRoute(route!.points, ORIGIN, FAMS, cx, env)
  return {
    plain: plain.filter((f) => clearsMaterial(f, obstacles)).length,
    repaired: repaired.filter((f) => clearsMaterial(f, obstacles)).length,
  }
}

describe('経路フィットの再フィット：壁に触れない式へ組み直す（#76）', () => {
  it('素の1回フィットが全滅する狭いスラロームでも、組み直せば壁に触れずに通せる', () => {
    const { plain, repaired } = cleanCounts(5)
    expect(plain).toBe(0) // 経路は安全なのに、通過点の間で膨らんで全候補が柱に触れる
    expect(repaired).toBeGreaterThan(0) // 触れた点を通過点に足して組み直すと通せる
  })

  it('どの隙間幅でも安全な候補が減らない（組み直しは足すだけで捨てない）', () => {
    for (const gap of [5, 5.5, 6, 6.5, 7]) {
      const { plain, repaired } = cleanCounts(gap)
      expect(repaired, `gap=${gap}`).toBeGreaterThanOrEqual(plain)
    }
  })

  it('経路探索の空間を渡さなければ従来どおり（1回フィットと同じ本数）', () => {
    const obstacles = slalom(5)
    const env = buildPlanningEnv(obstacles, FIELD.rField)
    const route = findRoute(env, ORIGIN, GOAL, 'clean')!
    const cx = fitComplexityFor(6)
    expect(fitCleanRoute(route.points, ORIGIN, FAMS, cx, null)).toHaveLength(
      fitRouteToFamilies(route.points, ORIGIN, FAMS, cx).length,
    )
  })
})
