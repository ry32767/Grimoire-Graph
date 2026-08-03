// 「撃つ前に読める値」の UI 側派生計算（DC プロトタイプ v3 の _rayInfo / refAt / poleOf / blockingBar）。
// エンジン（src/game）は読むだけ。ここで計算するのは「盤面の状態から読み取れる情報」であって、
// ゲームロジック（命中・ダメージの確定）ではない。実解決は必ず resolveAllyCasts が行う。
import type { ActiveOrbit, Attribute, Enemy, Obstacle, Vec2 } from '../game/types'
import { FIELD, SAMPLING } from '../data/constants'
import { attributeOf, strengthOf, affinityMultiplier } from '../game/attribute'
import { acceleration } from '../game/physics'
import { ringInterception } from '../game/orbit'

/** 射線読み取りの最大距離（回転方式のローカル x 上限と揃える）。 */
export const RAY_MAX = SAMPLING.rotateXMax

/** 射線上に何があるか。 */
export type RayKind = 'enemy' | 'wall' | 'nearWall' | 'none'

export interface RayInfo {
  kind: RayKind
  /** 射線に沿った距離 r（＝ z(t) の t） */
  d: number
  /** 的の属性（相性の計算に使う） */
  element: Attribute
  name: string
  /** 敵に当たっている時だけその敵ID */
  enemyId?: string
  /** 敵に当たっている時だけその敵の位置 */
  pos?: Vec2
  /** 読み出しストリップの見出し（「射線上の敵 r」など） */
  statLabel: string
  /** 一行の説明 */
  label: string
}

/** 半直線（origin から角度 ang）と円の交差 t（無ければ null）。 */
function rayCircleT(origin: Vec2, dx: number, dy: number, cx: number, cy: number, rad: number): number | null {
  const ex = cx - origin.x
  const ey = cy - origin.y
  const proj = ex * dx + ey * dy
  const perp = Math.abs(-ex * dy + ey * dx)
  if (perp > rad) return null
  const half = Math.sqrt(Math.max(0, rad * rad - perp * perp))
  const t1 = proj - half
  const t2 = proj + half
  if (t2 <= 0) return null
  return Math.max(0.01, t1)
}

/** 半直線と AABB（左下 x,y ＋ w,h）の交差 t（スラブ法・無ければ null）。 */
function rayRectT(
  origin: Vec2,
  dx: number,
  dy: number,
  r: { x: number; y: number; w: number; h: number },
): number | null {
  let t0 = 0
  let t1: number = RAY_MAX
  const axes: [number, number, number, number][] = [
    [origin.x, dx, r.x, r.x + r.w],
    [origin.y, dy, r.y, r.y + r.h],
  ]
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null
      continue
    }
    let a = (lo - p) / d
    let b = (hi - p) / d
    if (a > b) {
      const s = a
      a = b
      b = s
    }
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, b)
    if (t0 > t1) return null
  }
  return t0
}

/**
 * いま向いている向きの直線上に何があるか（DC v3 の `_rayInfo`）。
 * 敵が居ればその敵まで、居なければ壁まで、どちらも無ければ最寄りの障害物までの距離を返す。
 * 「z(t) の t をどこに合わせるか」を決めるための読み取り値。
 */
export function rayInfo(origin: Vec2, angle: number, enemies: Enemy[], obstacles: Obstacle[]): RayInfo {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)

  let foe: { d: number; e: Enemy } | null = null
  for (const e of enemies) {
    if (e.hp <= 0) continue
    // 見かけの狙いやすさに合わせて、ヒットボックスを少し太らせて拾う
    const t = rayCircleT(origin, dx, dy, e.pos.x, e.pos.y, (e.hitboxRadius || 2) + 0.8)
    if (t != null && t <= RAY_MAX && (!foe || t < foe.d)) foe = { d: t, e }
  }
  if (foe) {
    return {
      kind: 'enemy',
      d: foe.d,
      element: foe.e.element,
      name: foe.e.name,
      enemyId: foe.e.id,
      pos: foe.e.pos,
      statLabel: '射線上の敵 r',
      label: `${foe.e.name} まで ${foe.d.toFixed(1)}`,
    }
  }

  let wall: { d: number; ob: Obstacle } | null = null
  for (const ob of obstacles) {
    for (const s of ob.solids) {
      const t = rayCircleT(origin, dx, dy, s.x, s.y, s.r)
      if (t != null && t <= RAY_MAX && (!wall || t < wall.d)) wall = { d: t, ob }
    }
    for (const r of ob.rects ?? []) {
      const t = rayRectT(origin, dx, dy, r)
      if (t != null && t <= RAY_MAX && (!wall || t < wall.d)) wall = { d: t, ob }
    }
  }
  if (wall) {
    return {
      kind: 'wall',
      d: wall.d,
      element: wall.ob.element ?? 'neutral',
      name: '射線上の壁',
      statLabel: '射線上の壁 r',
      label: `射線上の壁まで ${wall.d.toFixed(1)}`,
    }
  }

  // 射線に何も無いときは、いちばん近い障害物までの距離を出す（t の目安が消えないように）
  let near: { d: number; ob: Obstacle } | null = null
  for (const ob of obstacles) {
    const cells = [
      ...ob.solids.map((s) => ({ x: s.x, y: s.y, r: s.r })),
      ...(ob.rects ?? []).map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, r: Math.min(r.w, r.h) / 2 })),
    ]
    for (const c of cells) {
      const d = Math.max(0.1, Math.hypot(c.x - origin.x, c.y - origin.y) - c.r)
      if (!near || d < near.d) near = { d, ob }
    }
  }
  if (near) {
    return {
      kind: 'nearWall',
      d: near.d,
      element: near.ob.element ?? 'neutral',
      name: '最寄りの障害物',
      statLabel: '最寄りの壁 r',
      label: `射線上に的なし／最寄りの壁 ${near.d.toFixed(1)}`,
    }
  }
  return {
    kind: 'none',
    d: RAY_MAX * 0.6,
    element: 'neutral',
    name: '—',
    statLabel: '射線 r',
    label: '射線上に的なし',
  }
}

