// パリィ（クラッシュ解決・§3.8・機能12）：同極/中立はすり抜け、反対極のみ相殺。
// 互いの威力を引き算し、大きい方だけが残った威力を速度として引き継ぐ（必ず片方は消滅）。純粋関数。
import type { Attribute, FlightSample, Vec2 } from './types'
import { flightTimes } from './physics'
import { FIELD } from '../data/constants'

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}
function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}
function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

/**
 * 平行だが同一直線上で重なる線分の交点（重なり区間の中点）を返す（バグ修正：正面撃ち返し）。
 * 逆向き collinear（弾どうしが同じ直線を逆走して正面衝突する）でも交差を拾えるようにする。
 * t は線分 p1p2 上、u は線分 p3p4 上の媒介変数。重ならなければ null。
 */
function collinearOverlap(
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  p4: Vec2,
): { point: Vec2; t: number; u: number } | null {
  const r = sub(p2, p1)
  const len2 = dot(r, r)
  if (len2 === 0) return null // 退化した線分（点）は扱わない
  // p1 を原点、r を基底に p3・p4 を射影したスカラー（p1=0, p2=1 のスケール）
  const t3 = dot(sub(p3, p1), r) / len2
  const t4 = dot(sub(p4, p1), r) / len2
  const lo = Math.max(0, Math.min(t3, t4))
  const hi = Math.min(1, Math.max(t3, t4))
  if (lo > hi) return null // 直線は同じでも区間が重ならない
  const t = (lo + hi) / 2 // 重なり区間の中点（p1p2 側の媒介変数）
  const point = { x: p1.x + r.x * t, y: p1.y + r.y * t }
  // u（p3p4 側の媒介変数）を交点から逆算する
  const s = sub(p4, p3)
  const s2 = dot(s, s)
  const u = s2 === 0 ? 0 : dot(sub(point, p3), s) / s2
  return { point, t, u }
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
  const qp = sub(p3, p1)
  if (denom === 0) {
    // 平行：同一直線上（collinear）で区間が重なるなら重なり中点を交点とする（正面撃ち返し対応）。
    // それ以外の平行（離れた並走）は交差なし。
    if (cross(qp, r) !== 0) return null // 同一直線でない平行＝交わらない
    return collinearOverlap(p1, p2, p3, p4)
  }
  const t = cross(qp, s) / denom
  const u = cross(qp, r) / denom
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { point: { x: p1.x + r.x * t, y: p1.y + r.y * t }, t, u }
  }
  return null
}

