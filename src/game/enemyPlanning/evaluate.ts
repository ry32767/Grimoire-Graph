// 候補軌道の本番物理検証（修正仕様書 §13）。純粋関数。
// 簡略評価で最終採用しない：削りは本番と同一の carveAlong、密度は同一の OBSTACLE_STEP、
// 結界は本番と同じ ringInterception＋相互相殺の減速で評価し、AI判定と本番解決のズレを無くす。
// 各イベントは弧長つきで返す＝呼び出し側が「命中前 or 極到達前」だけを数えられる。
import type { Flight, Obstacle, Trajectory, Vec2 } from '../types'
import { sampleTrajectory, validPrefix, pathTermination } from '../coords'
import { simulatePath, sampleAtLength, type LossEvent } from '../physics'
import { carveAlong, densifyGeom, OBSTACLE_STEP } from '../carve'
import { isSolidAt } from '../obstacle'
import { attributeOf, strengthOf, zfieldAt } from '../attribute'
import { ringInterception, type RingPoint } from '../orbit'
import { resolveParry } from '../parry'

/** 候補軌道の評価結果。rank（辞書式順位）と成功条件の判定に使う。 */
export interface ShotEvaluation {
  /** 幾何パス（自由飛行の有効区間） */
  path: Vec2[]
  /** 削り・結界減速込みの飛行（本番 3z/3a 相当を通した後の速度分布） */
  flight: Flight
  /** 軌道が z 場の極・無効点で終わる＝終端で暴発する（ruptor の成功条件） */
  ruptured: boolean
  /** 幾何パスが最初に unbreakable の素材へ触れる弧長（触れないなら null・全ロールで棄却対象） */
  unbreakableArc: number | null
  /** 素材を削った点の弧長（空=クリーン） */
  materialArcs: number[]
  /** 折れ点・極値点が素材内にある点の弧長（壁内部で曲がる候補の棄却・§9.3） */
  turnInMaterialArcs: number[]
  /** 反対極結界を横断した点の弧長（横断ごとに相互相殺で減速） */
  oppositeRingArcs: number[]
  /** 削り・結界減速で終端（極 or 進み切り）まで届かず失速した */
  stalled: boolean
  /** パス終端（ruptor では暴発点＝極の直前） */
  endPos: Vec2
  pathLength: number
}

/** 追加の折れ点候補 x（フィットの解析解）。familyTrajectories 候補は数値検出のみ。 */
export interface EvaluateOptions {
  turnXs?: number[]
}

/**
 * 回転方式 g(x) の極値点（進行方向に対する折り返し）を数値検出し、素材内にあるものの弧長を返す。
 * 経路パラメータで dy の符号反転を探し、反転点のワールド座標で素材判定する（§9.3）。
 * extraXs（abs の折れ点 h・poly34 の極値根）は刻みで取りこぼさないよう追加サンプルする。
 */
function turnsInMaterial(
  traj: Trajectory,
  path: Vec2[],
  params: number[],
  cumLen: number[],
  obstacles: Obstacle[],
  extraXs: number[],
): number[] {
  if (obstacles.length === 0 || traj.mode !== 'rotate' || params.length < 3) return []
  const inMaterial = (p: Vec2): boolean => obstacles.some((ob) => isSolidAt(ob, p))
  const arcs: number[] = []
  const flagged = new Set<number>()
  let prevDy: number | null = null
  for (let i = 1; i < params.length; i++) {
    const dy = traj.g(params[i]) - traj.g(params[i - 1])
    if (prevDy !== null && ((prevDy > 1e-9 && dy < -1e-9) || (prevDy < -1e-9 && dy > 1e-9))) {
      if (!flagged.has(i - 1) && inMaterial(path[i - 1])) {
        flagged.add(i - 1)
        arcs.push(cumLen[i - 1])
      }
    }
    if (Math.abs(dy) > 1e-9) prevDy = dy
  }
  for (const x of extraXs) {
    let nearest = -1
    let bestD = Infinity
    for (let i = 0; i < params.length; i++) {
      const d = Math.abs(params[i] - x)
      if (d < bestD) {
        bestD = d
        nearest = i
      }
    }
    if (nearest >= 0 && bestD < 1 && !flagged.has(nearest) && inMaterial(path[nearest])) {
      flagged.add(nearest)
      arcs.push(cumLen[nearest])
    }
  }
  return arcs
}

/**
 * 候補軌道を本番と同じ物理・ジオメトリで評価する（§13.1）。
 * 解決順序も本番と同じ：自由飛行 → 障害物の削り（carveAlong）→ 結界の相互相殺減速。
 * obstacles は複製して削るため入力は変更しない。
 */
