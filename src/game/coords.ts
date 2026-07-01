// 座標変換と軌道の幾何展開。描画・当たり判定・物理・暴発で共有する唯一の変換層（§3.1）。
import type { Vec2, Trajectory, ZField } from './types'
import { FIELD, SAMPLING } from '../data/constants'

/** z 場が「極（発散）」とみなす符号反転時の最小 |z|（強度が 0 になる 2·zPeak 以上）。 */
const POLE_Z = 2 * FIELD.zPeak

// ===== Canvas ⇔ 数学座標 =====

/** 描画ビューポート。数学原点 O=(0,0) は画面中央に対応する。 */
export interface Viewport {
  width: number // canvas ピクセル幅
  height: number // canvas ピクセル高さ
  /** 画面短辺の半分に対応する数学ユニット数（既定は R_field） */
  unitsRadius: number
}

/** 1 ユニットあたりのピクセル数 */
export function scaleOf(vp: Viewport): number {
  return Math.min(vp.width, vp.height) / 2 / vp.unitsRadius
}

/** 数学座標 → Canvas ピクセル（y は上下反転） */
export function toScreen(p: Vec2, vp: Viewport): Vec2 {
  const s = scaleOf(vp)
  return { x: vp.width / 2 + p.x * s, y: vp.height / 2 - p.y * s }
}

/** Canvas ピクセル → 数学座標 */
export function toMath(px: Vec2, vp: Viewport): Vec2 {
  const s = scaleOf(vp)
  return { x: (px.x - vp.width / 2) / s, y: (vp.height / 2 - px.y) / s }
}

/**
 * 画面に実際に映る数学座標の範囲（四隅を逆変換）。
 * グリッドや z 場の描画範囲をこの範囲から決めることで、ステージのスケール
 * （unitsRadius）やアスペクト比を変えても方眼が画面全体を覆い、崩れない（#53）。
 */
export function visibleBounds(vp: Viewport): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  const tl = toMath({ x: 0, y: 0 }, vp)
  const br = toMath({ x: vp.width, y: vp.height }, vp)
  return {
    minX: Math.min(tl.x, br.x),
    maxX: Math.max(tl.x, br.x),
    minY: Math.min(tl.y, br.y),
    maxY: Math.max(tl.y, br.y),
  }
}

// ===== 幾何ユーティリティ =====

