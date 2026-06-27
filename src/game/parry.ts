// パリィ（クラッシュ解決・§3.8・機能12）：同極/中立はすり抜け、反対極のみ相殺。
// 速度を削り合い、0 になった側は消滅。純粋関数。
import type { Attribute, Vec2 } from './types'
import { COMBAT } from '../data/constants'

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}
function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

/** 線分 p1p2 と p3p4 の交差点（媒介変数 t,u つき）。交わらなければ null。 */
export function segmentIntersect(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  p4: Vec2,
): { point: Vec2; t: number; u: number } | null {
  const r = sub(p2, p1)
  const s = sub(p4, p3)
  const denom = cross(r, s)
  if (denom === 0) return null // 平行
  const qp = sub(p3, p1)
  const t = cross(qp, s) / denom
  const u = cross(qp, r) / denom
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { point: { x: p1.x + r.x * t, y: p1.y + r.y * t }, t, u }
  }
  return null
}

/** 2つのパスが最初に交差する点（プレイヤーパス上で最も手前）。 */
export function firstCrossing(
  pathA: Vec2[],
  pathB: Vec2[],
): { pos: Vec2; indexA: number; indexB: number } | null {
  for (let i = 1; i < pathA.length; i++) {
    for (let j = 1; j < pathB.length; j++) {
      const hit = segmentIntersect(pathA[i - 1], pathA[i], pathB[j - 1], pathB[j])
      if (hit) return { pos: hit.point, indexA: i, indexB: j }
    }
  }
  return null
}

/** パリィ解決の結果 */
export interface ParryResult {
  /** 相互作用せずすり抜けたか（同極/中立） */
  passthrough: boolean
  speedA: number
  speedB: number
  vanishA: boolean
  vanishB: boolean
}

/**
 * 交差した2弾の属性・速度・威力からパリィを解決する。
 * - 同極（光×光/闇×闇）または一方が中立 → すり抜け（速度そのまま継続）
 * - 反対極（光×闇） → 相手の威力に応じて速度を削り合う。0 側は消滅。
 */
export function resolveParry(
  attrA: Attribute,
  speedA: number,
  powerA: number,
  attrB: Attribute,
  speedB: number,
  powerB: number,
): ParryResult {
  const opposite =
    (attrA === 'light' && attrB === 'dark') || (attrA === 'dark' && attrB === 'light')
  if (!opposite) {
    // 同極・中立はすり抜け
    return { passthrough: true, speedA, speedB, vanishA: false, vanishB: false }
  }
  const newA = Math.max(0, speedA - powerB * COMBAT.parryLossScale)
  const newB = Math.max(0, speedB - powerA * COMBAT.parryLossScale)
  return {
    passthrough: false,
    speedA: newA,
    speedB: newB,
    vanishA: newA <= 0,
    vanishB: newB <= 0,
  }
}