export function evaluateEnemyShot(
  traj: Trajectory,
  initialSpeed: number,
  obstacles: Obstacle[],
  standingRings: RingPoint[][],
  opts: EvaluateOptions = {},
): ShotEvaluation {
  const samples = sampleTrajectory(traj)
  const prefix = validPrefix(samples)
  const path = prefix.map((s) => s.pos)
  const params = prefix.map((s) => s.param)
  const ruptured = pathTermination(samples).end === 'invalid'
  const zAtIdx = (i: number) => zfieldAt(traj, path[Math.min(i, path.length - 1)])
  const zAtPos = (pos: Vec2) => zfieldAt(traj, pos)
  let flight = simulatePath(path, initialSpeed, zAtIdx)
  if (path.length < 2) {
    return {
      path,
      flight,
      ruptured,
      unbreakableArc: null,
      materialArcs: [],
      turnInMaterialArcs: [],
      oppositeRingArcs: [],
      stalled: true,
      endPos: path[0] ?? traj.origin ?? { x: 0, y: 0 },
      pathLength: 0,
    }
  }
  // 幾何の累積弧長（速度減衰と無関係にパス全長を測る）
  const cumLen: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    cumLen.push(cumLen[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
  }
  const pathLength = cumLen[cumLen.length - 1]

  // 幾何チェックは本番と同じ密度（OBSTACLE_STEP）で行う（判定不一致＝壁埋まりの根絶）
  const geom = path.map((p, i) => ({ pos: p, speed: 0, arcLen: cumLen[i], param: params[i] }))
  const dense = densifyGeom(geom, OBSTACLE_STEP)
  const unbreakables = obstacles.filter((ob) => (ob.kind ?? 'normal') === 'unbreakable')
  let unbreakableArc: number | null = null
  let touchesMaterial = false
  for (const s of dense) {
    if (unbreakableArc === null && unbreakables.some((ob) => isSolidAt(ob, s.pos))) unbreakableArc = s.arcLen
    if (!touchesMaterial && obstacles.some((ob) => isSolidAt(ob, s.pos))) touchesMaterial = true
    if (unbreakableArc !== null && touchesMaterial) break
  }

  // 障害物の削り：本番の carveAlong をそのまま使う（obstacles は複製・losses は結界と共有）
  const losses: LossEvent[] = []
  const resim = (ls: LossEvent[]) => simulatePath(path, initialSpeed, zAtIdx, ls)
  const materialArcs: number[] = []
  let stalled = false
  if (touchesMaterial) {
    const cloned = obstacles.map((ob) => ({ ...ob, carves: [...ob.carves] }))
    const r = carveAlong(flight.samples, cloned, zAtPos, losses, resim, flight)
    flight = r.flight
    for (const b of r.bursts) materialArcs.push(b.arcLen)
    stalled = r.vanished
  }

  // 結界（持続周回）の横断：本番（turn.ts）と同じ resolveParry で相殺する（判定のズレ防止）。
  // 反対極のみ・同極/中立は透過。結界威力が上回れば弾は消滅、弾が上回れば残威力で継続。
  const oppositeRingArcs: number[] = []
  for (const ring of standingRings) {
    if (ring.length < 3) continue
    const inter = ringInterception(ring, path)
    if (!inter.crossed || inter.enemyIndex === undefined || inter.ringZ === undefined) continue
    const crossArc = cumLen[Math.min(inter.enemyIndex, cumLen.length - 1)]
    const before = sampleAtLength(flight, crossArc)?.speed ?? 0
    const vCross = inter.ringSpeed ?? 0
    if (before <= 0 || vCross <= 0) continue
    const bZ = zfieldAt(traj, inter.pos ?? path[Math.min(inter.enemyIndex, path.length - 1)])
    const parry = resolveParry(
      attributeOf(inter.ringZ),
      vCross,
      vCross * strengthOf(inter.ringZ),
      attributeOf(bZ),
      before,
      before * strengthOf(bZ),
    )
    if (parry.passthrough) continue
    oppositeRingArcs.push(crossArc)
    losses.push({ arcLen: crossArc, deltaV: before - parry.speedB })
    flight = resim(losses)
  }
  if (flight.end === 'vanished') stalled = true

  return {
    path,
    flight,
    ruptured,
    unbreakableArc,
    materialArcs,
    turnInMaterialArcs: turnsInMaterial(traj, path, params, cumLen, obstacles, opts.turnXs ?? []),
    oppositeRingArcs,
    stalled,
    endPos: path[path.length - 1],
    pathLength,
  }
}

/** 辞書式順位の比較（小さいほど良い・§11.3/§12.7）。a が b より良ければ負。 */
export function compareRank(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
