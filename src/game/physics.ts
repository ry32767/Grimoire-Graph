// 物理：加速度場・運動量・速度減衰・消滅（機能5）。純粋関数。
//
// 速度モデル：dv/dt = a(z), ds/dt = v より v² = v₀² + 2∫a ds（弧長積分。v←v+a·dt と等価）。
// 新モデルでは加速度の根拠となる z は「弾の関数値（高さ）」。回転=g(x)/極座標=f(θ)、
// 敵弾など明示パスでは zAt で与える。中立(z≈0)で最大加速、強属性(|z|≥zRef)で加速0。
import type { Flight, FlightEnd, FlightSample, Trajectory, Vec2 } from './types'
import { FIELD } from '../data/constants'
import { sampleTrajectory, buildPolyline, pathTermination, dist, type PolyPoint } from './coords'
import { trajectoryZ } from './attribute'

/** 加速度 a = aMax × (1 − clamp(|z|/zRef, 0, 1))。|z|≈0 で最大、|z|≥zRef で 0（§3.4） */
export function acceleration(z: number): number {
  const ratio = Math.min(Math.max(Math.abs(z) / FIELD.zRef, 0), 1)
  return FIELD.aMax * (1 - ratio)
}

/** 速度プロファイル：経路（poly）と各頂点までの加速度積分 A、初速、終端情報。 */
export interface SpeedProfile {
  poly: PolyPoint[]
  accel: number[]
  v0: number
  end: FlightEnd
  endPos: Vec2
}

/** ポリラインと「頂点ごとの z」から加速度積分 A（各頂点まで）を求める（台形則）。 */
function accelIntegral(poly: PolyPoint[], zAt: (i: number) => number): number[] {
  const accel: number[] = []
  let acc = 0
  for (let i = 0; i < poly.length; i++) {
    if (i > 0) {
      const segLen = poly[i].cumLen - poly[i - 1].cumLen
      const aPrev = acceleration(zAt(i - 1))
      const aCur = acceleration(zAt(i))
      acc += ((aPrev + aCur) / 2) * segLen
    }
    accel.push(acc)
  }
  return accel
}

/** 軌道（原点起点）から速度プロファイルを構築する。z は関数値 g(x)/f(θ)。 */
export function buildSpeedProfile(traj: Trajectory, initialSpeed: number): SpeedProfile {
  const samples = sampleTrajectory(traj)
  const poly = buildPolyline(samples)
  const term = pathTermination(samples)
  const accel = accelIntegral(poly, (i) => trajectoryZ(traj, poly[i].param))
  return { poly, accel, v0: initialSpeed, end: term.end, endPos: term.pos }
}

/** 明示的な点列（例：敵→原点）から累積弧長つきポリラインを作る。 */
export function polyFromPoints(points: Vec2[]): PolyPoint[] {
  const poly: PolyPoint[] = []
  let acc = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) acc += dist(points[i], points[i - 1])
    poly.push({ pos: points[i], cumLen: acc, param: i })
  }
  return poly
}

/** 明示パス（敵弾など）から速度プロファイルを構築する。z は zAt(index) で与える。 */
export function buildPathProfile(
  points: Vec2[],
  initialSpeed: number,
  zAt: (i: number) => number,
): SpeedProfile {
  const poly = polyFromPoints(points)
  const endPos = points.length > 0 ? points[points.length - 1] : { x: 0, y: 0 }
  const accel = accelIntegral(poly, zAt)
  return { poly, accel, v0: initialSpeed, end: 'maxParam', endPos }
}

/** エネルギー基準（vBaseSq, 基準点での A）から速度を求める（終端速度でクランプ）。 */
function speedFromEnergy(vBaseSq: number, deltaAccel: number): number {
  const sq = vBaseSq + 2 * deltaAccel
  const v = sq > 0 ? Math.sqrt(sq) : 0
  return Math.min(v, FIELD.maxFlightSpeed)
}

/** 自由飛行時の弧長 s での速度（減衰イベントなし）。 */
export function speedAtLength(profile: SpeedProfile, s: number): number {
  const { poly, accel, v0 } = profile
  if (poly.length === 0) return v0
  const total = poly[poly.length - 1].cumLen
  const clamped = Math.max(0, Math.min(s, total))
  let A = accel[accel.length - 1]
  for (let i = 1; i < poly.length; i++) {
    if (poly[i].cumLen >= clamped) {
      const segLen = poly[i].cumLen - poly[i - 1].cumLen
      const t = segLen > 0 ? (clamped - poly[i - 1].cumLen) / segLen : 0
      A = accel[i - 1] + (accel[i] - accel[i - 1]) * t
      break
    }
  }
  return speedFromEnergy(v0 * v0, A)
}

/** 速度減衰イベント（障害物/シールド/パリィ） */
export interface LossEvent {
  arcLen: number
  deltaV: number
}

/** 速度プロファイルと減衰イベントから飛行を解決する（コア）。 */
export function simulateProfile(profile: SpeedProfile, losses: LossEvent[]): Flight {
  const { poly, accel, v0, end, endPos } = profile
  if (poly.length === 0) {
    return { samples: [], end, endPos, endSpeed: v0 }
  }
  const sorted = [...losses].sort((a, b) => a.arcLen - b.arcLen)
  const samples: FlightSample[] = []
  let vBaseSq = v0 * v0
  let aBase = 0
  let li = 0

  for (let i = 0; i < poly.length; i++) {
    const s = poly[i].cumLen
    while (li < sorted.length && sorted[li].arcLen <= s + 1e-9) {
      const vHere = speedFromEnergy(vBaseSq, accel[i] - aBase)
      const vAfter = Math.max(0, vHere - sorted[li].deltaV)
      vBaseSq = vAfter * vAfter
      aBase = accel[i]
      li++
      if (vAfter <= 0) {
        samples.push({ pos: poly[i].pos, speed: 0, arcLen: s, param: poly[i].param })
        return { samples, end: 'vanished', endPos: poly[i].pos, endSpeed: 0 }
      }
    }
    const v = speedFromEnergy(vBaseSq, accel[i] - aBase)
    samples.push({ pos: poly[i].pos, speed: v, arcLen: s, param: poly[i].param })
  }
  return { samples, end, endPos, endSpeed: samples[samples.length - 1].speed }
}

/** 自由飛行のシミュレーション（プレビュー・描画・テスト用）。 */
export function simulateFlight(traj: Trajectory, initialSpeed: number): Flight {
  return simulateProfile(buildSpeedProfile(traj, initialSpeed), [])
}

/** 軌道（原点起点）に減衰イベントを適用して飛行を解決する。 */
export function simulateWithLosses(
  traj: Trajectory,
  initialSpeed: number,
  losses: LossEvent[],
): Flight {
  return simulateProfile(buildSpeedProfile(traj, initialSpeed), losses)
}

/** 明示パス（敵弾など・zAt で高さを与える）に減衰イベントを適用して解決する。 */
export function simulatePath(
  points: Vec2[],
  initialSpeed: number,
  zAt: (i: number) => number,
  losses: LossEvent[] = [],
): Flight {
  return simulateProfile(buildPathProfile(points, initialSpeed, zAt), losses)
}

/** 飛行サンプルから、ある弧長以下で最後に到達した点（命中位置の補助）。 */
export function sampleAtLength(flight: Flight, s: number): FlightSample | null {
  let found: FlightSample | null = null
  for (const sm of flight.samples) {
    if (sm.arcLen <= s + 1e-9) found = sm
    else break
  }
  return found
}

/** dt は時間刻みの参照用（数値安定の根拠・§3.4）。 */
export const PHYSICS_DT = FIELD.dt
