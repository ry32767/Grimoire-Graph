// 障害物（属性付き・破壊／貫通・§3.7・機能11）。純粋関数。
// 反対極ほど「壊しやすく・貫通しやすい」設計：耐久は威力×相性で削れ、速度損は (2−相性) でスケール。
import type { Attribute, Obstacle } from './types'
import { COMBAT } from '../data/constants'
import { affinityMultiplier } from './attribute'

/** 障害物衝突による弾の速度損（反対極ほど小さい＝貫通しやすい・§3.7） */
export function obstacleSpeedLoss(attackAttr: Attribute, element: Attribute): number {
  const aff = affinityMultiplier(attackAttr, element)
  // 相性 1.5(反対)→0.5×base、1.0(中立)→1×base、0.5(同極)→1.5×base
  return COMBAT.obstacleSpeedLoss * (2 - aff)
}

/** 障害物耐久の削り量 = 威力 × 極性相性（反対極ほど大きい・§3.7） */
export function obstacleDurabilityDamage(
  power: number,
  attackAttr: Attribute,
  element: Attribute,
): number {
  return power * affinityMultiplier(attackAttr, element)
}

/** 障害物衝突の結果 */
export interface ObstacleHitResult {
  obstacle: Obstacle
  /** 弾が失う速度 */
  speedLoss: number
  /** この衝突で破壊されたか */
  destroyed: boolean
}

/**
 * 弾が障害物に当たったときの解決：耐久を削り、速度損を返す。
 * 残速度の判定（貫通 or 停止）は呼び出し側が速度減衰の結果で行う。
 * すでに破壊済み（耐久0以下）の障害物は素通り（速度損0）。
 */
export function applyObstacleHit(
  obstacle: Obstacle,
  power: number,
  attackAttr: Attribute,
): ObstacleHitResult {
  if (obstacle.durability <= 0) {
    return { obstacle, speedLoss: 0, destroyed: true }
  }
  const dmg = obstacleDurabilityDamage(power, attackAttr, obstacle.element)
  const remaining = Math.max(0, obstacle.durability - dmg)
  return {
    obstacle: { ...obstacle, durability: remaining },
    speedLoss: obstacleSpeedLoss(attackAttr, obstacle.element),
    destroyed: remaining <= 0,
  }
}
