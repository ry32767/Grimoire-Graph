// 属性判定・強度・極性相性・威力・ダメージ（機能4・9）。純粋関数。
//
// 新モデル：属性はステージ固定の場ではなく「プレイヤーの関数値そのもの（z=高さ）」で決まる。
// 軌道は関数のグラフであり、その値 z=g(x)（回転）/ f(θ)（極座標）の符号が属性、|z| が強度。
import type { Attribute, Trajectory } from './types'
import { FIELD, AFFINITY } from '../data/constants'

/** 軌道のパラメータ位置での z 値（=関数値=属性の高さ）。 */
export function trajectoryZ(traj: Trajectory, param: number): number {
  const z = traj.mode === 'rotate' ? traj.g(param) : traj.f(param)
  return Number.isFinite(z) ? z : 0
}

/** z の符号で属性を返す（|z|<ε は中立・§3.2） */
export function attributeOf(z: number): Attribute {
  if (Math.abs(z) < FIELD.epsilon) return 'neutral'
  return z > 0 ? 'light' : 'dark'
}

/** 属性強度 = clamp(|z|, 0, Smax)（§3.4） */
export function strengthOf(z: number): number {
  const a = Math.abs(z)
  return a > FIELD.sMax ? FIELD.sMax : a
}

/** 極性相性倍率：反対極×1.5／同極×0.5／中立×1.0（§3.2） */
export function affinityMultiplier(attacker: Attribute, target: Attribute): number {
  if (attacker === 'neutral' || target === 'neutral') return AFFINITY.neutral
  if (attacker === target) return AFFINITY.same
  return AFFINITY.opposite // light vs dark
}

/** 威力 = 命中点の速度 × 属性強度(|z|)（§3.4） */
export function power(speed: number, z: number): number {
  return speed * strengthOf(z)
}

/** 弾が帯びる属性（経路で |z| が最大の点）。パリィ判定などに使う。 */
export function dominantAttribute(
  traj: Trajectory,
  samples: { param: number }[],
): { attr: Attribute; strength: number } {
  let best: { attr: Attribute; strength: number } = { attr: 'neutral', strength: 0 }
  for (const s of samples) {
    const z = trajectoryZ(traj, s.param)
    const st = strengthOf(z)
    if (st > best.strength) best = { attr: attributeOf(z), strength: st }
  }
  return best
}

/** ダメージ計算の内訳（戦闘ログ表示用・機能9） */
export interface DamageBreakdown {
  attackAttr: Attribute
  speed: number
  strength: number
  power: number
  targetAttr: Attribute
  affinity: number
  damage: number
}

/**
 * 命中点の速度・z 値・対象属性から最終ダメージと内訳を求める。
 * 攻撃属性は命中点の z（関数値）の符号で決まる（§3.2）。
 */
export function computeDamage(speed: number, z: number, targetAttr: Attribute): DamageBreakdown {
  const attackAttr = attributeOf(z)
  const strength = strengthOf(z)
  const pw = speed * strength
  const affinity = affinityMultiplier(attackAttr, targetAttr)
  return {
    attackAttr,
    speed,
    strength,
    power: pw,
    targetAttr,
    affinity,
    damage: pw * affinity,
  }
}
