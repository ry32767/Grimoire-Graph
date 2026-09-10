import type { Ally, Enemy, Obstacle } from './types'
import { recommendCast, type RecommendResult } from './recommend'

/** 関数を含まない、Workerへ送れるおすすめ探索の入力。 */
export interface RecommendBatchInput {
  allies: Pick<Ally, 'id' | 'pos'>[]
  enemies: Pick<Enemy, 'id' | 'hp' | 'pos' | 'element' | 'hitboxRadius'>[]
  obstacles: Obstacle[]
  rField?: number
}
export type RecommendBatchResult = { allyId: string; recommendation: RecommendResult }[]
export type RecommendBatchReply =
  | { ok: true; results: RecommendBatchResult }
  | { ok: false }

/** 従来と同じ最寄りの生存敵・同じ探索を各術者へ適用する。 */
export function recommendBatch(input: RecommendBatchInput): RecommendBatchResult {
  const enemies = input.enemies.filter((enemy) => enemy.hp > 0)
  if (enemies.length === 0) return []
  return input.allies.map((ally) => {
    const target = enemies.reduce((best, enemy) =>
      Math.hypot(enemy.pos.x - ally.pos.x, enemy.pos.y - ally.pos.y) <
      Math.hypot(best.pos.x - ally.pos.x, best.pos.y - ally.pos.y) ? enemy : best,
    )
    return {
      allyId: ally.id,
      recommendation: recommendCast(ally.pos, target, input.obstacles, input.rField),
    }
  })
}
