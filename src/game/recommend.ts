// おすすめ術式の探索：障害物越しでも敵に当たる軌道＋反対極の z 場を選ぶ。純粋関数。
// 新モデル（#30/#21）：軌道（経路）と z 場（属性）は別物。経路は命中を、z 場は属性・強度を決める。
// おすすめは「敵の反対極を最強(|z|=zPeak)で当てる」ため z=一定(±zPeak) を採用する。
// 障害物のある面では、直線の緩い放物線だけでなく壁を回り込む弓なり/S字の軌道も候補に加え、
// 貫通・迂回後の命中威力が最大の経路を選ぶ（バグ修正：壁ありの面で recommend が命中0だった）。
import type { Enemy, FlightSample, Obstacle, Trajectory, Vec2, ZField } from './types'
import { simulateFlight } from './physics'
import { firstHit } from './collision'
import { traverseObstacles } from './turn'
import { strengthOf } from './attribute'
import { dist } from './coords'
import { buildPlanningEnv } from './enemyPlanning/planningEnv'
import { findRoute } from './enemyPlanning/routeSearch'
import { fitRouteToFamilies } from './enemyPlanning/routeFit'
import { FIELD, GAME, RECOMMEND } from '../data/constants'

export interface RecommendResult {
  angle: number
  /** 直線プリセット（b は y切片） */
  line?: { a: number; b: number }
  /** 自由入力式（弧など、プリセットにない形） */
  freeExpr?: string
  /** おすすめの z 場（一定値）。敵の反対極を最強で当てる（#21） */
  zConst: number
}

function aimAngle(from: Vec2, to: Vec2, slope0: number): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - Math.atan(slope0)
}

/** 候補軌道の g(x)（局所）と、それを式文字列へ描き出す表現。 */
interface Candidate {
  /** 局所 x に対する y（軌道の形） */
  g: (x: number) => number
  /** freeExpr（自由入力式）。直線プリセットなら line を代わりに使う */
  freeExpr?: string
  /** 直線プリセット（freeExpr の代わり。b は x² 係数） */
  line?: { a: number; b: number }
  /** 狙い角の初期スロープ（aimAngle の補正に使う） */
  slope0: number
  /**
   * 狙い角を直に指定する候補（#69・経路探索フィット）。指定があれば aimAngle 補正を行わない
   * （フィットは「敵位置を原点・狙点方向を +x」の局所フレームで作られているため）。
   */
  angle?: number
}

/** 数値を式へ描くとき、ごく小さい係数は 0 に丸めて式を簡潔に保つ。 */
function fmt(n: number): string {
  return Number(n.toFixed(4)).toString()
}

/**
 * 弓なりアーク（局所 waypoints (0,0)-(mid,off)-(L,0) を通る2次曲線）を候補にする（#28 の迂回と同じ考え方）。
 * y = A·x² + B·x（A=off/(mid·(mid−L)), B=−off·L/(mid·(mid−L))）。壁の脇/上を膨らんで抜ける。
 */
function bulgeCandidate(L: number, midFrac: number, off: number): Candidate {
  const mid = L * midFrac
  const denom = mid * (mid - L)
  const A = off / denom
  const B = -(off * L) / denom
  return {
    g: (x) => A * x * x + B * x,
    freeExpr: `${fmt(A)}*x^2 + ${fmt(B)}*x`,
    slope0: B, // 打ち出し初期スロープ＝B（aimAngle で補正）
  }
}

/** 命中までに素材を削って進んだ経路が、対象へ最も近づいた距離（フォールバックの進捗指標）。 */
function closestApproach(samples: FlightSample[], target: Vec2): number {
  let best = Infinity
  for (const s of samples) {
    const d = dist(s.pos, target)
    if (d < best) best = d
  }
  return best
}

/**
 * from から target へ、障害物を貫通/迂回して命中する軌道を探す。
 * z 場は「敵の反対極を最強(|z|=zPeak)」の一定値に固定し、命中速度が最大の経路を選ぶ。
 * 直接命中する候補が無くても、最も対象へ近づく（＝壁を対象方向へ削る）候補を返す（直線フォールバックを廃止）。
 * fieldR は場の半径（#49・可変フィールド）。inField 判定に使う。未指定は既定 rField。
 */
