// 座標変換と軌道の幾何展開。描画・当たり判定・物理・暴発で共有する唯一の変換層（§3.1）。
import type { Vec2, Trajectory } from './types'
import { FIELD, SAMPLING } from '../data/constants'

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

/** 軌道を原点側から外側へサンプリングする（無効点・場外点も含めて返す）。 */
export function sampleTrajectory(traj: Trajectory): Sample[] {
  const out: Sample[] = []
  if (traj.mode === 'rotate') {
    for (let x = 0; x <= SAMPLING.rotateXMax + 1e-9; x += SAMPLING.rotateStep) {
      const y = traj.g(x)
      const valid = Number.isFinite(y)
      const pos = valid ? rotate({ x, y }, traj.angle) : { x: NaN, y: NaN }
      out.push({ param: x, pos, valid, inField: valid && dist(pos) <= FIELD.rField })
    }
  } else {
    for (let t = 0; t <= SAMPLING.polarThetaMax + 1e-9; t += SAMPLING.polarStep) {
      const r = traj.f(t)
      const valid = Number.isFinite(r)
      const pos = valid ? { x: r * Math.cos(t), y: r * Math.sin(t) } : { x: NaN, y: NaN }
      out.push({ param: t, pos, valid, inField: valid && dist(pos) <= FIELD.rField })
    }
  }
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
 * 軌道の終端（最初の「無効 or 場外」点）を分類する（暴発点の検出に使う・§3.5）。
 * - invalid: 未定義/発散/非実数（暴発点は直前の有効点。無ければ原点）
 * - outOfField: 場外へ出た（その点）
 * - maxParam: 場内で軌道を進み切った
 */
export function pathTermination(samples: Sample[]): {
  end: 'invalid' | 'outOfField' | 'maxParam'
  pos: Vec2
} {
  let lastValid: Vec2 = { x: 0, y: 0 }
  for (const s of samples) {
    if (!s.valid) return { end: 'invalid', pos: lastValid }
    if (!s.inField) return { end: 'outOfField', pos: s.pos }
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
