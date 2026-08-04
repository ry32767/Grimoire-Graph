// 物理：加速度場・運動量・速度減衰・消滅（機能5）。純粋関数。
//
// 速度モデル：dv/dt = a(z), ds/dt = v より v² = v₀² + 2∫a ds（弧長積分。v←v+a·dt と等価）。
// 新モデルでは加速度の根拠となる z は「弾の関数値（高さ）」。回転=g(x)/極座標=f(θ)、
// 敵弾など明示パスでは zAt で与える。中立(z≈0)で最大加速、強属性(|z|≥zRef)で加速0。
import type { Flight, FlightEnd, FlightSample, Trajectory, Vec2 } from './types'
import { FIELD } from '../data/constants'
import { sampleTrajectory, buildPolyline, pathTermination, dist, type PolyPoint } from './coords'
import { zfieldAt } from './attribute'

/**
 * 加速度 a = aMax × (1 − |z|/zRef)（#31）。
 * |z|≈0 で最大加速、|z|=zRef で 0、それより 0 から離れると負（減速）に転じる。
 * 減速は −aDecelMax で頭打ち（上限を定める）。z は位置で評価される z 場（有界）。
 */
export function acceleration(z: number): number {
  const a = FIELD.aMax * (1 - Math.abs(z) / FIELD.zRef)
  return a < -FIELD.aDecelMax ? -FIELD.aDecelMax : a
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

/** 軌道（原点起点）から速度プロファイルを構築する。z は位置で評価する z 場（#30）。 */
export function buildSpeedProfile(traj: Trajectory, initialSpeed: number): SpeedProfile {
  const samples = sampleTrajectory(traj)
  const poly = buildPolyline(samples)
  const term = pathTermination(samples)
  const accel = accelIntegral(poly, (i) => zfieldAt(traj, poly[i].pos))
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
    // 減衰イベントだけでなく、|z|>zRef の強属性で減速し自然に速度0へ達した点でも霧散する（#31）。
    if (v <= 0 && i > 0) {
      return { samples, end: 'vanished', endPos: poly[i].pos, endSpeed: 0 }
    }
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

/**
 * 飛行サンプル列の各点への到達時刻（Σ ds/v の台形積分・ゲーム秒）。
 * 失速区間（速度≈0）から先は Infinity（＝到達しない）。
 * パリィの実衝突判定（parry.bulletCollision）と暴発の余波（turn §4.7）が共有する。
 */
export function flightTimes(samples: FlightSample[]): number[] {
  const t = [0]
  for (let i = 1; i < samples.length; i++) {
    const vAvg = (samples[i - 1].speed + samples[i].speed) / 2
    const ds = samples[i].arcLen - samples[i - 1].arcLen
    t.push(vAvg <= 1e-9 ? Infinity : t[i - 1] + ds / vAvg)
  }
  return t
}

/**
 * 飛行の弧長 arcLen の点で瞬間的な減速 deltaV を適用した新しい飛行を返す（#66・暴発の余波）。
 * エネルギーモデル（v² は弧長に沿って加速度積分で決まる）に従い、適用点以降の速度を
 * v'(s)² = v(s)² − vAt² + vAfter² で書き換える。0 に達した点で打ち切り（消滅）。
 */
export function applyDeltaVAtArc(flight: Flight, arcLen: number, deltaV: number): Flight {
  const s0 = flight.samples
  if (s0.length < 2 || deltaV <= 0) return flight
  const out: FlightSample[] = []
  let dSq: number | null = null // vAfter² − vAt²（適用点で確定）
  for (let i = 0; i < s0.length; i++) {
    const smp = s0[i]
    if (smp.arcLen <= arcLen + 1e-9) {
      out.push(smp)
      continue
    }
    if (dSq === null) {
      const prev = s0[i - 1] ?? smp
      const span = smp.arcLen - prev.arcLen
      const f = span > 0 ? Math.max(0, Math.min(1, (arcLen - prev.arcLen) / span)) : 0
      const vAt = prev.speed + (smp.speed - prev.speed) * f
      const vAfter = Math.max(0, vAt - deltaV)
      if (vAfter <= 0) {
        // 適用点で完全に止まる：その場に停止サンプルを置いて消滅
        const pos = {
          x: prev.pos.x + (smp.pos.x - prev.pos.x) * f,
          y: prev.pos.y + (smp.pos.y - prev.pos.y) * f,
        }
        out.push({ pos, speed: 0, arcLen, param: prev.param + (smp.param - prev.param) * f })
        return { samples: out, end: 'vanished', endPos: pos, endSpeed: 0 }
      }
      dSq = vAfter * vAfter - vAt * vAt
    }
    const sq = smp.speed * smp.speed + dSq
    if (sq <= 1e-12) {
      // この点までに 0 へ達した＝ここで消滅（サンプル間隔ぶんの量子化は許容）
      out.push({ ...smp, speed: 0 })
      return { samples: out, end: 'vanished', endPos: smp.pos, endSpeed: 0 }
    }
    out.push({ ...smp, speed: Math.sqrt(sq) })
  }
  const last = out[out.length - 1]
  return { samples: out, end: flight.end, endPos: flight.endPos, endSpeed: last?.speed ?? 0 }
}

/**
 * 弧長 arcLen の点に弾が達する「飛行時間」（Σ ds/v の台形積分・ゲーム秒）。
 * 途中で失速（速度≈0）する・経路がそこまで届かない場合は Infinity（＝到達しない）。
 * パリィの同時性判定（2弾が交点を同時刻に通過するか）に使う。
 */
export function timeToArc(samples: FlightSample[], arcLen: number): number {
  if (samples.length === 0 || arcLen < 0) return Infinity
  let t = 0
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]
    const cur = samples[i]
    const vAvg = (prev.speed + cur.speed) / 2
    if (vAvg <= 1e-9) return Infinity // 失速区間＝この先へ進めない
    if (arcLen <= cur.arcLen + 1e-9) {
      return t + Math.max(0, arcLen - prev.arcLen) / vAvg
    }
    t += (cur.arcLen - prev.arcLen) / vAvg
  }
  return Infinity // 経路の終端より先＝到達しない
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
