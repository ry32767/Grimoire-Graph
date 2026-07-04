// 幾何経路探索（修正仕様書 §8/§9）。純粋関数。
// グリッド A*（8近傍）＋見通し線ショートカット（any-angle 平滑化）で、障害物・場を考慮した
// 迂回経路を作る。clean モードは素材に clearance 余白で触れない経路のみ。wallTunnel モードは
// 削れる壁を「直線トンネル」として通過してよい（unbreakable は常に遮断・壁内部の蛇行は禁止）。
import type { Vec2 } from '../types'
import type { PlanningEnv } from './planningEnv'
import { ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'

export type RouteMode = 'clean' | 'wallTunnel'

/** 壁トンネル（削れる壁を直線で掘る区間・§9）。 */
export interface Tunnel {
  entry: Vec2
  exit: Vec2
  length: number
}

/** 探索で得た経路。points は始点→終点のワールド座標（平滑化済みの折れ線）。 */
export interface Route {
  points: Vec2[]
  mode: RouteMode
  length: number
  tunnels: Tunnel[]
}

/** 経路上の素材区間の合計長（トンネル判定・平滑化の受け入れ判定に使う）。 */
function materialLenAlong(env: PlanningEnv, a: Vec2, b: Vec2, step: number): number {
  const L = Math.hypot(b.x - a.x, b.y - a.y)
  if (L < 1e-9) return 0
  const n = Math.max(1, Math.ceil(L / step))
  let len = 0
  for (let i = 0; i <= n; i++) {
    const t = i / n
    if (env.isMaterial({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) len += L / n
  }
  return len
}

/** 線分 a→b がモードの通行条件を満たすか（clean=素材余白なし／tunnel=unbreakable 非接触）。 */
function segmentOk(env: PlanningEnv, a: Vec2, b: Vec2, mode: RouteMode): boolean {
  const L = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.max(1, Math.ceil(L / (RP.gridStep * 0.5)))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    if (!env.isInField(p)) return false
    if (mode === 'clean' ? env.overlapsMaterial(p, env.clearance) : env.overlapsUnbreakable(p, env.clearance)) {
      return false
    }
  }
  return true
}

/**
 * グリッド A*（8近傍・ユークリッド距離コスト）。wallTunnel モードは素材ノードへ
 * materialWeight 倍の距離コストを課す＝「削らずに済む経路が常に先に見つかる」。
 */
function gridSearch(env: PlanningEnv, start: Vec2, goal: Vec2, mode: RouteMode): Vec2[] | null {
  const step = RP.gridStep
  const half = Math.ceil(env.fieldR / step) + 1
  const W = half * 2 + 1
  const idxOf = (gx: number, gy: number): number => (gx + half) * W + (gy + half)
  const posOf = (gx: number, gy: number): Vec2 => ({ x: gx * step, y: gy * step })
  const walkable = (p: Vec2): boolean =>
    env.isInField(p) &&
    (mode === 'clean' ? !env.overlapsMaterial(p, env.clearance) : !env.overlapsUnbreakable(p, env.clearance))

  // 始点・終点を最寄りの通行可能セルへスナップ（壁ぎわに立つ敵の救済）
  const snap = (p: Vec2): { gx: number; gy: number } | null => {
    const gx0 = Math.round(p.x / step)
    const gy0 = Math.round(p.y / step)
    for (let r = 0; r <= 3; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const gx = gx0 + dx
          const gy = gy0 + dy
          if (Math.abs(gx) <= half && Math.abs(gy) <= half && walkable(posOf(gx, gy))) return { gx, gy }
        }
      }
    }
    return null
  }
  const s = snap(start)
  const g = snap(goal)
  if (!s || !g) return null

  const gScore = new Float64Array(W * W).fill(Infinity)
  const parent = new Int32Array(W * W).fill(-1)
  const closed = new Uint8Array(W * W)
  // 二分ヒープ（f 値最小取り出し）
  const heap: number[] = [] // [f, idx] を平坦に詰める
  const push = (f: number, idx: number) => {
    heap.push(f, idx)
    let i = heap.length / 2 - 1
    while (i > 0) {
      const pi = (i - 1) >> 1
      if (heap[pi * 2] <= heap[i * 2]) break
      for (let k = 0; k < 2; k++) {
        const tmp = heap[pi * 2 + k]
        heap[pi * 2 + k] = heap[i * 2 + k]
        heap[i * 2 + k] = tmp
      }
      i = pi
    }
  }
  const pop = (): number => {
    const idx = heap[1]
    const n = heap.length / 2 - 1
    heap[0] = heap[n * 2]
    heap[1] = heap[n * 2 + 1]
    heap.length = n * 2
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      const r = l + 1
      let m = i
      if (l < n && heap[l * 2] < heap[m * 2]) m = l
      if (r < n && heap[r * 2] < heap[m * 2]) m = r
      if (m === i) break
      for (let k = 0; k < 2; k++) {
        const tmp = heap[m * 2 + k]
        heap[m * 2 + k] = heap[i * 2 + k]
        heap[i * 2 + k] = tmp
      }
      i = m
    }
    return idx
  }

  const h = (gx: number, gy: number): number => Math.hypot(gx - g.gx, gy - g.gy) * step
  const sIdx = idxOf(s.gx, s.gy)
  const gIdx = idxOf(g.gx, g.gy)
  gScore[sIdx] = 0
  push(h(s.gx, s.gy), sIdx)
  let expansions = 0
  while (heap.length > 0 && expansions < RP.maxExpansions) {
    const cur = pop()
    if (closed[cur]) continue
    closed[cur] = 1
    expansions++
    if (cur === gIdx) break
    const cgx = Math.floor(cur / W) - half
    const cgy = (cur % W) - half
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue
        const ngx = cgx + dx
        const ngy = cgy + dy
        if (Math.abs(ngx) > half || Math.abs(ngy) > half) continue
        const np = posOf(ngx, ngy)
        if (!walkable(np)) continue
        const nIdx = idxOf(ngx, ngy)
        if (closed[nIdx]) continue
        // 素材内の移動は高コスト（tunnel モード）：避けられる経路が常に優先される
        const inMat = mode === 'wallTunnel' && env.isMaterial(np)
        const cost = Math.hypot(dx, dy) * step * (inMat ? 1 + RP.materialWeight : 1)
        const ng = gScore[cur] + cost
        if (ng < gScore[nIdx]) {
          gScore[nIdx] = ng
          parent[nIdx] = cur
          push(ng + h(ngx, ngy), nIdx)
        }
      }
    }
  }
  if (parent[gIdx] < 0 && gIdx !== sIdx) return null
  // 経路復元（goal → start → 反転）。実際の始点・終点座標で置き換える
  const pts: Vec2[] = []
  let cur = gIdx
  while (cur >= 0) {
    pts.push(posOf(Math.floor(cur / W) - half, (cur % W) - half))
    if (cur === sIdx) break
    cur = parent[cur]
  }
  pts.reverse()
  pts[0] = start
  pts[pts.length - 1] = goal
  return pts
}

