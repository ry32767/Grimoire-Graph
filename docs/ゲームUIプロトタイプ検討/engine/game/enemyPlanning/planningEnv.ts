// 敵AIの経路計画が参照する「本番と同一のジオメトリ空間」（修正仕様書 §6）。純粋関数。
// AI用に簡易な障害物判定を別に作らず、本番と同じ素材定義（solids の円和＋rects の矩形和−carves の
// 円引き算・kind 種別）を参照する。clearance は本番判定より少し広い余白＝「クリーン」経路の保証幅。
import type { Obstacle, Vec2 } from '../types'
import { isSolidAt } from '../obstacle'
import { ENEMY_ROUTE_PLANNING, FIELD } from '../../data/constants'

/** 経路計画用の空間クエリ一式。1ターン・1盤面ごとに構築して使い回す。 */
export interface PlanningEnv {
  fieldR: number
  obstacles: Obstacle[]
  clearance: number
  /** 場内（|p| ≤ fieldR）か */
  isInField: (p: Vec2) => boolean
  /** 点 p が素材内か＝本番 isSolidAt と同一判定 */
  isMaterial: (p: Vec2) => boolean
  /** 中心 p・半径 radius の円が素材に触れるか（素材を radius ぶん膨張させた判定） */
  overlapsMaterial: (p: Vec2, radius: number) => boolean
  /** 点 p が unbreakable（削れない壁）の素材内か */
  isUnbreakable: (p: Vec2) => boolean
  /** 中心 p・半径 radius の円が unbreakable に触れるか */
  overlapsUnbreakable: (p: Vec2, radius: number) => boolean
}

/**
 * 素材を c だけ膨張させた「点 p が素材から距離 c 以内か」の近似判定。
 * solids/rects は c 膨張で当たり、carves は「c より深く穴の内側」なら素材ではないとみなす
 * （穴の縁から c 以内は素材扱い＝安全側）。本番 isSolidAt と同じ構造（和−引き算）を保つ。
 */
function nearMaterial(ob: Obstacle, p: Vec2, c: number): boolean {
  let near = false
  for (const s of ob.solids) {
    if (Math.hypot(p.x - s.x, p.y - s.y) <= s.r + c) {
      near = true
      break
    }
  }
  if (!near && ob.rects) {
    for (const r of ob.rects) {
      const cx = Math.max(r.x, Math.min(p.x, r.x + r.w))
      const cy = Math.max(r.y, Math.min(p.y, r.y + r.h))
      if (Math.hypot(cx - p.x, cy - p.y) <= c) {
        near = true
        break
      }
    }
  }
  if (!near) return false
  for (const cv of ob.carves) {
    if (Math.hypot(p.x - cv.x, p.y - cv.y) <= cv.r - c) return false
  }
  return true
}

/**
 * 本番ジオメトリと同じ障害物・場を参照する PlanningEnv を構築する。
 * clearance を明示すると「素材からその距離だけ離れた経路」しか通らなくなる（#69）：
 * 柱の隙間の**真ん中**を通る経路が得られ、後段の family フィットが多少ずれても素材に触れない。
 * 弾は硬い壁に一度触れただけで失速して消えるので、この余白が命中率を大きく左右する。
 */
export function buildPlanningEnv(obstacles: Obstacle[], fieldR?: number, clearance?: number): PlanningEnv {
  const R = fieldR ?? FIELD.rField
  const unbreakables = obstacles.filter((ob) => (ob.kind ?? 'normal') === 'unbreakable')
  return {
    fieldR: R,
    obstacles,
    clearance: clearance ?? ENEMY_ROUTE_PLANNING.clearance,
    isInField: (p) => Math.hypot(p.x, p.y) <= R,
    isMaterial: (p) => obstacles.some((ob) => isSolidAt(ob, p)),
    overlapsMaterial: (p, radius) => obstacles.some((ob) => nearMaterial(ob, p, radius)),
    isUnbreakable: (p) => unbreakables.some((ob) => isSolidAt(ob, p)),
    overlapsUnbreakable: (p, radius) => unbreakables.some((ob) => nearMaterial(ob, p, radius)),
  }
}
