// 候補軌道の本番物理検証（修正仕様書 §13）。純粋関数。
// 簡略評価で最終採用しない：削りは本番と同一の carveAlong、密度は同一の OBSTACLE_STEP、
// 結界は本番と同じ ringContact（時間刻み）＋相互相殺の減速で評価し、AI判定と本番解決のズレを無くす。
// 各イベントは弧長つきで返す＝呼び出し側が「命中前 or 極到達前」だけを数えられる。
import type { Flight, FlightSample, Obstacle, Trajectory, Vec2 } from '../types'
import { sampleTrajectory, validPrefix, pathTermination } from '../coords'
import { simulatePath, type LossEvent } from '../physics'
import { carveAlong, densifyGeom, OBSTACLE_STEP } from '../carve'
import { isSolidAt } from '../obstacle'
import { attributeOf, strengthOf, zfieldAt } from '../attribute'
import { ringContact, type RingPoint } from '../orbit'
import { resolveParry, type RadiusAt } from '../parry'
import { bulletRadius } from '../collision'

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
  /**
   * この候補の経路が「素材の中を通る長さ」（#69・掘削効率の指標）。
   * before＝撃つ前、after＝この一撃で削った後。opts.aimPos があれば狙いへの最接近点までで測る。
   * after が小さいほど「あと少しで貫通する」＝掘削として効率が良い。壁を斜めに舐める軌道は
   * before が大きいのに after がほとんど減らないので、この指標で自然に排除される。
   */
  materialLenBefore: number
  materialLenAfter: number
}

/** 追加の折れ点候補 x（フィットの解析解）。familyTrajectories 候補は数値検出のみ。 */
export interface EvaluateOptions {
  turnXs?: number[]
  /** 掘削効率（materialLen*）を測る終端。指定するとこの点への最接近までで測る。 */
  aimPos?: Vec2
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
      materialLenBefore: 0,
      materialLenAfter: 0,
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

  // 掘削効率の測定区間（#69）：狙いへの最接近点まで。指定が無ければ経路全体
  const limitArc = opts.aimPos ? closestApproachArc(dense, opts.aimPos) : Infinity
  const materialLenBefore = materialLength(dense, obstacles, limitArc)

  // 障害物の削り：本番の carveAlong をそのまま使う（obstacles は複製・losses は結界と共有）
  const losses: LossEvent[] = []
  const resim = (ls: LossEvent[]) => simulatePath(path, initialSpeed, zAtIdx, ls)
  const materialArcs: number[] = []
  let stalled = false
  let materialLenAfter = materialLenBefore
  if (touchesMaterial) {
    const cloned = obstacles.map((ob) => ({ ...ob, carves: [...ob.carves] }))
    const r = carveAlong(flight.samples, cloned, zAtPos, losses, resim, flight)
    flight = r.flight
    for (const b of r.bursts) materialArcs.push(b.arcLen)
    stalled = r.vanished
    materialLenAfter = materialLength(dense, cloned, limitArc)
  }

  // 結界（持続周回）への接触：本番（turn.ts §3b）と**完全に同じ実装**を通す（判定のズレ防止・#72）。
  // ringContact（時間刻み・弾の半径＋帯の半厚み）で接触時刻を求め、resolveParry で相殺する。
  // 反対極のみ・同極/中立は透過。結界威力が上回れば弾は消滅、弾が上回れば残威力で継続。
  const oppositeRingArcs: number[] = []
  const radiusAt: RadiusAt = (pos, speed) => bulletRadius(speed, zAtPos(pos))
  for (const ring of standingRings) {
    if (ring.length < 3) continue
    const c = ringContact(ring, flight.samples, radiusAt)
    if (!c || c.speed <= 0 || c.ringSpeed <= 0) continue
    const bZ = zfieldAt(traj, c.pos)
    const parry = resolveParry(
      attributeOf(c.ringZ),
      c.ringSpeed,
      c.ringSpeed * strengthOf(c.ringZ),
      attributeOf(bZ),
      c.speed,
      c.speed * strengthOf(bZ),
    )
    if (parry.passthrough) continue
    oppositeRingArcs.push(c.arcLen)
    losses.push({ arcLen: c.arcLen, deltaV: c.speed - parry.speedB })
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
    materialLenBefore,
    materialLenAfter,
  }
}

/** 密なパスのうち、素材の内側を通る区間の長さ（limitArc まで）。 */
function materialLength(dense: FlightSample[], obstacles: Obstacle[], limitArc: number): number {
  let len = 0
  for (let i = 1; i < dense.length; i++) {
    if (dense[i].arcLen > limitArc) break
    const step = dense[i].arcLen - dense[i - 1].arcLen
    if (step <= 0) continue
    // 区間の中点で判定（端点で判定すると境界の取りこぼし・二重計上が出る）
    const mid = {
      x: (dense[i].pos.x + dense[i - 1].pos.x) / 2,
      y: (dense[i].pos.y + dense[i - 1].pos.y) / 2,
    }
    if (obstacles.some((ob) => isSolidAt(ob, mid))) len += step
  }
  return len
}

/** 狙い点へ最も近づくサンプルの弧長（掘削効率を「狙いまでの区間」で測るため）。 */
function closestApproachArc(dense: FlightSample[], aim: Vec2): number {
  let best = Infinity
  let arc = Infinity
  for (const s of dense) {
    const d = Math.hypot(s.pos.x - aim.x, s.pos.y - aim.y)
    if (d < best) {
      best = d
      arc = s.arcLen
    }
  }
  return arc
}

/** 辞書式順位の比較（小さいほど良い・§11.3/§12.7）。a が b より良ければ負。 */
export function compareRank(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
