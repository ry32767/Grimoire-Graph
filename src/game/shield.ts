// 防御（閉曲線シールド＝結界・§3.6・機能10）。純粋関数。
// 円 x²+y²=R²・楕円 x²/a²+y²/b²=1 を原点周りに展開し、敵弾の速度を削る。
// 反対極の被弾は耐久を大きく削り、同極は吸収しやすい（＝弾を大きく減速させて止める）。
import type { Attribute, Shield, Vec2 } from './types'
import { COMBAT } from '../data/constants'
import { affinityMultiplier } from './attribute'
import { segmentCircleHit } from './collision'

/** 結界が敵弾から削る速度（同極ほど吸収して大きく削る・§3.6） */
export function shieldSpeedLoss(bulletAttr: Attribute, element: Attribute): number {
  const aff = affinityMultiplier(bulletAttr, element)
  // 同極(0.5)→1.5×base（よく吸収）、反対極(1.5)→0.5×base（貫かれやすい）
  return COMBAT.shieldSpeedLoss * (2 - aff)
}

/** 結界の耐久の削れ量 = 弾の威力 × 相性（反対極ほど大きく削れる・§3.6） */
export function shieldDurabilityDamage(
  bulletPower: number,
  bulletAttr: Attribute,
  element: Attribute,
): number {
  return bulletPower * affinityMultiplier(bulletAttr, element)
}

/** 点が結界の内側か */
export function shieldContains(shield: Shield, pos: Vec2): boolean {
  if (shield.shape === 'circle') {
    const R = shield.params.R ?? 1
    return pos.x * pos.x + pos.y * pos.y <= R * R
  }
  const a = shield.params.a ?? 1
  const b = shield.params.b ?? 1
  return (pos.x / a) ** 2 + (pos.y / b) ** 2 <= 1
}

/** 敵弾パスが結界境界を最初に横切る位置を返す（全方向対応）。横切らなければ null。 */
export function crossesShield(path: Vec2[], shield: Shield): { pos: Vec2; index: number } | null {
  const a = shield.shape === 'ellipse' ? (shield.params.a ?? 1) : 1
  const b = shield.shape === 'ellipse' ? (shield.params.b ?? 1) : 1
  const R = shield.shape === 'circle' ? (shield.params.R ?? 1) : 1
  for (let i = 1; i < path.length; i++) {
    // 楕円は (x/a, y/b) に正規化して単位円判定に帰着
    const p0 = shield.shape === 'ellipse' ? { x: path[i - 1].x / a, y: path[i - 1].y / b } : path[i - 1]
    const p1 = shield.shape === 'ellipse' ? { x: path[i].x / a, y: path[i].y / b } : path[i]
    const r = shield.shape === 'ellipse' ? 1 : R
    const t = segmentCircleHit(p0, p1, { x: 0, y: 0 }, r)
    if (t !== null) {
      const pos = {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
        y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
      }
      return { pos, index: i }
    }
  }
  return null
}

/** 結界による被弾の解決結果 */
export interface ShieldHitResult {
  shield: Shield
  /** 削った後の敵弾速度 */
  newBulletSpeed: number
  /** 敵弾を止めたか（速度0） */
  blocked: boolean
  /** 結界が割れたか */
  broken: boolean
}

/**
 * 敵弾が結界に触れたときの解決：敵弾の速度を削り、結界の耐久を削る。
 * 速度0で敵弾消滅（blocked）。耐久0で結界が割れる（broken・消滅条件=吸収量）。
 */
export function applyShieldHit(
  shield: Shield,
  bulletPower: number,
  bulletAttr: Attribute,
  bulletSpeed: number,
): ShieldHitResult {
  const loss = shieldSpeedLoss(bulletAttr, shield.element)
  const newBulletSpeed = Math.max(0, bulletSpeed - loss)
  const durDmg = shieldDurabilityDamage(bulletPower, bulletAttr, shield.element)
  const remaining = Math.max(0, shield.durability - durDmg)
  return {
    shield: { ...shield, durability: remaining },
    newBulletSpeed,
    blocked: newBulletSpeed <= 0,
    broken: remaining <= 0,
  }
}
