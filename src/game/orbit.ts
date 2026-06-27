// 軌道型（ループ）魔法：周回リングによる掃射（攻撃）と迎撃（防御・#4）。純粋関数。
// リングは閉じた点列＋各点の z（属性）。攻撃＝リングに触れた敵へダメージ、防御＝敵弾がリング境界を横切れば迎撃。
import type { Attribute, Trajectory, Vec2 } from './types'
import { COMBAT, FIELD } from '../data/constants'
import { sampleTrajectory, validPrefix, dist } from './coords'
import { trajectoryZ, attributeOf, strengthOf, affinityMultiplier } from './attribute'
import { firstCrossing } from './parry'

/** リング上の1点（位置＋属性 z） */
export interface RingPoint {
  pos: Vec2
  z: number
}

/** ループ軌道からリング（場内の有効点列＋各点の z）を作る。 */
export function buildRing(traj: Trajectory): RingPoint[] {
  return validPrefix(sampleTrajectory(traj)).map((s) => ({
    pos: s.pos,
    z: trajectoryZ(traj, s.param),
  }))
}

/** リング上で対象に最も近い点の index と距離。 */
function nearest(ring: RingPoint[], pos: Vec2): { idx: number; d: number } {
  let idx = 0
  let d = Infinity
  for (let i = 0; i < ring.length; i++) {
    const dd = dist(ring[i].pos, pos)
    if (dd < d) {
      d = dd
      idx = i
    }
  }
  return { idx, d }
}

/** 掃射対象（敵の円ヒットボックス＋防御属性） */
export interface OrbitTarget {
  id: string
  pos: Vec2
  radius: number
  element: Attribute
}

/** 掃射ヒット結果 */
export interface OrbitHit {
  id: string
  damage: number
  attr: Attribute
  strength: number
}

/**
 * リングが触れる対象へのダメージ＝代表速度 × 強度(|z|) × 相性。
 * thickness はリングの当たり厚み（ユニット）。
 */
export function orbitSweep(
  ring: RingPoint[],
  speed: number,
  targets: OrbitTarget[],
  thickness = 0.7,
): OrbitHit[] {
  const hits: OrbitHit[] = []
  if (ring.length === 0) return hits
  for (const t of targets) {
    const n = nearest(ring, t.pos)
    if (n.d <= t.radius + thickness) {
      const z = ring[n.idx].z
      const attr = attributeOf(z)
      const strength = strengthOf(z)
      const damage = speed * strength * affinityMultiplier(attr, t.element)
      if (damage > 0) hits.push({ id: t.id, damage, attr, strength })
    }
  }
  return hits
}

/** 敵弾（直線パス）のリング境界横断（迎撃・防御） */
export interface RingInterception {
  crossed: boolean
  pos?: Vec2
  /** 横断点付近のリング属性 z（迎撃の相性判定に使う） */
  ringZ?: number
  /** 敵弾パス上の横断 index */
  enemyIndex?: number
}

/**
 * リングが敵弾を迎撃（防御・#4）するときに削る速度。
 * 反対極のリングほど強く弾く（×1.5）、同極は吸収弱め（×0.5）。リング強度|z|でもスケール。
 */
export function orbitBlockLoss(ringZ: number, bulletAttr: Attribute): number {
  const ringAttr = attributeOf(ringZ)
  const aff = affinityMultiplier(ringAttr, bulletAttr)
  const strFrac = Math.min(1, strengthOf(ringZ) / FIELD.sMax)
  return COMBAT.shieldSpeedLoss * aff * (0.6 + 0.8 * strFrac)
}

/** 敵弾パスがリング境界を最初に横切る点を返す（横切らなければ crossed=false）。 */
export function ringInterception(ring: RingPoint[], enemyPath: Vec2[]): RingInterception {
  if (ring.length < 2) return { crossed: false }
  const ringPath = ring.map((r) => r.pos)
  const cross = firstCrossing(enemyPath, ringPath)
  if (!cross) return { crossed: false }
  const z = ring[Math.min(cross.indexB, ring.length - 1)].z
  return { crossed: true, pos: cross.pos, ringZ: z, enemyIndex: cross.indexA }
}
