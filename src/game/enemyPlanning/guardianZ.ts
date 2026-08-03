// 守護型（guardian）の結界の **z 場（属性の高さ）** 最適化（#71・05b §5.4）。純粋関数。
// 結界の迎撃威力は「横断点の強度 |z| × その点のリング速度」（#60）で決まる。|z| を上げると強度は
// 増えるが |z|>zRef では減速して失速＝霧散する（#31）。つまり z 場は
//   「脅威方向で強く、他の方位では |z| を薄くして加速し、一周を通じて失速しない」
// という配分問題になる。ここでは LVL 段階ごとに候補の式（一様→余弦→多重余弦→exp×余弦）を作り、
// **本番と同じ物理（simulateFlight / attachRingSpeeds）** で採点して最良のものを選ぶ。
import type { Trajectory, ZField } from '../types'
import { attachRingSpeeds, buildRing, type RingPoint } from '../orbit'
import { simulateFlight } from '../physics'
import { strengthOf } from '../attribute'
import { constZField } from '../zfields'
import { ENEMY_GUARD_PLANNING as GP, FIELD } from '../../data/constants'
import type { GuardTier } from './guardianTier'

/** z 場の候補（label は挙動の説明・デバッグ用）。 */
export interface GuardZCandidate {
  z: ZField
  label: string
}

/**
 * 脅威方向 φ_threat へ強度を寄せる角度プロファイル群（振幅1・|値|≤1）。
 * - 一様：1（全周同じ＝従来動作）
 * - 余弦：cos(φ−φt)（#47 の方向づけられた場）
 * - 多重余弦：Σ_{k=1..M} cos(k(φ−φt))/k を Σ1/k で正規化（sin/cos の重ね合わせ＝強い敵）
 * - exp×余弦：exp(κ(cos(φ−φt)−1))（脅威方向に鋭く尖った包絡＝最上位。exp と cos の積）
 */
function angularShapes(threatPhi: number | null, tier: GuardTier): { f: (phi: number) => number; label: string }[] {
  const out: { f: (phi: number) => number; label: string }[] = [{ f: () => 1, label: '一様' }]
  if (threatPhi === null) return out
  out.push({ f: (phi) => Math.cos(phi - threatPhi), label: '余弦' })
  if (tier.zHarmonics >= 2) {
    const m = tier.zHarmonics
    let norm = 0
    for (let k = 1; k <= m; k++) norm += 1 / k
    out.push({
      f: (phi) => {
        let s = 0
        for (let k = 1; k <= m; k++) s += Math.cos(k * (phi - threatPhi)) / k
        return s / norm
      },
      label: `多重余弦${m}項`,
    })
  }
  if (tier.zSharp > 0) {
    out.push({
      f: (phi) => Math.exp(tier.zSharp * (Math.cos(phi - threatPhi) - 1)),
      label: `exp×余弦(κ=${tier.zSharp})`,
    })
  }
  return out
}

/**
 * z 場の候補を作る（振幅 × 角度プロファイル）。
 * 振幅は基本 zRef（|z|≤zRef＝全周で失速しない安全側・従来動作）。最上位（zOverdrive>1）だけ
 * zRef を超える振幅も試せる＝強度は上がるが減速するので、採点（本番物理）を通ったものだけ残る。
 */
export function guardZCandidates(
  sign: 1 | -1,
  threatPhi: number | null,
  tier: GuardTier,
): GuardZCandidate[] {
  const amps: number[] = [FIELD.zRef]
  if (tier.zOverdrive > 1) amps.push(Math.min(FIELD.zPeak, FIELD.zRef * tier.zOverdrive))
  const out: GuardZCandidate[] = []
  for (const shape of angularShapes(threatPhi, tier)) {
    for (const amp of amps) {
      // 一様場を過励起（|z|>zRef）すると全周で減速して必ず自滅するので、振幅を上げるのは
      // 「他の方位で |z| を薄められる」非一様プロファイルだけにする
      if (amp > FIELD.zRef && shape.label === '一様') continue
      // z 場は術者位置 origin を原点として評価される（#52）＝(x,y) は origin 相対
      out.push({
        z: (x, y) => sign * amp * shape.f(Math.atan2(y, x)),
        label: `${shape.label}×${amp.toFixed(2)}`,
      })
    }
  }
  return out
}

/** 採点済みの結界（リングは本番と同じ点ごと速度つき）。 */
export interface GuardZChoice {
  z: ZField
  ring: RingPoint[]
  /** 脅威方向の扇で最も弱い迎撃威力（強度×速度）＝この結界の「抜かれにくさ」 */
  power: number
  label: string
}

/** 脅威方向の扇（±threatWedge）での最小迎撃威力。脅威が見えないときは全周平均。 */
function interceptPower(ring: RingPoint[], origin: { x: number; y: number }, threatPhi: number | null): number {
  let min = Infinity
  let sum = 0
  let cnt = 0
  for (const rp of ring) {
    const p = strengthOf(rp.z) * (rp.speed ?? 0)
    sum += p
    cnt++
    if (threatPhi === null) continue
    const phi = Math.atan2(rp.pos.y - origin.y, rp.pos.x - origin.x)
    const d = Math.abs(phi - threatPhi) % (Math.PI * 2)
    const gap = d > Math.PI ? Math.PI * 2 - d : d
    if (gap <= GP.threatWedge && p < min) min = p
  }
  if (cnt === 0) return 0
  return threatPhi === null || min === Infinity ? sum / cnt : min
}

/**
 * 外形 f(θ) が決まった結界に対し、最良の z 場を選ぶ（#71）。
 * 候補は本番と同じ物理で回し、**失速して霧散する場（速度0の点がある／end='vanished'）は捨てる**。
 * 残った中から脅威方向の最小迎撃威力が最大のものを選ぶ。
 */
export function pickGuardZ(
  f: (theta: number) => number,
  origin: { x: number; y: number },
  initialSpeed: number,
  candidates: GuardZCandidate[],
  threatPhi: number | null,
  fieldR?: number,
): GuardZChoice | null {
  let best: GuardZChoice | null = null
  for (const c of candidates) {
    const traj: Trajectory = { mode: 'polar', f, origin, z: c.z, fieldR }
    // 本番の霧散判定（turn.ts）と同じ：強すぎる場で速度0まで落ちる結界は張らない
    if (simulateFlight(traj, initialSpeed).end === 'vanished') continue
    const ring = attachRingSpeeds(buildRing(traj), initialSpeed)
    if (ring.length < 3 || ring.some((rp) => (rp.speed ?? 0) <= 0)) continue
    const power = interceptPower(ring, origin, threatPhi)
    if (!best || power > best.power) best = { z: c.z, ring, power, label: c.label }
  }
  return best
}

/** 候補が全滅したときの安全な既定（一様 sign·zRef＝加速度0で決して失速しない）。 */
export function uniformGuardZ(sign: 1 | -1): ZField {
  return constZField(sign * FIELD.zRef)
}
