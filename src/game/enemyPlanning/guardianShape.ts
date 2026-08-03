// 守護型（guardian）の結界の**外形**最適化（#71・05b §5.4）。純粋関数。
// 「素材に絶対触れない」「自分と近くの味方を覆う」を、角度ごとの半径プロファイルとして組む：
//   上限 = 素材に触れない自由半径 free(θ) ／ 下限 = 覆う対象が要求する半径 req(θ)
// そのプロファイルを **K 項のフーリエ級数（sin/cos の重ね合わせ）** へ最小二乗フィットして
// 1本の閉曲線 r=f(θ) にする。K（＝扱える式の複雑さ）は敵の LVL で決まる（#70 と同じ思想）。
import type { Obstacle, Vec2 } from '../types'
import { isSolidAt } from '../obstacle'
import { ENEMY_GUARD_PLANNING as GP, OBSTACLE_STEP } from '../../data/constants'

/** 覆う対象（自陣の味方）。radius はヒットボックス半径。 */
export interface CoverTarget {
  pos: Vec2
  radius: number
}

/** 0..2π を等分した角度サンプル（プロファイル・フィット共通）。 */
export function guardAngles(n: number = GP.angleSamples): number[] {
  return Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2)
}

/** 2つの角度の最小差（0..π）。 */
function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2)
  return d > Math.PI ? Math.PI * 2 - d : d
}

/**
 * 角度ごとの「素材に触れない上限半径」free(θ)。
 * 敵位置から各方向へ OBSTACLE_STEP/2 刻みで進み、最初に素材へ入る距離から余白 clearance を引く。
 * 素材が無い方向は maxR。刻みは本番の障害物判定（OBSTACLE_STEP）より細かく取る。
 */
export function freeRadiusProfile(
  origin: Vec2,
  obstacles: Obstacle[],
  maxR: number,
  angles: number[],
): number[] {
  if (obstacles.length === 0) return angles.map(() => maxR)
  const step = OBSTACLE_STEP / 2
  const limit = maxR + GP.clearance
  return angles.map((a) => {
    const cx = Math.cos(a)
    const cy = Math.sin(a)
    for (let r = 0; r <= limit + 1e-9; r += step) {
      const p = { x: origin.x + r * cx, y: origin.y + r * cy }
      if (obstacles.some((ob) => isSolidAt(ob, p))) {
        return Math.max(0, Math.min(maxR, r - GP.clearance))
      }
    }
    return maxR
  })
}

/**
 * 覆う対象が要求する半径 req(θ)。対象の方向を含む角度窓で「距離＋ヒットボックス＋余白」以上を要求する。
 * 窓の半角は対象の見かけの角半径（＋角度刻み1つ分）＝近い相手ほど広い窓になる。
 */
export function coverRequirement(origin: Vec2, targets: CoverTarget[], angles: number[]): number[] {
  const req = angles.map(() => 0)
  const stepAngle = (Math.PI * 2) / angles.length
  for (const t of targets) {
    const dx = t.pos.x - origin.x
    const dy = t.pos.y - origin.y
    const d = Math.hypot(dx, dy)
    const need = d + t.radius + GP.coverMargin
    const phi = Math.atan2(dy, dx)
    const half = Math.atan2(t.radius + GP.coverMargin, Math.max(d, 1e-6)) + stepAngle
    for (let i = 0; i < angles.length; i++) {
      if (angleGap(angles[i], phi) <= half) req[i] = Math.max(req[i], need)
    }
  }
  return req
}

/**
 * ρ(θ) を K 項のフーリエ級数へ最小二乗フィットした半径関数を返す（等間隔サンプルなので
 * 係数は離散フーリエ係数そのもの）：f(θ) = c₀ + Σ_{k=1..K}(a_k·cos kθ + b_k·sin kθ)。
 * K が大きいほどプロファイルに密着＝壁の隙間に沿って歪んだ結界を張れる（＝強い敵）。
 */
export function fourierProfile(
  values: number[],
  angles: number[],
  terms: number,
): (theta: number) => number {
  const n = values.length
  const c0 = values.reduce((s, v) => s + v, 0) / n
  const a: number[] = []
  const b: number[] = []
  for (let k = 1; k <= terms; k++) {
    let ak = 0
    let bk = 0
    for (let i = 0; i < n; i++) {
      ak += values[i] * Math.cos(k * angles[i])
      bk += values[i] * Math.sin(k * angles[i])
    }
    a.push((2 * ak) / n)
    b.push((2 * bk) / n)
  }
  return (t) => {
    let r = c0
    for (let k = 1; k <= terms; k++) r += a[k - 1] * Math.cos(k * t) + b[k - 1] * Math.sin(k * t)
    return r
  }
}

/**
 * リング（本番と同じ点列）が素材に触れないか（#71：「絶対に当たらない」の最終確認）。
 * 各点そのものに加え、半径方向 ±clearance の点も見る＝本番の霧散判定（点だけ）より厳しく取る。
 */
export function ringClearsMaterial(
  points: Vec2[],
  obstacles: Obstacle[],
  origin: Vec2,
  clearance: number,
): boolean {
  if (obstacles.length === 0) return true
  for (const p of points) {
    const dx = p.x - origin.x
    const dy = p.y - origin.y
    const len = Math.hypot(dx, dy) || 1
    for (const s of [0, clearance, -clearance]) {
      const q = { x: p.x + (dx / len) * s, y: p.y + (dy / len) * s }
      if (obstacles.some((ob) => isSolidAt(ob, q))) return false
    }
  }
  return true
}

/**
 * リングの半径プロファイル（origin 基準・角度ビンごとの最大距離）。既存結界との「同じ結界」判定に使う。
 * 点が無いビンは null。
 */
export function radialProfile(points: Vec2[], origin: Vec2, angles: number[]): (number | null)[] {
  const out: (number | null)[] = angles.map(() => null)
  const n = angles.length
  for (const p of points) {
    const dx = p.x - origin.x
    const dy = p.y - origin.y
    const d = Math.hypot(dx, dy)
    const a = Math.atan2(dy, dx)
    const i = ((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n
    const cur = out[i]
    if (cur === null || d > cur) out[i] = d
  }
  return out
}

/** 2つの半径プロファイルの平均差（両方に値があるビンだけ・比較不能なら Infinity＝別物扱い）。 */
export function profileGap(a: (number | null)[], b: (number | null)[]): number {
  let sum = 0
  let cnt = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === null || y === null) continue
    sum += Math.abs(x - y)
    cnt++
  }
  return cnt === 0 ? Infinity : sum / cnt
}