/** パス上で最も target に近いサンプルの添字（>=1 を返す。時刻/弧長参照に使う）。 */
function nearestIndex(path: Vec2[], target: Vec2): number {
  let best = 1
  let bestD = Infinity
  for (let i = 1; i < path.length; i++) {
    const d = (path[i].x - target.x) ** 2 + (path[i].y - target.y) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * 2パスが同一直線上を重なって走る（正面撃ち返し）場合の合流点を、
 * 「両パスの重なり区間の中点」として返す（バグ修正）。per-segment の firstCrossing だと
 * 端の微小セグメントを拾ってしまい、時刻判定で弾かれるため、全体の重なり中点で合流させる。
 */
function collinearPathMeeting(
  pathA: Vec2[],
  pathB: Vec2[],
): { pos: Vec2; indexA: number; indexB: number } | null {
  if (pathA.length < 2 || pathB.length < 2) return null
  const a0 = pathA[0]
  const a1 = pathA[pathA.length - 1]
  const r = sub(a1, a0)
  const len2 = dot(r, r)
  if (len2 === 0) return null
  const b0 = pathB[0]
  const b1 = pathB[pathB.length - 1]
  // A の直線に B の両端が乗っているか（同一直線判定）
  if (Math.abs(cross(sub(b0, a0), r)) > 1e-6 || Math.abs(cross(sub(b1, a0), r)) > 1e-6) return null
  // A を [0,1] スケールに、B の両端を射影して重なり区間を求める
  const tb0 = dot(sub(b0, a0), r) / len2
  const tb1 = dot(sub(b1, a0), r) / len2
  const lo = Math.max(0, Math.min(tb0, tb1))
  const hi = Math.min(1, Math.max(tb0, tb1))
  if (lo > hi) return null // 同一直線でも区間が離れていて重ならない
  const t = (lo + hi) / 2
  const pos = { x: a0.x + r.x * t, y: a0.y + r.y * t }
  return { pos, indexA: nearestIndex(pathA, pos), indexB: nearestIndex(pathB, pos) }
}

/** 2つのパスが最初に交差する点（プレイヤーパス上で最も手前）。 */
export function firstCrossing(
  pathA: Vec2[],
  pathB: Vec2[],
): { pos: Vec2; indexA: number; indexB: number } | null {
  for (let i = 1; i < pathA.length; i++) {
    for (let j = 1; j < pathB.length; j++) {
      const hit = segmentIntersect(pathA[i - 1], pathA[i], pathB[j - 1], pathB[j])
      if (hit) {
        // collinear-overlap（denom===0 で拾った端の微小セグメント）は、全体の重なり中点へ補正して
        // 正面衝突の合流点を返す（横断交差はそのまま最初の交点を返す）。
        const meet = collinearPathMeeting(pathA, pathB)
        if (meet) return meet
        return { pos: hit.point, indexA: i, indexB: j }
      }
    }
  }
  return null
}

/** 時刻 τ における弾の状態（位置・弧長・速度）。 */
export interface BulletStateAtTime {
  pos: Vec2
  arcLen: number
  speed: number
}

/** 時刻 τ における弾の状態（times は flightTimes の累積）。idxRef は前回位置から前進走査。 */
export function posAtTime(
  samples: readonly FlightSample[],
  times: readonly number[],
  tau: number,
  idxRef: { i: number },
): BulletStateAtTime {
  let i = idxRef.i
  while (i < times.length - 1 && times[i + 1] <= tau) i++
  idxRef.i = i
  const a = samples[i]
  if (i >= times.length - 1 || !Number.isFinite(times[i + 1]))
    return { pos: a.pos, arcLen: a.arcLen, speed: a.speed }
  const b = samples[i + 1]
  const span = times[i + 1] - times[i]
  const f = span > 0 ? (tau - times[i]) / span : 0
  return {
    pos: { x: a.pos.x + (b.pos.x - a.pos.x) * f, y: a.pos.y + (b.pos.y - a.pos.y) * f },
    arcLen: a.arcLen + (b.arcLen - a.arcLen) * f,
    speed: a.speed + (b.speed - a.speed) * f,
  }
}

/** サンプル列の「到達できる最後の時刻」（失速の先は Infinity なので、その手前を返す）。 */
export function lastFiniteTime(times: readonly number[]): number {
  for (let i = times.length - 1; i >= 0; i--) if (Number.isFinite(times[i])) return times[i]
  return 0
}

/** 位置ごとの弾の半径を返す関数（威力で変わる・collision.bulletRadius を通す）。 */
export type RadiusAt = (pos: Vec2, speed: number) => number

/** 2弾の実衝突の結果（衝突時刻つき・#72） */
export interface BulletCollision {
  pos: Vec2
  arcA: number
  arcB: number
  /** 衝突したゲーム時刻（ターン開始＝0） */
  time: number
}

/**
 * 2弾の「実衝突」：同じゲーム時刻に**互いの半径の和**まで近づく最初の点（#64/#72）。
 * 旧方式（幾何交差 firstCrossing＋通過時刻ゲート）は、最初の幾何交点の通過時刻が
 * 大きくズレる正面撃ち返し・浅い交差で、実際にぶつかる2弾を不成立にしていた。
 * 両弾を FIELD.dt 刻みで同時に進めて初めて触れた点を衝突とする：すれ違い（時刻差あり）は
 * 自然に不成立、撃ち返し（同一直線の逆走）は途中の合流点で必ず成立する。
 * 衝突距離は描画される弾の半径（collision.bulletRadius）と一致する（#72）。
 */
export function bulletCollision(
  samplesA: FlightSample[],
  samplesB: FlightSample[],
  radiusA: RadiusAt,
  radiusB: RadiusAt,
): BulletCollision | null {
  if (samplesA.length < 2 || samplesB.length < 2) return null
  const tA = flightTimes(samplesA)
  const tB = flightTimes(samplesB)
  // どちらかが消えた（終端に達した／失速した）後は衝突しない
  const tEnd = Math.min(lastFiniteTime(tA), lastFiniteTime(tB))
  const ia = { i: 0 }
  const ib = { i: 0 }
  for (let tau = 0; tau <= tEnd + 1e-9; tau += FIELD.dt) {
    const pa = posAtTime(samplesA, tA, tau, ia)
    const pb = posAtTime(samplesB, tB, tau, ib)
    const dx = pa.pos.x - pb.pos.x
    const dy = pa.pos.y - pb.pos.y
    const reach = radiusA(pa.pos, pa.speed) + radiusB(pb.pos, pb.speed)
    if (dx * dx + dy * dy <= reach * reach) {
      return {
        pos: { x: (pa.pos.x + pb.pos.x) / 2, y: (pa.pos.y + pb.pos.y) / 2 },
        arcA: pa.arcLen,
        arcB: pb.arcLen,
        time: tau,
      }
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
 * 交差した2弾の属性・速度・威力からパリィを解決する（結界の迎撃・相殺も同じ計算）。
 * - 同極（光×光/闇×闇）または一方が中立 → すり抜け（速度そのまま継続）
 * - 反対極（光×闇） → 互いの威力を引き算し、威力が大きかった側だけが
 *   残った威力（powerWin − powerLose）を引き継いで継続する。威力＝速度×強度で
 *   強度は位置で決まるため、残威力は速度の縮小（speed × 残威力/元威力）として反映する。
 * - パリィが発生したら必ずどちらかは消滅する（同威力なら両方＝完全相殺）。
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
  if (powerA > powerB) {
    const newA = Math.max(0, speedA * ((powerA - powerB) / powerA))
    return { passthrough: false, speedA: newA, speedB: 0, vanishA: newA <= 0, vanishB: true }
  }
  if (powerB > powerA) {
    const newB = Math.max(0, speedB * ((powerB - powerA) / powerB))
    return { passthrough: false, speedA: 0, speedB: newB, vanishA: true, vanishB: newB <= 0 }
  }
  // 同威力（両方0を含む）＝完全相殺で両方消滅
  return { passthrough: false, speedA: 0, speedB: 0, vanishA: true, vanishB: true }
}
