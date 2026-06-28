// 障害物（§3.7・#1/#16・Graph War 風）。純粋関数。
// 形は solids（重なった円の和＝連続したブロブ）で表し、魔法が当たった点を中心に円（carves）を
// 引き算して物理的にえぐり取る。「素材」＝どれかの solid 円内で、かつどの carve 円にも入らない点。
//   - えぐる半径 = 威力 × 係数（最大半径でキャップ）。威力が高いほど一撃で広く削れて貫通しやすい。
//   - えぐるたびに弾は減速。速度が 0 になればその場で消滅し貫通しない。反対極ほど安く削れる。
import type { Attribute, Obstacle, ObstacleKind, Vec2 } from './types'
import { COMBAT, OBSTACLE_KIND } from '../data/constants'
import { affinityMultiplier } from './attribute'

/** 点 p が障害物の素材内か（どれかの solid 円内で、かつどの carve 円にも入っていない）。 */
export function isSolidAt(ob: Obstacle, p: Vec2): boolean {
  let inSolid = false
  for (const s of ob.solids) {
    const dx = p.x - s.x
    const dy = p.y - s.y
    if (dx * dx + dy * dy <= s.r * s.r) {
      inSolid = true
      break
    }
  }
  if (!inSolid) return false
  for (const c of ob.carves) {
    const dx = p.x - c.x
    const dy = p.y - c.y
    if (dx * dx + dy * dy <= c.r * c.r) return false
  }
  return true
}

/**
 * 1回えぐり取るのに弾が失う速度（#1/#16）。
 * 相性 1.5(反対極)→×0.5、1.0(中立)→×1、0.5(同極)→×1.5。
 * 壁の種別（#40）で倍率が変わる：tough は損が大きく、fragile は小さい。
 */
export function carveSpeedLoss(
  attackAttr: Attribute,
  element: Attribute,
  kind: ObstacleKind = 'normal',
): number {
  const aff = affinityMultiplier(attackAttr, element)
  return COMBAT.carveCost * (2 - aff) * OBSTACLE_KIND[kind].lossScale
}

/**
 * 威力からえぐり取る半径を求める（最大 carveMaxRadius でキャップ）。威力が高いほど広い。
 * 壁の種別（#40）で倍率が変わる：fragile は大きく、tough はごく小さく、unbreakable は0。
 */
export function carveRadius(power: number, kind: ObstacleKind = 'normal'): number {
  const base = Math.min(COMBAT.carveMaxRadius, Math.max(0, power) * COMBAT.carveRadiusScale)
  return base * OBSTACLE_KIND[kind].carveScale
}
