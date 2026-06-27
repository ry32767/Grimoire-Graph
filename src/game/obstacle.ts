// 障害物（属性付き・削り／貫通・§3.7・#1/#16）。純粋関数。
// #1/#16：被弾すると威力に応じて「耐久＝半径」を削り、弾は減速する。
//   - 半径は耐久比に連動して縮む（小さくなるほど抵抗＝速度損も小さい）。
//   - 削り切れば（半径0）以後は素通り＝貫通。途中で弾速が0になれば弾は消滅し貫通しない。
// 反対極ほど「壊しやすく・貫通しやすい」：耐久は威力×相性で削れ、速度損は (2−相性) でスケール。
import type { Attribute, Obstacle } from './types'
import { COMBAT } from '../data/constants'
import { affinityMultiplier } from './attribute'

/** 障害物の現在の大きさ係数（0..1）。小さいほど薄い。 */
function sizeFrac(ob: Obstacle): number {
  const maxR = ob.maxRadius ?? ob.hitboxRadius
  if (maxR <= 0) return 0
  return Math.min(1, Math.max(0, ob.hitboxRadius / maxR))
}

/** 障害物衝突による弾の速度損（反対極ほど小さい＝貫通しやすい・残厚 frac で増減・§3.7/#16） */
export function obstacleSpeedLoss(attackAttr: Attribute, element: Attribute, frac = 1): number {
  const aff = affinityMultiplier(attackAttr, element)
  // 相性 1.5(反対)→0.5×base、1.0(中立)→1×base、0.5(同極)→1.5×base。残厚 frac で薄いほど小さい。
  return COMBAT.obstacleSpeedLoss * (2 - aff) * (0.35 + 0.65 * frac)
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
  /** この衝突で破壊されたか（半径0＝以後貫通） */
  destroyed: boolean
}

/**
 * 弾が障害物に当たったときの解決：威力に応じて耐久＝半径を削り、速度損を返す（#1/#16）。
 * 残速度の判定（貫通 or 停止）は呼び出し側が速度減衰の結果で行う。
 * すでに破壊済み（耐久0以下）の障害物は素通り（速度損0）。
 */
export function applyObstacleHit(
  obstacle: Obstacle,
  power: number,
  attackAttr: Attribute,
): ObstacleHitResult {
  const maxR = obstacle.maxRadius ?? obstacle.hitboxRadius
  if (obstacle.durability <= 0 || obstacle.hitboxRadius <= 0) {
    return { obstacle: { ...obstacle, maxRadius: maxR }, speedLoss: 0, destroyed: true }
  }
  const frac = sizeFrac(obstacle)
  const speedLoss = obstacleSpeedLoss(attackAttr, obstacle.element, frac)
  const dmg = obstacleDurabilityDamage(power, attackAttr, obstacle.element)
  const durability = Math.max(0, obstacle.durability - dmg)
  // 半径は耐久比に連動（面積基準＝√比）で縮む
  const ratio = obstacle.maxDurability > 0 ? durability / obstacle.maxDurability : 0
  const hitboxRadius = maxR * Math.sqrt(ratio)
  return {
    obstacle: { ...obstacle, durability, hitboxRadius, maxRadius: maxR },
    speedLoss,
    destroyed: durability <= 0,
  }
}
