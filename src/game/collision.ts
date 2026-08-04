// 軌道（飛行サンプル）と敵・障害物（円ヒットボックス）の当たり判定（機能7・11）。
// 回転/極座標いずれの飛行サンプルでも一貫して動く。純粋関数。
import type { FlightSample, Vec2 } from './types'
import { dist } from './coords'
import { strengthOf } from './attribute'
import { COMBAT, FIELD } from '../data/constants'

/**
 * 威力（速度×強度）を 0..1 へ正規化した割合（#21/#72）。
 * **描画の大きさ（draw.powerSizeFrac）と当たり半径（bulletRadius）が共有する唯一の定義**。
 */
export function powerFraction(speed: number, z: number): number {
  const p = strengthOf(z) * Math.max(0, speed)
  return Math.min(1, p / (FIELD.sMax * FIELD.maxFlightSpeed))
}

/**
 * 弾の当たり半径（ユニット・#72）。威力に比例して bulletRadiusMin〜bulletRadiusMax。
 * **画面に描かれる弾のコア半径と同じ値**（draw.drawBullet が この値 × scaleOf(vp) で描く）。
 * 2弾の衝突は中心間距離 ≤ rA+rB、結界との接触は ≤ r+orbitBandHalf で判定する。
 */
export function bulletRadius(speed: number, z: number): number {
  const { bulletRadiusMin: lo, bulletRadiusMax: hi } = COMBAT
  return lo + (hi - lo) * powerFraction(speed, z)
}

/** 線分 a→b と中心 c・半径 r の円が最初に交わる媒介変数 t∈[0,1]。交わらなければ null。 */
export function segmentCircleHit(a: Vec2, b: Vec2, c: Vec2, r: number): number | null {
  const fx = a.x - c.x
  const fy = a.y - c.y
  const cc = fx * fx + fy * fy - r * r
  if (cc <= 0) return 0 // 始点がすでに円内
  const dx = b.x - a.x
  const dy = b.y - a.y
  const aa = dx * dx + dy * dy
  if (aa === 0) return null
  const bb = 2 * (fx * dx + fy * dy)
  const disc = bb * bb - 4 * aa * cc
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const t1 = (-bb - sq) / (2 * aa)
  if (t1 >= 0 && t1 <= 1) return t1
  const t2 = (-bb + sq) / (2 * aa)
  if (t2 >= 0 && t2 <= 1) return t2
  return null
}

/** 命中情報 */
export interface Hit {
  pos: Vec2
  speed: number
  arcLen: number
  /** 命中点の軌道パラメータ（z=関数値の評価に使う） */
  param: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 飛行サンプル列が円ヒットボックスに最初に触れる点（速度・弧長・パラメータを補間）。 */
export function firstHit(samples: FlightSample[], center: Vec2, radius: number): Hit | null {
  if (samples.length === 0) return null
  if (samples.length === 1) {
    return dist(samples[0].pos, center) <= radius
      ? {
          pos: samples[0].pos,
          speed: samples[0].speed,
          arcLen: samples[0].arcLen,
          param: samples[0].param,
        }
      : null
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    const t = segmentCircleHit(a.pos, b.pos, center, radius)
    if (t !== null) {
      return {
        pos: { x: lerp(a.pos.x, b.pos.x, t), y: lerp(a.pos.y, b.pos.y, t) },
        speed: lerp(a.speed, b.speed, t),
        arcLen: lerp(a.arcLen, b.arcLen, t),
        param: lerp(a.param, b.param, t),
      }
    }
  }
  return null
}

/** 当たり判定の対象（円ヒットボックス） */
export interface Target {
  id: string
  pos: Vec2
  radius: number
}

/** 命中した対象（最も手前のもの） */
export interface TargetHit extends Hit {
  id: string
}

/** 複数対象のうち、最も手前（弧長が小さい）で当たるものを返す。 */
export function firstHitAmong(samples: FlightSample[], targets: Target[]): TargetHit | null {
  let best: TargetHit | null = null
  for (const tg of targets) {
    const h = firstHit(samples, tg.pos, tg.radius)
    if (h && (best === null || h.arcLen < best.arcLen)) {
      best = { ...h, id: tg.id }
    }
  }
  return best
}

/**
 * 魔法が通過する全対象への命中を弧長順に返す（貫通・多段ヒット）。
 * 命中しても魔法は減速せず消えないため、パスが触れた対象すべてに命中する
 * （対象ごとに最初の接触点1回）。速度0で消えた弾はサンプル列がそこで終わるため当たらない。
 */
export function allHitsAmong(samples: FlightSample[], targets: Target[]): TargetHit[] {
  const hits: TargetHit[] = []
  for (const tg of targets) {
    const h = firstHit(samples, tg.pos, tg.radius)
    if (h) hits.push({ ...h, id: tg.id })
  }
  return hits.sort((a, b) => a.arcLen - b.arcLen)
}
