// おすすめ術式の探索：障害物越しでも敵に当たる関数を選ぶ。純粋関数。
// 直線・放物（弧）の候補を生成し、障害物の貫通を込みでシミュレートして最良の命中を選ぶ。
import type { Enemy, Obstacle, Trajectory, Vec2 } from './types'
import { simulateFlight } from './physics'
import { firstHit } from './collision'
import { traverseObstacles } from './turn'
import { trajectoryZ, attributeOf, strengthOf, affinityMultiplier } from './attribute'
import { FIELD, GAME } from '../data/constants'

export interface RecommendResult {
  angle: number
  /** 直線プリセット（b は y切片） */
  line?: { a: number; b: number }
  /** 自由入力式（弧など、プリセットにない形） */
  freeExpr?: string
}

function aimAngle(from: Vec2, to: Vec2, slope0: number): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - Math.atan(slope0)
}

/**
 * from から target へ、障害物を貫通/迂回して最大ダメージを与える術式を探す。
 * a（初期傾き）と b（二次の曲率）の格子を、障害物込みでシミュレートして評価する。
 */
export function recommendCast(from: Vec2, target: Enemy, obstacles: Obstacle[]): RecommendResult {
  const sign = target.element === 'light' ? -1 : 1 // 敵の反対極を狙う
  const aList = [sign * 1, sign * 2, sign * 3, -sign * 1]
  const bList = [0, 0.05, 0.1, -0.05, -0.1]

  let best: { score: number; a: number; b: number; angle: number } | null = null
  for (const a of aList) {
    const angle = aimAngle(from, target.pos, a)
    for (const b of bList) {
      const traj: Trajectory = { mode: 'rotate', g: (x) => a * x + b * x * x, angle, origin: from }
      const free = simulateFlight(traj, FIELD.fixedSpeed)
      // 障害物の貫通を込みで命中を評価（削りで carves が増えるので複製を使う）
      const obsCopy = obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
      const { flight } = traverseObstacles(traj, FIELD.fixedSpeed, free, obsCopy)
      const hit = firstHit(flight.samples, target.pos, target.hitboxRadius || GAME.enemyHitbox)
      if (!hit || hit.speed <= 0) continue
      const z = trajectoryZ(traj, hit.param)
      const score = hit.speed * strengthOf(z) * affinityMultiplier(attributeOf(z), target.element)
      if (score > 0 && (!best || score > best.score)) best = { score, a, b, angle }
    }
  }

  if (!best) {
    // どれも当たらなければ素直に直線で狙う
    const a = sign
    return { angle: aimAngle(from, target.pos, a), line: { a, b: 0 } }
  }
  if (best.b === 0) return { angle: best.angle, line: { a: best.a, b: 0 } }
  const bStr = Number(best.b.toFixed(2))
  return { angle: best.angle, freeExpr: `${best.a}*x + ${bStr}*x^2` }
}
