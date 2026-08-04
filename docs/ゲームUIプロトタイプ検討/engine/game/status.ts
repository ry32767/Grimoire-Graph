// 状態異常（§3.3）：光＝ひるみ（行動阻害）／闇＝継続ダメージ（DoT）。|z| でスケール。
// 持続は「ターン数」で管理する（ターン制）。純粋関数。
import type { Attribute, StatusEffect } from './types'
import { COMBAT, FIELD } from '../data/constants'

/** 攻撃属性と強度から付与する状態異常を作る（中立は付与なし）。 */
export function makeStatus(attribute: Attribute, strength: number): StatusEffect | null {
  if (strength <= 0) return null
  if (attribute === 'light') {
    // ひるみ：|z| が強いほど長くひるむ（最低1ターン）
    const turns = Math.max(COMBAT.flinchBaseTurns, Math.ceil(strength / 2))
    return { kind: 'flinch', magnitude: strength, remainingTurns: turns }
  }
  if (attribute === 'dark') {
    // 継続ダメージ：総量 |z|×burnScale を burnTurns に分割
    const perTurn = (strength * COMBAT.burnScale) / COMBAT.burnTurns
    return { kind: 'burn', magnitude: perTurn, remainingTurns: COMBAT.burnTurns }
  }
  return null
}

/** 状態異常を付与（同種は持続・大きさを強い方へ更新してスタックを防ぐ）。 */
export function addStatus(statuses: StatusEffect[], next: StatusEffect | null): StatusEffect[] {
  if (!next) return statuses
  const idx = statuses.findIndex((s) => s.kind === next.kind)
  if (idx === -1) return [...statuses, next]
  const merged = statuses.slice()
  const cur = merged[idx]
  merged[idx] = {
    kind: cur.kind,
    magnitude: Math.max(cur.magnitude, next.magnitude),
    remainingTurns: Math.max(cur.remainingTurns, next.remainingTurns),
  }
  return merged
}

/** ターン開始時の状態異常処理の結果 */
export interface TurnStatusResult {
  /** このターンに減らした状態異常リスト（期限切れは除去） */
  statuses: StatusEffect[]
  /** 継続ダメージ（闇）の合計 */
  burnDamage: number
  /** ひるみ（光）で行動阻害されるか */
  impaired: boolean
}

/**
 * ターン開始時：DoT ダメージを適用し、ひるみ判定をしてから持続を1減らす。
 * remainingTurns が 0 になったものは除去する。
 */
export function tickStatuses(statuses: StatusEffect[]): TurnStatusResult {
  let burnDamage = 0
  let impaired = false
  for (const s of statuses) {
    if (s.kind === 'burn') burnDamage += s.magnitude
    if (s.kind === 'flinch') impaired = true
  }
  const next = statuses
    .map((s) => ({ ...s, remainingTurns: s.remainingTurns - 1 }))
    .filter((s) => s.remainingTurns > 0)
  return { statuses: next, burnDamage, impaired }
}

/** 最大強度（暴発）で光・闇の両状態異常を作る（§3.5・機能8）。 */
export function maxStatuses(): StatusEffect[] {
  return [
    makeStatus('light', FIELD.sMax),
    makeStatus('dark', FIELD.sMax),
  ].filter((s): s is StatusEffect => s !== null)
}
