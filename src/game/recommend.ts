// おすすめ術式の探索：障害物越しでも敵に当たる軌道＋反対極の z 場を選ぶ。純粋関数。
// 新モデル（#30/#21）：軌道（経路）と z 場（属性）は別物。経路は命中を、z 場は属性・強度を決める。
// おすすめは「敵の反対極を最強(|z|=zPeak)で当てる」ため z=一定(±zPeak) を採用する。
import type { Enemy, Obstacle, Trajectory, Vec2, ZField } from './types'
import { simulateFlight } from './physics'
import { firstHit } from './collision'
import { traverseObstacles } from './turn'
import { strengthOf } from './attribute'
import { FIELD, GAME } from '../data/constants'

export interface RecommendResult {
  angle: number
  /** 直線プリセット（b は y切片） */
  line?: { a: number; b: number }
  /** 自由入力式（弧など、プリセットにない形） */
  freeExpr?: string
  /** おすすめの z 場（一定値）。敵の反対極を最強で当てる（#21） */
  zConst: number
}

function aimAngle(from: Vec2, to: Vec2, slope0: number): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - Math.atan(slope0)
}

/**
 * from から target へ、障害物を貫通/迂回して命中する軌道を探す。
 * z 場は「敵の反対極を最強(|z|=zPeak)」の一定値に固定し、命中速度が最大の経路を選ぶ。
 */
export function recommendCast(from: Vec2, target: Enemy, obstacles: Obstacle[]): RecommendResult {
  // 敵の反対極を最強で当てる：光の敵 → z=−zPeak（闇）、闇/中立 → z=+zPeak（光）
  const zConst = target.element === 'light' ? -FIELD.zPeak : FIELD.zPeak
  const zField: ZField = () => zConst
  const sign = zConst > 0 ? 1 : -1
  const aList = [sign * 1, sign * 2, sign * 3, -sign * 1]
  const bList = [0, 0.05, 0.1, -0.05, -0.1]

  let best: { score: number; a: number; b: number; angle: number } | null = null
  for (const a of aList) {
    const angle = aimAngle(from, target.pos, a)
    for (const b of bList) {
      const traj: Trajectory = {
        mode: 'rotate',
        g: (x) => a * x + b * x * x,
        angle,
        origin: from,
        z: zField,
      }
      const free = simulateFlight(traj, FIELD.fixedSpeed)
      // 障害物の貫通を込みで命中を評価（削りで carves が増えるので複製を使う）
      const obsCopy = obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
      const { flight } = traverseObstacles(traj, FIELD.fixedSpeed, free, obsCopy)
      const hit = firstHit(flight.samples, target.pos, target.hitboxRadius || GAME.enemyHitbox)
      if (!hit || hit.speed <= 0) continue
      // z は一定なので強度・相性は固定。命中速度が大きいほど威力が高い
      const score = hit.speed * strengthOf(zConst)
      if (score > 0 && (!best || score > best.score)) best = { score, a, b, angle }
    }
  }

  if (!best) {
    // どれも当たらなければ素直に直線で狙う
    const a = sign
    return { angle: aimAngle(from, target.pos, a), line: { a, b: 0 }, zConst }
  }
  if (best.b === 0) return { angle: best.angle, line: { a: best.a, b: 0 }, zConst }
  const bStr = Number(best.b.toFixed(2))
  return { angle: best.angle, freeExpr: `${best.a}*x + ${bStr}*x^2`, zConst }
}
