// 暴発の不安定化・累積・崩壊（04b）。純粋関数。
// instability（膜の摩耗）はラン全体で累積し、暴発が「解決」するたび +1（味方でも敵でも同じ）。
// 三段階の開示：隠蔽（異変と半径ブレのみ）→ 初回崩壊（グリモワール救済・一度きり）→ 致死（メーター可視・上限で破局）。
import { FIELD, INSTABILITY } from '../data/constants'

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 半径ばらつき係数 v(count)（04b §4b.3）。
 * v = clamp((count − vStart) / (misfireLimit − vStart), 0, 1) × vMax。平均は変えず分散だけ広げる。
 */
export function varianceOf(count: number): number {
  return clamp01((count - INSTABILITY.vStart) / (INSTABILITY.misfireLimit - INSTABILITY.vStart)) * INSTABILITY.vMax
}

/**
 * 暴発の実半径（発射解決時に確定）。roll∈[0,1) を一様乱数として
 * 実半径 = aoeRadius × (1 + U(−v,+v))、下限 1。roll=0.5 でちょうど aoeRadius（ブレなし）。
 */
export function misfireRadius(count: number, roll: number): number {
  const v = varianceOf(count)
  const u = clamp01(roll) * 2 - 1
  return Math.max(1, FIELD.aoeRadius * (1 + u * v))
}

/** プレビューのブレ帯（ぼやけた二重リング）の [min, max] 半径（04b §4b.3）。 */
export function misfireRadiusBand(count: number): { min: number; max: number } {
  const v = varianceOf(count)
  return { min: Math.max(1, FIELD.aoeRadius * (1 - v)), max: FIELD.aoeRadius * (1 + v) }
}

/**
 * ステージの異変の段階（第1幕・04b §4b.2）。0=静か／1=背景が波打つ／2=床のひび・ノイズ／3=崩壊目前。
 * 初回崩壊後もそのまま演出強度として使える（count 単調増）。
 */
export function anomalyLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 1) return 0
  if (count <= 3) return 1
  if (count <= INSTABILITY.firstCollapseThreshold - 1) return 2
  return 3
}

/**
 * 初回崩壊を起こすべきか（04b §4b.2：閾値優先・保証面で必ず）。
 * collapseSeen（一度きり）なら二度と起きない。保証面では対詠が始まったあと（turn≥2）に発生させる。
 */
export function shouldFirstCollapse(
  count: number,
  stageNumber: number,
  turn: number,
  collapseSeen: boolean,
): boolean {
  if (collapseSeen) return false
  if (count >= INSTABILITY.firstCollapseThreshold) return true
  return stageNumber >= INSTABILITY.firstCollapseStage && turn >= 2
}

/** 致死判定：count が上限に達したらステージ全体暴発＝ゲームオーバー（初回崩壊後・救済なし）。 */
export function isLethal(count: number): boolean {
  return count >= INSTABILITY.misfireLimit
}

/** あと何回で崩壊するか（メーター表示・下限0）。 */
export function remainingMisfires(count: number): number {
  return Math.max(0, INSTABILITY.misfireLimit - count)
}

/** 暴発ゼロでステージクリアしたときの緩和（04b §4b.1・下限0）。 */
export function applyStageClearRelief(count: number, stageMisfires: number): number {
  if (stageMisfires > 0) return count
  return Math.max(0, count - INSTABILITY.relief)
}
