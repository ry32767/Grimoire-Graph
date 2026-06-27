// 暴発（術式の綻び・§3.5・機能8）：光と闇を最大強度で併せ持つ特殊術式。
// 常に有利側（×1.5）が適用され、ひるみ＋継続ダメージの両方を付与。原点近傍なら自爆。
import type { StatusEffect, Trajectory, Vec2 } from './types'
import { FIELD, AFFINITY } from '../data/constants'
import { sampleTrajectory, pathTermination, dist } from './coords'
import { maxStatuses } from './status'

/** 暴発点 */
export interface MisfirePoint {
  type: 'invalid' | 'outOfField'
  pos: Vec2
}

/**
 * 軌道を原点側から外側へ評価し、最初に未定義・発散・非実数・場外になった点（暴発点）を返す。
 * 場内で軌道を進み切る（maxParam）なら暴発しない → null。
 */
export function detectMisfire(traj: Trajectory): MisfirePoint | null {
  const term = pathTermination(sampleTrajectory(traj))
  if (term.end === 'maxParam') return null
  return { type: term.end, pos: term.pos }
}

/** 暴発の AoE 内に入る対象（円判定） */
export interface AoeTarget {
  id: string
  pos: Vec2
}

/** 暴発の結果 */
export interface MisfireResult {
  pos: Vec2
  speed: number
  /** 威力 = 暴発時の速度 × Smax */
  power: number
  /** ダメージ = 威力 × 1.5（常に有利側） */
  damage: number
  /** 付与する状態異常（光ひるみ＋闇DoT、最大強度） */
  statuses: StatusEffect[]
  /** AoE 内の対象 id */
  hitIds: string[]
  /** 術者（原点）を巻き込むか（自爆） */
  selfHit: boolean
}

/**
 * 暴発点・到達速度・対象から AoE ダメージを解決する。
 * 暴発でクラッシュはせず戦闘は継続する（呼び出し側で適用）。
 */
export function resolveMisfire(
  point: MisfirePoint,
  speed: number,
  targets: AoeTarget[],
): MisfireResult {
  const power = speed * FIELD.sMax
  const damage = power * AFFINITY.opposite // 常に有利側
  const hitIds = targets.filter((t) => dist(t.pos, point.pos) <= FIELD.aoeRadius).map((t) => t.id)
  const selfHit = dist(point.pos, { x: 0, y: 0 }) <= FIELD.aoeRadius
  return { pos: point.pos, speed, power, damage, statuses: maxStatuses(), hitIds, selfHit }
}