/** 原点まわりに angle[rad] 回転 */
export function rotate(p: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** 原点からの距離 */
export function dist(a: Vec2, b: Vec2 = { x: 0, y: 0 }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// ===== 軌道サンプリング =====

/** 軌道上の1サンプル */
export interface Sample {
  /** 軌道パラメータ（回転=x / 極座標=θ） */
  param: number
  /** 数学座標の位置 */
  pos: Vec2
  /** g/f が有限な実数か（NaN/±∞/非実数でない） */
  valid: boolean
  /** 場内（|pos| ≤ R_field）か */
  inField: boolean
}

/**
 * z 場（属性関数）が経路上で「エラー（暴発）」になる点を検出して、その手前までで打ち切る（#30）。
 * 軌道関数のエラーと同様に扱う：z が非有限（NaN/±∞＝sqrt(-1)・log(-1)・1/0 など）の点、
 * または隣り合うサンプルで符号が反転しつつ両側の |z| が大きい点（=極を跨いだ＝1/x 型の発散）を
 * 無効点としてマークする。以後 validPrefix / pathTermination が暴発点として扱う。
 */
function applyZValidity(samples: Sample[], zf?: ZField): void {
  if (!zf) return
  let prevZ: number | null = null
  for (const s of samples) {
    if (!s.valid) {
      prevZ = null
      continue
    }
    const z = zf(s.pos.x, s.pos.y) // z 場はステージ中央(0,0)を原点に評価する（#58）
    const finite = Number.isFinite(z)
    const pole =
      finite &&
      prevZ !== null &&
      Math.sign(z) !== Math.sign(prevZ) &&
      Math.min(Math.abs(z), Math.abs(prevZ)) > POLE_Z
    if (!finite || pole) {
      s.valid = false
      s.inField = false
      prevZ = null
      continue
    }
    prevZ = z
  }
}

/** 軌道を原点側から外側へサンプリングする（無効点・場外点も含めて返す）。 */
export function sampleTrajectory(traj: Trajectory): Sample[] {
  const out: Sample[] = []
  if (traj.mode === 'rotate') {
    const o = traj.origin ?? { x: 0, y: 0 }
    // #14：局所 y を g(0) だけ平行移動し、術者位置 origin を始点にする
    const g0raw = traj.g(0)
    const g0 = Number.isFinite(g0raw) ? g0raw : 0
    for (let x = 0; x <= SAMPLING.rotateXMax + 1e-9; x += SAMPLING.rotateStep) {
      const y = traj.g(x)
      const valid = Number.isFinite(y)
      const local = valid ? rotate({ x, y: y - g0 }, traj.angle) : { x: NaN, y: NaN }
      const pos = valid ? { x: o.x + local.x, y: o.y + local.y } : { x: NaN, y: NaN }
      out.push({ param: x, pos, valid, inField: valid && dist(pos) <= FIELD.rField })
    }
  } else {
    const o = traj.origin ?? { x: 0, y: 0 }
    for (let t = 0; t <= SAMPLING.polarThetaMax + 1e-9; t += SAMPLING.polarStep) {
      const r = traj.f(t)
      const valid = Number.isFinite(r)
      const pos = valid
        ? { x: o.x + r * Math.cos(t), y: o.y + r * Math.sin(t) }
        : { x: NaN, y: NaN }
      out.push({ param: t, pos, valid, inField: valid && dist(pos) <= FIELD.rField })
    }
  }
  // z 場のエラー点（暴発）を反映：軌道は有効でも z がエラーになる点で打ち切る（#30）。
  // z 場はステージ中央(0,0)を原点に評価する（#58）
  applyZValidity(out, traj.z)
  return out
}

/** 原点側から、最初に「無効 or 場外」になる手前までの有効な連続区間を返す。 */
export function validPrefix(samples: Sample[]): Sample[] {
  const prefix: Sample[] = []
  for (const s of samples) {
    if (!s.valid || !s.inField) break
    prefix.push(s)
  }
  return prefix
}

/**
 * 原点側から、最初に「無効（非有限）」になる手前までの有効な連続区間を返す。
 * 場外（|pos|>R_field）でも切らない＝魔法の範囲制限を設けない（#25）。
 * 軌道型（結界リング）の閉曲線判定・リング構築に使い、場の端の術者でも円が一周する（#22）。
 */
export function validFinitePrefix(samples: Sample[]): Sample[] {
  const prefix: Sample[] = []
  for (const s of samples) {
    if (!s.valid) break
    prefix.push(s)
  }
  return prefix
}

// ===== ポリライン（弧長で位置を引く） =====

/** 累積弧長つきのポリライン頂点 */
export interface PolyPoint {
  pos: Vec2
  cumLen: number
  /** 軌道パラメータ（回転=x / 極座標=θ） */
  param: number
}

/** 有効プレフィックスから累積弧長つきポリラインを構築する。 */
export function buildPolyline(samples: Sample[]): PolyPoint[] {
  const prefix = validPrefix(samples)
  const poly: PolyPoint[] = []
  let acc = 0
  for (let i = 0; i < prefix.length; i++) {
    if (i > 0) acc += dist(prefix[i].pos, prefix[i - 1].pos)
    poly.push({ pos: prefix[i].pos, cumLen: acc, param: prefix[i].param })
  }
  return poly
}

/**
 * 場外サンプル i の直後が「発散」か（#3）。判定：
 *  - 直後に無効点（非有限＝1/0 などの極）が来る、または
 *  - 連続サンプル間の位置が大きく飛ぶ（極を跨いで ±∞ へ振れた＝不連続）。
 * 連続な正常曲線は1刻みでの移動量が小さいため、極（不連続）だけを拾える。
 * これにより刻み幅が極を飛び越える関数（例 1/(2.5−x)）も暴発に分類できる。
 */
function divergesSoonAfter(samples: Sample[], i: number, window = 96): boolean {
  const end = Math.min(samples.length, i + window)
  const jumpThreshold = FIELD.rField
  const startIdx = Math.max(1, i)
  for (let j = startIdx; j < end; j++) {
    if (!samples[j].valid) return true // 非有限＝極
    if (samples[j - 1].valid && dist(samples[j].pos, samples[j - 1].pos) > jumpThreshold) {
      return true // 連続点が大きく飛ぶ＝極を跨いだ
    }
  }
  return false
}

/**
 * 軌道の終端（最初の「無効 or 場外」点）を分類する（暴発点の検出に使う・§3.5・#3/#9）。
 * - invalid: 未定義/発散/非実数（暴発点は直前の場内有効点。無ければ原点）。
 *   場外脱出でも直後に発散するなら「発散による暴発」とみなし invalid に分類（暴発点は画面内）。
 * - outOfField: 場外へクリーンに出た（外れ・その点）
 * - maxParam: 場内で軌道を進み切った
 */
export function pathTermination(samples: Sample[]): {
  end: 'invalid' | 'outOfField' | 'maxParam'
  pos: Vec2
} {
  let lastValid: Vec2 = { x: 0, y: 0 }
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    if (!s.valid) return { end: 'invalid', pos: lastValid }
    if (!s.inField) {
      // 場外に出た直後すぐ発散するなら、暴発（invalid）として画面内の直前点を中心にする
      if (divergesSoonAfter(samples, i)) return { end: 'invalid', pos: lastValid }
      return { end: 'outOfField', pos: s.pos }
    }
    lastValid = s.pos
  }
  return { end: 'maxParam', pos: lastValid }
}

/** ポリラインの総弧長 */
export function polylineLength(poly: PolyPoint[]): number {
  return poly.length === 0 ? 0 : poly[poly.length - 1].cumLen
}

/** 弧長 s の位置・接線方向・パラメータを返す。s が総長以上なら atEnd=true。 */
export function pointAtLength(
  poly: PolyPoint[],
  s: number,
): { pos: Vec2; tangent: Vec2; param: number; atEnd: boolean } {
  if (poly.length === 0)
    return { pos: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, param: 0, atEnd: true }
  if (poly.length === 1)
    return { pos: poly[0].pos, tangent: { x: 1, y: 0 }, param: poly[0].param, atEnd: true }
  const total = polylineLength(poly)
  if (s <= 0) {
    const dir = sub(poly[1].pos, poly[0].pos)
    return { pos: poly[0].pos, tangent: normalize(dir), param: poly[0].param, atEnd: false }
  }
  if (s >= total) {
    const last = poly[poly.length - 1]
    const prev = poly[poly.length - 2]
    return {
      pos: last.pos,
      tangent: normalize(sub(last.pos, prev.pos)),
      param: last.param,
      atEnd: true,
    }
  }
  // s を含むセグメントを線形に探索（点数は数百で十分速い）
  for (let i = 1; i < poly.length; i++) {
    if (poly[i].cumLen >= s) {
      const a = poly[i - 1]
      const b = poly[i]
      const segLen = b.cumLen - a.cumLen
      const t = segLen > 0 ? (s - a.cumLen) / segLen : 0
      const dir = sub(b.pos, a.pos)
      return {
        pos: { x: a.pos.x + dir.x * t, y: a.pos.y + dir.y * t },
        tangent: normalize(dir),
        param: a.param + (b.param - a.param) * t,
        atEnd: false,
      }
    }
  }
  const last = poly[poly.length - 1]
  return { pos: last.pos, tangent: { x: 1, y: 0 }, param: last.param, atEnd: true }
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function normalize(v: Vec2): Vec2 {
  const m = Math.hypot(v.x, v.y)
  return m > 0 ? { x: v.x / m, y: v.y / m } : { x: 1, y: 0 }
}
