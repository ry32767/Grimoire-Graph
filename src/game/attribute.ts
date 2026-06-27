// 場の評価・属性判定・強度・極性相性・威力・ダメージ（機能4・9）。純粋関数。
import type { Attribute, Field, Vec2 } from './types'
import { FIELD, AFFINITY } from '../data/constants'

/** 場 z=f(x,y) を評価する */
export function evalField(field: Field, pos: Vec2): number {
  const z = field(pos.x, pos.y)
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
  if (a < 0) return 0
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

/**
 * 弾が主に通過した属性（経路で |z| が最大の点の属性と強度）。
 * パリィでは「弾がどの理を帯びているか」をこれで判定する（§3.8 の運用解釈）。
 */
export function dominantAttribute(
  field: Field,
  samples: { pos: Vec2 }[],
): { attr: Attribute; strength: number } {
  let best: { attr: Attribute; strength: number } = { attr: 'neutral', strength: 0 }
  for (const s of samples) {
    const z = evalField(field, s.pos)
    const st = strengthOf(z)
    if (st > best.strength) best = { attr: attributeOf(z), strength: st }
  }
  return best
}

/** ダメージ計算の内訳（戦闘ログ表示用・機能9） */
export interface DamageBreakdown {
  /** 攻撃属性（命中点の z 符号で決まる） */
  attackAttr: Attribute
  /** 命中点の速度 */
  speed: number
  /** 属性強度 |z| */
  strength: number
  /** 威力 = 速度 × 強度 */
  power: number
  /** 対象属性 */
  targetAttr: Attribute
  /** 極性相性倍率 */
  affinity: number
  /** 最終ダメージ = 威力 × 相性 */
  damage: number
}

/**
 * 命中点の速度・場の値 z・対象属性から最終ダメージと内訳を求める。
 * 攻撃属性は命中点の z 符号で決まる（プレイヤーは属性を直接選べない・§3.2）。
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
