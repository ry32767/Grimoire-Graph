// 軌道型（ループ）魔法：周回リングによる掃射（攻撃）と迎撃（防御・#4）。純粋関数。
// リングは閉じた点列＋各点の z（属性）。攻撃＝リングに触れた敵へダメージ、防御＝敵弾がリング境界を横切れば迎撃。
import type { Attribute, FlightSample, Obstacle, Trajectory, Vec2 } from './types'
import { COMBAT, FIELD, SAMPLING } from '../data/constants'
import { sampleTrajectory, validFinitePrefix, dist } from './coords'
import { zfieldAt, attributeOf, strengthOf, computeDamage } from './attribute'
import { isSolidAt } from './obstacle'
import { firstCrossing, lastFiniteTime, posAtTime, type RadiusAt } from './parry'
import { flightTimes, simulatePath } from './physics'

/** リング上の1点（位置＋属性 z＋その点でのリング速度・#60） */
export interface RingPoint {
  pos: Vec2
  z: number
  /** その点を通過する時のリング速度（#60：平均でなく点ごと。未計算/未付与は undefined→0 扱い） */
  speed?: number
}

/**
 * ループ軌道からリング（有限点列＋各点の z）を作る。場外でも切らない＝結界は一周する（#22/#25）。
 * θ は 1周分（≤2π）に制限する：閉曲線は1周で形が完結し、2周分だと周回演出が倍速・粒子が重複するため（#22 演出修正）。
 * speed は 0（幾何のみ）。実速度は attachRingSpeeds で付与する（#60）。
 */
export function buildRing(traj: Trajectory): RingPoint[] {
  return validFinitePrefix(sampleTrajectory(traj))
    .filter((s) => s.param <= 2 * Math.PI + 1e-6)
    .map((s) => ({ pos: s.pos, z: zfieldAt(traj, s.pos), speed: 0 }))
}

/**
 * リングの各点に「その点でのリング速度」を付与する（#60）。初速からリング経路を物理シミュレート
 * （場の加速度で加減速）した各点の速度を使う＝平均ではなく点ごとの速度。速度0まで失速した点以降は0。
 */
export function attachRingSpeeds(ring: RingPoint[], initialSpeed: number): RingPoint[] {
  if (ring.length === 0) return ring
  const flight = simulatePath(ring.map((p) => p.pos), initialSpeed, (i) => ring[Math.min(i, ring.length - 1)].z)
  return ring.map((p, i) => ({ ...p, speed: flight.samples[i]?.speed ?? 0 }))
}

/** リング全体の速度を factor 倍に減速する（#60：迎撃で失速。0で全停止＝霧散）。 */
export function scaleRingSpeeds(ring: RingPoint[], factor: number): RingPoint[] {
  const f = Math.max(0, factor)
  return ring.map((p) => ({ ...p, speed: (p.speed ?? 0) * f }))
}

/**
 * 点 p がリング（閉じた点列）の内側にあるか（#35：囲み判定）。
 * レイキャスティング（右向き半直線との交差数が奇数なら内側）。
 */
export function ringEncloses(ring: RingPoint[], p: Vec2): boolean {
  if (ring.length < 3) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i].pos
    const b = ring[j].pos
    const intersect =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

/** リングの代表属性と強度（|z| が最大の点で代表する）。掃射の代表属性などに使う（#35）。 */
export function ringDominant(ring: RingPoint[]): { attr: Attribute; strength: number } {
  let best: { attr: Attribute; strength: number } = { attr: 'neutral', strength: 0 }
  for (const rp of ring) {
    const s = strengthOf(rp.z)
    if (s > best.strength) best = { attr: attributeOf(rp.z), strength: s }
  }
  return best
}

/**
 * リングの平均属性（#39）：軌道上の符号付き強度（光=+, 闇=−）の平均で属性を決める。
 * 効果（回復・隠蔽）は強度の大小を見ない＝属性（符号）だけが意味を持つ。
 * 中立の判定は attributeOf と同じ ε（FIELD.epsilon）を平均値に適用する（意図的な共有しきい値）。
 */
export function ringAverageAttr(ring: RingPoint[]): Attribute {
  if (ring.length === 0) return 'neutral'
  let sum = 0
  for (const rp of ring) {
    const sign = rp.z > 0 ? 1 : rp.z < 0 ? -1 : 0
    sum += sign * strengthOf(rp.z)
  }
  return attributeOf(sum / ring.length)
}

/** リングの重心（内外判定・入れ子の半径比較に使う・#39）。 */
export function ringCentroid(ring: RingPoint[]): Vec2 {
  let cx = 0
  let cy = 0
  for (const rp of ring) {
    cx += rp.pos.x
    cy += rp.pos.y
  }
  const n = ring.length || 1
  return { x: cx / n, y: cy / n }
}

