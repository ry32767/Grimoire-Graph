// 属性判定・強度・極性相性・威力・ダメージ（機能4・9）。純粋関数。
//
// 新モデル（#30/#21）：属性は軌道（経路）とは別の z 場 z=f(x,y) で決まる。
// 弾が通る各点の (x,y) で z を評価し、符号で属性、|z| が V(=zPeak) に近いほど強い「山型」。
import type { Attribute, Trajectory, Vec2 } from './types'
import { FIELD, AFFINITY } from '../data/constants'

/**
 * 軌道に紐づく z 場を位置 (x,y) で評価する（#30）。z 場未指定なら中立(0)。
 * z 場は**ステージ中央 (0,0) を原点**に絶対座標で評価する（#58：全員共通なので原点も共通。
 * 味方も敵も同じ場を見る。旧 #52 の術者位置基準は共通化に伴い廃止）。
 */
export function zfieldAt(traj: Trajectory, pos: Vec2): number {
  if (!traj.z) return 0
  const z = traj.z(pos.x, pos.y)
  return Number.isFinite(z) ? z : 0
}

/** z の符号で属性を返す（|z|<ε は中立・§3.2） */
export function attributeOf(z: number): Attribute {
  if (Math.abs(z) < FIELD.epsilon) return 'neutral'
  return z > 0 ? 'light' : 'dark'
}

/**
 * 属性強度（#21・山型）：|z|=zPeak で最大 sMax、|z|=0 と |z|=2·zPeak で 0。
 * 「絶対値が大きいほど強い」のではなく「ある値 V=zPeak に近いほど強い」。
 */
export function strengthOf(z: number): number {
  const a = Math.abs(z)
  const s = FIELD.sMax * (1 - Math.abs(a - FIELD.zPeak) / FIELD.zPeak)
  return s > 0 ? s : 0
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

/** 弾が帯びる属性（経路で強度が最大の点）。パリィ判定などに使う。 */
export function dominantAttribute(
  traj: Trajectory,
  samples: { pos: Vec2 }[],
): { attr: Attribute; strength: number } {
  let best: { attr: Attribute; strength: number } = { attr: 'neutral', strength: 0 }
  for (const s of samples) {
    const z = zfieldAt(traj, s.pos)
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
