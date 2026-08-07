// フィットした式が素材へ食い込むときの**再フィット（制約投影）**（#76）。純粋関数。
// 経路探索が返す clean 経路は余白つきで素材に触れないのに、有限自由度の式でなぞると
// 通過点の**間**で膨らんで壁に触れることがある（＝弾は一度触れただけで失速して消える）。
// 触れた局所 x に「経路上の正しい y」を通過点として足し、その重みで組み直す、を数回繰り返す
// （守護型の外形フィット constrainedFit と同じ手口）。壁を掘る前提の wallTunnel 経路には使わない。
import type { EnemyFamily, Vec2 } from '../types'
import { ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'
import type { FitComplexity } from './fitComplexity'
import { fitLocalRoute, toLocalRoute, type FitPoint, type FitResult, type LocalRoute } from './routeFit'
import { toWorld } from './fitMath'
import type { PlanningEnv } from './planningEnv'

/** 1パスで足せる補正点の上限（通過点を増やしすぎると高次フィットが窮屈になる）。 */
const MAX_FIX_PER_PASS = 8
/** 既存の通過点と「同じ x」とみなす幅（ここに入る違反は新点でなく重み増しで直す）。 */
const SAME_X = 0.4

/** 局所 x での経路の y（始点(0,0)・終点(L,0) を含めて線形補間）。 */
function routeYAt(route: LocalRoute, x: number): number {
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }, ...route.inner, { x: route.L, y: 0 }]
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i].x) {
      const a = pts[i - 1]
      const b = pts[i]
      const t = b.x - a.x > 1e-9 ? (x - a.x) / (b.x - a.x) : 0
      return a.y + (b.y - a.y) * t
    }
  }
  return 0
}

/** 式 g が素材（余白込み）へ食い込む・場外へ出る局所 x の一覧。空なら安全に通せる。 */
function violationXs(fit: FitResult, origin: Vec2, env: PlanningEnv): number[] {
  const n = Math.max(8, RP.fitRepairSamples)
  const out: number[] = []
  for (let i = 1; i < n; i++) {
    const x = (fit.goalX * i) / n
    const y = fit.g(x)
    if (!Number.isFinite(y)) return [x]
    const p = toWorld(origin, fit.angle, { x, y })
    if (!env.isInField(p) || env.overlapsMaterial(p, env.clearance)) out.push(x)
  }
  return out
}

/** 違反 x の集合から、通過点を足した（or 重みを増した）新しい局所経路を作る。 */
function augment(route: LocalRoute, xs: number[]): LocalRoute {
  // 違反区間全体へ均等に効かせる（隣り合う違反 x をまとめて拾わない）
  const stride = Math.max(1, Math.ceil(xs.length / MAX_FIX_PER_PASS))
  const picked = xs.filter((_, i) => i % stride === 0).slice(0, MAX_FIX_PER_PASS)
  const inner: FitPoint[] = route.inner.map((p) => ({ ...p }))
  for (const x of picked) {
    const near = inner.find((p) => Math.abs(p.x - x) < SAME_X)
    if (near) {
      near.w += RP.fitRepairWeight
      continue
    }
    inner.push({ x, y: routeYAt(route, x), w: RP.fitRepairWeight })
  }
  inner.sort((a, b) => a.x - b.x)
  return { ...route, inner }
}

/**
 * clean 経路を family へフィットする。素材に触れない式が1本も出なければ、
 * 触れた点を通過点に足して**組み直す**（最大 RP.fitRepairPasses 回）。
 * env を渡さない場合は従来どおり（1回フィットして返すだけ）。
 */
export function fitCleanRoute(
  routePoints: Vec2[],
  origin: Vec2,
  families: readonly EnemyFamily[],
  complexity: FitComplexity,
  env: PlanningEnv | null,
): FitResult[] {
  let local = toLocalRoute(routePoints, origin)
  if (!local) return []
  const first = fitLocalRoute(local, families, complexity)
  if (!env || first.length === 0) return first
  // 1本でも素材を避けられているなら従来どおり全候補を返す（採点は本番物理に委ねる）
  if (first.some((f) => violationXs(f, origin, env).length === 0)) return first

  // 組み直した式は元の候補へ**足す**（置き換えない）。余白の判定は本番より安全側なので、
  // 「余白は満たさないが実際には当たる」元の候補を捨てないため（採点は本番物理が行う）。
  let gen = first
  for (let pass = 0; pass < RP.fitRepairPasses; pass++) {
    const xs = Array.from(new Set(gen.flatMap((f) => violationXs(f, origin, env)))).sort((a, b) => a - b)
    if (xs.length === 0) break
    local = augment(local, xs)
    const next = fitLocalRoute(local, families, complexity)
    if (next.length === 0) break
    const ok = next.filter((f) => violationXs(f, origin, env).length === 0)
    if (ok.length > 0) return [...first, ...ok]
    gen = next
  }
  // どう組み直しても触れる＝この経路は式で表せない。最後の世代も足して採点（掘削の布石）へ回す
  return gen === first ? first : [...first, ...gen]
}