/** 見通し線ショートカットで折れ線を間引く（any-angle 平滑化・素材通過量は増やさない）。 */
function smooth(env: PlanningEnv, pts: Vec2[], mode: RouteMode): Vec2[] {
  let cur = pts
  for (let pass = 0; pass < RP.smoothingPasses; pass++) {
    const out: Vec2[] = [cur[0]]
    let i = 0
    while (i < cur.length - 1) {
      let j = cur.length - 1
      for (; j > i + 1; j--) {
        if (!segmentOk(env, cur[i], cur[j], mode)) continue
        if (mode === 'wallTunnel') {
          // ショートカットで素材通過が増えるなら不採用（壁の中を突っ切る平滑化を防ぐ）
          let oldMat = 0
          for (let k = i; k < j; k++) oldMat += materialLenAlong(env, cur[k], cur[k + 1], 0.3)
          if (materialLenAlong(env, cur[i], cur[j], 0.3) > oldMat + 0.3) continue
        }
        break
      }
      out.push(cur[j])
      i = j
    }
    if (out.length === cur.length) break
    cur = out
  }
  return cur
}

/** 折れ線の全長。 */
function polylineLen(pts: Vec2[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return L
}

/** 経路上の素材区間（トンネル）を抽出する。区間は平滑化済みの直線セグメント内なので直線掘削。 */
function extractTunnels(env: PlanningEnv, pts: Vec2[]): Tunnel[] {
  const tunnels: Tunnel[] = []
  let entry: Vec2 | null = null
  let last: Vec2 | null = null
  const step = 0.3
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(L / step))
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      if (env.isMaterial(p)) {
        if (!entry) entry = p
        last = p
      } else if (entry && last) {
        tunnels.push({ entry, exit: last, length: Math.hypot(last.x - entry.x, last.y - entry.y) })
        entry = null
        last = null
      }
    }
  }
  if (entry && last) tunnels.push({ entry, exit: last, length: Math.hypot(last.x - entry.x, last.y - entry.y) })
  return tunnels
}

/**
 * start→goal の経路を探索する（§8）。clean は素材に触れない経路のみ（無ければ null）。
 * wallTunnel は直線トンネル（本数≤maxTunnelCount・長さ≤maxTunnelLength）を許す。
 */
export function findRoute(env: PlanningEnv, start: Vec2, goal: Vec2, mode: RouteMode): Route | null {
  const raw = gridSearch(env, start, goal, mode)
  if (!raw) return null
  const pts = smooth(env, raw, mode)
  const tunnels = mode === 'wallTunnel' ? extractTunnels(env, pts) : []
  if (mode === 'wallTunnel') {
    if (tunnels.length > RP.maxTunnelCount) return null
    if (tunnels.some((t) => t.length > RP.maxTunnelLength)) return null
  }
  return { points: pts, mode, length: polylineLen(pts), tunnels }
}
