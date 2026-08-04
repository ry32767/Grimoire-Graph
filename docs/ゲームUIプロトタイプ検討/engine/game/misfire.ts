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
  /** 威力 = 常に最大（Smax × 終端速度 maxFlightSpeed）。暴発は常に最大威力の術式（§3.5） */
  power: number
  /** ダメージ = 威力 × 1.5（常に有利側） */
  damage: number
  /** 付与する状態異常（光ひるみ＋闇DoT、最大強度） */
  statuses: StatusEffect[]
  /** AoE 内の対象 id */
  hitIds: string[]
  /** 術者（原点）を巻き込むか（自爆） */
  selfHit: boolean
  /** 実際に使った AoE 半径（04b §4b.3：instability でばらつく。既定 aoeRadius） */
  radius: number
}

/**
 * 暴発点・到達速度・対象から AoE ダメージを解決する。
 * 暴発でクラッシュはせず戦闘は継続する（呼び出し側で適用）。
 * radius は instability による半径ばらつき（04b §4b.3）を反映した実半径。未指定は aoeRadius。
 * casterPos は術者の位置（自爆判定の基準）。未指定は数学原点（術者が原点にいる場合と等価）。
 */
export function resolveMisfire(
  point: MisfirePoint,
  speed: number,
  targets: AoeTarget[],
  radius: number = FIELD.aoeRadius,
  casterPos: Vec2 = { x: 0, y: 0 },
): MisfireResult {
  // 暴発は常に最大威力：強度・速度ともに最大（Smax × maxFlightSpeed）。速度に依らず一定（§3.5）
  const power = FIELD.sMax * FIELD.maxFlightSpeed
  const damage = power * AFFINITY.opposite // 常に有利側（光・闇の両極性を最大で帯びる）
  const hitIds = targets.filter((t) => dist(t.pos, point.pos) <= radius).map((t) => t.id)
  const selfHit = dist(point.pos, casterPos) <= radius
  return { pos: point.pos, speed, power, damage, statuses: maxStatuses(), hitIds, selfHit, radius }
}