/** 距離 r まで飛んだときの読み取り値（z・属性・強度・速度・相性・当たれば何点）。 */
export interface RefAt {
  z: number
  attr: Attribute
  strength: number
  /** その距離まで飛んだときの速度（z だけから決まる＝撃つ前に読める） */
  speed: number
  affinity: number
  damage: number
}

/**
 * z(t)（t＝術者からの距離）から「距離 r での読み取り値」を求める（DC v3 の `refAt`）。
 * 速度は加速度 a(z) を距離で積分する。z は半径場なので θ に依らない＝完全情報。
 */
export function refAt(zAt: (t: number) => number, r: number, targetElement: Attribute): RefAt {
  const z = zAt(r)
  if (!Number.isFinite(z)) {
    return { z: 0, attr: 'neutral', strength: 0, speed: 0, affinity: 1, damage: 0 }
  }
  const attr = attributeOf(z)
  const strength = strengthOf(z)
  let v: number = FIELD.fixedSpeed
  let d = 0
  for (let i = 0; i < SAMPLING.maxFrames && d < r; i++) {
    const zz = zAt(d)
    if (!Number.isFinite(zz)) {
      v = 0
      break
    }
    v = Math.min(FIELD.maxFlightSpeed, v + acceleration(zz) * FIELD.dt)
    if (v <= 0) {
      v = 0
      break
    }
    d += v * FIELD.dt
  }
  const affinity = affinityMultiplier(attr, targetElement)
  return { z, attr, strength, speed: v, affinity, damage: Math.round(v * strength * affinity) }
}

/**
 * z(t) が発散する最初の t（極）。無ければ null。極は θ に依らず t だけで決まる。
 * 判定はエンジンの `coords.applyZValidity` と同じ規則にそろえる：
 * **非有限**、または **符号が反転しつつ両側の |z| が 2·zPeak を超えた**（±∞ を跨いだ）点。
 * 予告と実際の暴発点がずれないよう、刻みも軌道サンプリング（rotateStep）に合わせる。
 */
export function poleOf(zAt: (t: number) => number): number | null {
  const POLE_Z = 2 * FIELD.zPeak
  let prev: number | null = null
  for (let t = 0; t <= RAY_MAX; t += SAMPLING.rotateStep) {
    const v = zAt(t)
    if (!Number.isFinite(v)) return t
    if (prev !== null && Math.sign(v) !== Math.sign(prev) && Math.min(Math.abs(v), Math.abs(prev)) > POLE_Z) {
      return t
    }
    prev = v
  }
  return null
}

/** 味方→的の直線上に立ちはだかる敵の持続結界（DC v3 の `blockingBar`）。 */
export function blockingBarrier(
  origin: Vec2,
  target: Vec2 | null,
  orbits: ActiveOrbit[],
): { at: number; id: string } | null {
  const enemyOrbits = orbits.filter((o) => o.owner === 'enemy')
  if (enemyOrbits.length === 0 || !target) return null
  const N = 48
  const path: Vec2[] = []
  for (let i = 0; i <= N; i++) {
    path.push({
      x: origin.x + (target.x - origin.x) * (i / N),
      y: origin.y + (target.y - origin.y) * (i / N),
    })
  }
  for (const ob of enemyOrbits) {
    const it = ringInterception(ob.ring, path)
    if (it.crossed) {
      const p = it.pos ?? target
      return { at: Math.hypot(p.x - origin.x, p.y - origin.y), id: ob.id }
    }
  }
  return null
}
