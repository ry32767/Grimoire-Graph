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
  // 敵の反対極を突く：光の敵 → 闇(z<0)、闇/中立 → 光(z>0)
  const sign = target.element === 'light' ? -1 : 1
  // 属性の強さ候補（#31）：最強 zPeak は近距離で大威力だが |z|>zRef なので減速して失速する。
  // 減速しない zRef は中遠距離でも届く。実際に届く威力（命中速度×強度）が最大の組み合わせを選ぶ。
  const zMags = [FIELD.zPeak, FIELD.zRef]
  const aList = [sign * 1, sign * 2, sign * 3, -sign * 1]
  const bList = [0, 0.05, 0.1, -0.05, -0.1]

  let best: { score: number; a: number; b: number; angle: number; zConst: number } | null = null
  for (const m of zMags) {
    const zConst = sign * m
    const zField: ZField = () => zConst
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
        // 命中速度 × 強度（=届いた威力）。zPeak が届く近距離では強度が高く有利、遠距離では zRef が選ばれる
        const score = hit.speed * strengthOf(zConst)
        if (score > 0 && (!best || score > best.score)) best = { score, a, b, angle, zConst }
      }
    }
  }

  if (!best) {
    // どれも当たらなければ素直に直線で狙う（減速しない zRef で）
    const a = sign
    const zConst = sign * FIELD.zRef
    return { angle: aimAngle(from, target.pos, a), line: { a, b: 0 }, zConst }
  }
  if (best.b === 0) return { angle: best.angle, line: { a: best.a, b: 0 }, zConst: best.zConst }
  const bStr = Number(best.b.toFixed(2))
  return { angle: best.angle, freeExpr: `${best.a}*x + ${bStr}*x^2`, zConst: best.zConst }
}