export function recommendCast(from: Vec2, target: Enemy, obstacles: Obstacle[], fieldR?: number): RecommendResult {
  // 敵の反対極を突く：光の敵 → 闇(z<0)、闇/中立 → 光(z>0)
  const sign = target.element === 'light' ? -1 : 1
  // 属性の強さ候補（#31）：最強 zPeak は近距離で大威力だが |z|>zRef なので減速して失速する。
  // 減速しない zRef は中遠距離でも届く。壁を貫くときはさらに弱い |z|(=zWeak) が有効：
  // 削りコストが小さく、命中速度を保ったまま壁の奥の敵へ抜けられる（壁ありの面で命中0だった不具合の要）。
  const zMags = [FIELD.zPeak, FIELD.zRef, RECOMMEND.zWeak]
  const R = fieldR ?? FIELD.rField
  const L = dist(from, target.pos)
  const radius = target.hitboxRadius || GAME.enemyHitbox
  // 壁ありの面では狙い角を少しずつ振って、壁の隙間や貫通できる入射角を探す（迂回型AIと同じ考え方）。
  const angleOffsets = obstacles.length > 0 ? RECOMMEND.angleOffsets : [0]

  // 候補集合：緩い放物線（直線プリセット化しやすい）＋壁を回り込む弓なりアーク。
  const candidates: Candidate[] = []
  // 緩い放物線（従来の a·x + b·x²）。命中しやすい素直な形は line/freeExpr で返す。
  const aList = [sign * 1, sign * 2, sign * 3, -sign * 1]
  const bList = [0, 0.05, 0.1, -0.05, -0.1]
  for (const a of aList) {
    for (const b of bList) {
      candidates.push({
        g: (x) => a * x + b * x * x,
        line: b === 0 ? { a, b: 0 } : undefined,
        freeExpr: b === 0 ? undefined : `${a}*x + ${fmt(b)}*x^2`,
        slope0: a,
      })
    }
  }
  // 壁を回り込む弓なりアーク（#28）：局所 y を膨らませて壁の脇/上/隙間を抜ける。障害物がある面で有効。
  // 浅い膨らみ（貫通しつつ僅かに逸らす）から深い膨らみ（大きく回り込む）まで幅広く試す。
  if (obstacles.length > 0 && L >= 4) {
    for (const midFrac of [0.35, 0.5, 0.65]) {
      for (const off of [2, 4, 7, 10, 14, 18, -2, -4, -7, -10, -14, -18]) {
        candidates.push(bulgeCandidate(L, midFrac, off))
      }
    }
    // 経路探索フィット（#69）：柱や崩れた建造物が密に並ぶ面では、決め打ちの膨らみでは
    // 隙間を通せない。敵AIと同じ「幾何経路探索 → family フィット」を味方の照準にも通し、
    // 実際に通り抜けられる曲線（弧・折れ・捻れ）を候補に加える。
    // clean（素材に触れない）が最優先、無ければ wallTunnel（1本だけ壁を掘る）も試す。
    const env = buildPlanningEnv(obstacles, R)
    const wideEnv = buildPlanningEnv(obstacles, R, RECOMMEND.wideClearance)
    // 広い車線（素材から余裕を取った経路）→ 通常の余白 → 壁掘り の順に候補化する
    const routes = [
      findRoute(wideEnv, from, target.pos, 'clean'),
      findRoute(env, from, target.pos, 'clean'),
      findRoute(env, from, target.pos, 'wallTunnel'),
    ]
    for (const route of routes) {
      if (!route) continue
      for (const fit of fitRouteToFamilies(route.points, from, ['arc', 'abs', 'poly34'])) {
        candidates.push({ g: fit.g, freeExpr: fit.expr, slope0: 0, angle: fit.angle })
      }
    }
  }

  let best: { score: number; cand: Candidate; angle: number; zConst: number } | null = null
  // 命中候補が無いとき用：対象へ最も近づく候補（壁を対象方向へ削る＝多ターンで突破する進捗を最大化）
  let fallback: { approach: number; cand: Candidate; angle: number; zConst: number } | null = null
  for (const m of zMags) {
    const zConst = sign * m
    const zField: ZField = () => zConst
    for (const cand of candidates) {
      const baseAngle = cand.angle ?? aimAngle(from, target.pos, cand.slope0)
      // 経路フィット候補は狙い角そのものが解の一部なので、角度を振らずそのまま試す
      const offs = cand.angle !== undefined ? [0] : angleOffsets
      for (const dA of offs) {
        const angle = baseAngle + dA
        const traj: Trajectory = { mode: 'rotate', g: cand.g, angle, origin: from, z: zField, fieldR: R }
        const free = simulateFlight(traj, FIELD.fixedSpeed)
        // 障害物の貫通を込みで命中を評価（削りで carves が増えるので複製を使う）
        const obsCopy = obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
        const { flight } = traverseObstacles(traj, FIELD.fixedSpeed, free, obsCopy)
        const hit = firstHit(flight.samples, target.pos, radius)
        if (hit && hit.speed > 0) {
          // 命中速度 × 強度（=届いた威力）。zPeak が届く近距離では強度が高く有利、遠距離では zRef が選ばれる
          const score = hit.speed * strengthOf(zConst)
          if (!best || score > best.score) best = { score, cand, angle, zConst }
        } else if (!best) {
          // 命中しない候補も、対象へ最も近づく（＝壁を対象方向へ削り進める）ものを覚えておく（命中候補があれば不要）
          const approach = closestApproach(flight.samples, target.pos)
          if (!fallback || approach < fallback.approach) fallback = { approach, cand, angle, zConst }
        }
      }
    }
  }

  const chosen = best ?? fallback
  if (!chosen) {
    // 候補が全く作れない異常時のみ：素直な直線（減速しない zRef）
    const a = sign
    const zConst = sign * FIELD.zRef
    return { angle: aimAngle(from, target.pos, a), line: { a, b: 0 }, zConst }
  }
  const { cand, angle, zConst } = chosen
  if (cand.line) return { angle, line: cand.line, zConst }
  return { angle, freeExpr: cand.freeExpr!, zConst }
}