/** リングの代表半径（重心からの平均距離）。隠蔽 RMSE と入れ子の内外（小さいほど内側）に使う（#39）。 */
export function ringRadius(ring: RingPoint[]): number {
  if (ring.length === 0) return 0
  const c = ringCentroid(ring)
  let sum = 0
  for (const rp of ring) sum += dist(rp.pos, c)
  return sum / ring.length
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
 * リングが触れる対象へのダメージ＝**触れた点のリング速度** × 強度(|z|) × 相性（#60）。
 * 平均速度ではなく、対象に最も近いリング点の速度を使う。thickness は当たり厚み（ユニット）。
 */
export function orbitSweep(
  ring: RingPoint[],
  targets: OrbitTarget[],
  thickness = COMBAT.orbitSweepReach,
): OrbitHit[] {
  const hits: OrbitHit[] = []
  if (ring.length === 0) return hits
  for (const t of targets) {
    const n = nearest(ring, t.pos)
    if (n.d <= t.radius + thickness) {
      // ダメージ式は発射魔法と完全に共有する（computeDamage）。速度だけがリング点の速度になる
      const d = computeDamage(ring[n.idx].speed ?? 0, ring[n.idx].z, t.element)
      if (d.damage > 0) hits.push({ id: t.id, damage: d.damage, attr: d.attackAttr, strength: d.strength })
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
  /** 横断点でのリング速度（#60：平均でなくその点の速度で相殺する） */
  ringSpeed?: number
  /** 敵弾パス上の横断 index */
  enemyIndex?: number
}

/** 周回軌道が壁（障害物の素材）に触れて削れた1点（#34：少しだけ削って散る）。 */
export interface OrbitWallHit {
  /** えぐった点（数学座標） */
  pos: Vec2
  /** えぐり半径（発射型よりずっと小さい） */
  r: number
  /** リング属性（散る火花の色） */
  attr: Attribute
  /** 削られた障害物ID */
  obstacleId: string
}

/**
 * 周回軌道が壁（障害物の素材）に触れるか判定する（#34）。
 * 触れていれば壁を「少しだけ」削り、散り際の点（OrbitWallHit）を返す。触れていなければ null。
 * 触れた周回は**丸ごと霧散して消える**（呼び出し側が掃射/防御/オーラを無効化し、霧散演出に切り替える）。
 * 障害物の carves は in place で更新（呼び出し側が複製済み）。
 */
export function orbitWallBreak(ring: RingPoint[], obstacles: Obstacle[]): OrbitWallHit | null {
  if (ring.length === 0 || obstacles.length === 0) return null
  for (let i = 0; i < ring.length; i++) {
    for (const ob of obstacles) {
      if (!isSolidAt(ob, ring[i].pos)) continue
      const r = COMBAT.orbitWallCarveRadius
      ob.carves.push({ x: ring[i].pos.x, y: ring[i].pos.y, r })
      return { pos: ring[i].pos, r, attr: attributeOf(ring[i].z), obstacleId: ob.id }
    }
  }
  return null
}

/**
 * 敵弾パスがリング境界を最初に横切る点を返す（横切らなければ crossed=false）。
 * **幾何のみ**（時刻を見ない）。経路が結界を突っ切るかどうかの粗い判定にだけ使う
 * （敵AIの候補の絞り込み・プレビュー表示）。本番の迎撃・相殺は ringContact（時間刻み）で解く。
 */
export function ringInterception(ring: RingPoint[], enemyPath: Vec2[]): RingInterception {
  if (ring.length < 2) return { crossed: false }
  const ringPath = ring.map((r) => r.pos)
  const cross = firstCrossing(enemyPath, ringPath)
  if (!cross) return { crossed: false }
  const rp = ring[Math.min(cross.indexB, ring.length - 1)]
  return { crossed: true, pos: cross.pos, ringZ: rp.z, ringSpeed: rp.speed, enemyIndex: cross.indexA }
}

/**
 * リングの走査用インデックス（外接矩形＋粗いふるい）。リング配列ごとに1回だけ作って使い回す。
 * 敵AIは同じ結界に対して何百通りもの候補軌道を検証するため、ここを作り直すと重い。
 */
interface RingIndex {
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** 粗い走査の間引き幅 */
  stride: number
  /** 間引き点と実点の最大ズレ（粗い最小距離からこの分だけ甘く見る） */
  slack: number
}
const ringIndexCache = new WeakMap<RingPoint[], RingIndex>()

function ringIndexOf(ring: RingPoint[]): RingIndex {
  const cached = ringIndexCache.get(ring)
  if (cached) return cached
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const rp of ring) {
    if (rp.pos.x < minX) minX = rp.pos.x
    if (rp.pos.x > maxX) maxX = rp.pos.x
    if (rp.pos.y < minY) minY = rp.pos.y
    if (rp.pos.y > maxY) maxY = rp.pos.y
  }
  const stride = Math.max(1, Math.floor(ring.length / 48))
  let slack = 0
  if (stride > 1) {
    for (let i = 0; i < ring.length; i++) {
      const anchor = ring[i - (i % stride)]
      const d = Math.hypot(ring[i].pos.x - anchor.pos.x, ring[i].pos.y - anchor.pos.y)
      if (d > slack) slack = d
    }
  }
  const idx: RingIndex = { minX, maxX, minY, maxY, stride, slack }
  ringIndexCache.set(ring, idx)
  return idx
}

/** 弾が結界の帯に触れた1点（時刻つき・#72） */
export interface RingContact {
  /** 接触点（弾とリング点の中点） */
  pos: Vec2
  /** 接触したリング点の z（迎撃の相性判定に使う） */
  ringZ: number
  /** 接触点でのリング速度（#60：平均でなくその点の速度で相殺する） */
  ringSpeed: number
  /** 弾側の弧長（減衰イベントを置く位置） */
  arcLen: number
  /** 弾側の速度（相殺の威力に使う） */
  speed: number
  /** 接触したゲーム時刻（ターン開始＝0）。イベントの時系列順の解決と演出の同期に使う */
  time: number
}

/**
 * 弾が結界（リング）の帯に触れる最初の**時刻**を求める（#72）。
 * 幾何交差（ringInterception）と違い、弾を FIELD.dt 刻みで進めて
 * 「弾の半径＋帯の半厚み」以内へ入った瞬間を接触とする。これにより
 *   - 迎撃・相殺・霧散をパリィや障害物と**同じ時間軸で並べられる**（因果の逆転が起きない）
 *   - 判定の当たりが画面に描かれる弾の大きさ・帯の太さと一致する
 * リングは静止した閉曲線なので、動くのは弾だけ（リング点の speed は威力にのみ効く）。
 */
export function ringContact(
  ring: RingPoint[],
  samples: FlightSample[],
  radiusAt: RadiusAt,
  bandHalf: number = COMBAT.orbitBandHalf,
): RingContact | null {
  if (ring.length < 3 || samples.length < 2) return null
  const times = flightTimes(samples)
  const tEnd = lastFiniteTime(times)
  const b = ringIndexOf(ring)
  const idx = { i: 0 }
  let scanned: Vec2 | null = null
  // 失速しかけた弾は tEnd が極端に伸びる。空回りしないよう歩数に安全弁を置く（判定は位置で決まる）
  for (let tau = 0, step = 0; tau <= tEnd + 1e-9 && step < SAMPLING.maxFrames; tau += FIELD.dt, step++) {
    const st = posAtTime(samples, times, tau, idx)
    const reach = radiusAt(st.pos, st.speed) + bandHalf
    // 外接矩形の外なら距離計算を省く（リング点は数百あるので効く）
    if (
      st.pos.x < b.minX - reach ||
      st.pos.x > b.maxX + reach ||
      st.pos.y < b.minY - reach ||
      st.pos.y > b.maxY + reach
    )
      continue
    // 前回走査した位置からほとんど動いていなければ、同じ判定を繰り返さない
    if (scanned && Math.hypot(st.pos.x - scanned.x, st.pos.y - scanned.y) < reach * 0.2) continue
    scanned = st.pos
    const reach2 = reach * reach
    // 粗いふるい：stride 間隔だけ見て、slack を足しても届かないなら全走査しない
    if (b.stride > 1) {
      let coarse = Infinity
      for (let i = 0; i < ring.length; i += b.stride) {
        const dx = ring[i].pos.x - st.pos.x
        const dy = ring[i].pos.y - st.pos.y
        const d2 = dx * dx + dy * dy
        if (d2 < coarse) coarse = d2
      }
      if (Math.sqrt(coarse) - b.slack > reach) continue
    }
    let best = -1
    let bestD2 = Infinity
    for (let i = 0; i < ring.length; i++) {
      const dx = ring[i].pos.x - st.pos.x
      const dy = ring[i].pos.y - st.pos.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        best = i
      }
    }
    if (best >= 0 && bestD2 <= reach2) {
      const rp = ring[best]
      return {
        pos: { x: (st.pos.x + rp.pos.x) / 2, y: (st.pos.y + rp.pos.y) / 2 },
        ringZ: rp.z,
        ringSpeed: rp.speed ?? 0,
        arcLen: st.arcLen,
        speed: st.speed,
        time: tau,
      }
    }
  }
  return null
}
