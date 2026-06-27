// 魔法の二系統（#12）：軌道が「ループしているか」で発射型/軌道型を分ける。純粋関数。
//  - projectile（発射型・火球）：開いた軌道。術者から飛び、最初に当たった対象へ命中する。
//  - orbit（軌道型・周回）：閉じた軌道（例 x²+y²=1）。術者の周りを回り続け、掃射＋迎撃（防御）を兼ねる（#4）。
import type { Trajectory, Vec2 } from './types'
import { sampleTrajectory, validPrefix, dist } from './coords'

export type MagicKind = 'projectile' | 'orbit'

/**
 * 軌道が閉じている（ループ）か。回転 y=g(x) は単調に外へ伸びる関数グラフなので常に開（false）。
 * 極座標は、十分離れてから始点付近へ戻ってくる閉曲線（円・バラ・リマソン等）を true とする。
 */
export function isLoop(traj: Trajectory): boolean {
  if (traj.mode === 'rotate') return false
  const pts = validPrefix(sampleTrajectory(traj)).map((s) => s.pos)
  if (pts.length < 12) return false
  const start = pts[0]
  let maxDepart = 0
  for (const p of pts) maxDepart = Math.max(maxDepart, dist(p, start))
  if (maxDepart < 1.5) return false // ほぼ点＝退化
  // 後半のどこかで始点付近へ戻れば閉曲線
  const tol = Math.max(0.6, maxDepart * 0.2)
  for (let i = Math.floor(pts.length * 0.5); i < pts.length; i++) {
    if (dist(pts[i], start) <= tol) return true
  }
  return false
}

/** 軌道の種別（発射型／軌道型）を返す。 */
export function classifyTrajectory(traj: Trajectory): MagicKind {
  return isLoop(traj) ? 'orbit' : 'projectile'
}

/** 中心（術者位置）。origin 未指定は原点。 */
export function trajectoryOrigin(traj: Trajectory): Vec2 {
  return traj.origin ?? { x: 0, y: 0 }
}
