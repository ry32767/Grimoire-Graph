// 「⟳ 解く」：いまの f(x) のまま、的の座標を通る θ を数値的に探す（DC プロトタイプ v3 の _bestAngle）。
// 形（式）は変えず角度だけを選ぶ。当たり判定そのものではなく「狙いの補助」なので UI 側に置く。
import type { Trajectory, Vec2 } from '../game/types'
import { simulateFlight } from '../game/physics'

const TAU = Math.PI * 2

/**
 * makeTrajectory(angle) が返す軌道を実際に飛ばし、target にいちばん近づく θ を返す。
 * 粗探索（1.5°刻み全周）→ 近傍の細探索（0.1°刻み）。組み立て不能なら現在の角度を返す。
 */
export function solveAngle(
  makeTrajectory: (angle: number) => Trajectory | null,
  speed: number,
  target: Vec2,
  hitRadius: number,
  currentAngle: number,
): number {
  const score = (angle: number): number => {
    const traj = makeTrajectory(angle)
    if (!traj) return Number.POSITIVE_INFINITY
    let flight
    try {
      flight = simulateFlight(traj, speed)
    } catch {
      return Number.POSITIVE_INFINITY
    }
    let best = Number.POSITIVE_INFINITY
    let hitSpeed = 0
    for (const s of flight.samples) {
      if (s.speed <= 1) continue
      const d = Math.hypot(s.pos.x - target.x, s.pos.y - target.y)
      if (d < best) best = d
      if (d <= hitRadius && s.speed > hitSpeed) hitSpeed = s.speed
    }
    // 命中する角度は圧倒的に優先し、その中では速い（＝威力が高い）ものを選ぶ
    if (hitSpeed > 0) return -1000 - hitSpeed
    if (flight.end === 'invalid') {
      const p = flight.endPos
      best = Math.min(best, Math.hypot(p.x - target.x, p.y - target.y))
    }
    return best
  }

  let bestAngle = currentAngle
  let bestScore = Number.POSITIVE_INFINITY
  for (let deg = 0; deg < 360; deg += 1.5) {
    const a = (deg * Math.PI) / 180
    const s = score(a)
    if (s < bestScore) {
      bestScore = s
      bestAngle = a
    }
  }
  for (let k = -15; k <= 15; k++) {
    const a = bestAngle + (k * 0.1 * Math.PI) / 180
    const s = score(a)
    if (s < bestScore) {
      bestScore = s
      bestAngle = a
    }
  }
  return ((bestAngle % TAU) + TAU) % TAU
}
