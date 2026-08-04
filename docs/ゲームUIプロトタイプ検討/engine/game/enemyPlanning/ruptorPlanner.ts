// 崩し手（ruptor・#42／05b §4／修正仕様書 §12）：z 場に極を仕込み、対象の近傍で暴発させる。
// 軌道探索基盤（family 候補・経路フィット・本番物理検証）は迂回型と共有するが、
// 成功条件は「命中」ではなく「暴発成立 ＋ 対象が AoE 圏内（instability 下振れ込み）」で採点する。
import type { Ally, Enemy, EnemyFamily, Obstacle, Trajectory, Vec2, ZField } from '../types'
import { dist } from '../coords'
import { firstHitAmong } from '../collision'
import { isSolidAt, materialCells, obstacleOverlapsCircle } from '../obstacle'
import { ringEncloses, ringAverageAttr, ringCentroid, ringRadius, type RingPoint } from '../orbit'
import { varianceOf } from '../misfireInstability'
import { COMBAT, FIELD, GAME, RUPTOR, ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'
import { AVOIDER_FAMILIES, ABS_H_RATIO, aimAt, familyTrajectories } from './trajectories'
import { perceivedPos, threatScore, avoiderFamiliesOf } from './perception'
import { buildPlanningEnv } from './planningEnv'
import { findRoute, type RouteMode } from './routeSearch'
import { fitRouteToFamilies } from './routeFit'
import { evaluateEnemyShot, compareRank } from './evaluate'
import type { EnemyPlan } from '../enemyAI'

/**
 * ruptor の z 場（05b §4）：狙点 target で g=0 になる「接近方向の符号付き距離」g に極を仕込む。
 * z(x,y) = zBase×極性 + k/g(x,y)。接近側（g<0）では極の寄与が基礎 z と同符号になるよう k の符号を選び、
 * 飛行区間は属性が読める通常の光/闇弾として振る舞う。狙点を跨ぐと z の符号が大きく反転し、
 * 既存の極判定（coords.applyZValidity）がそのまま暴発（z 場エラー・04-magic §4.3）として検出する。
 */
export function buildRuptorZField(origin: Vec2, target: Vec2, polarity: 1 | -1): ZField {
  // z 場は術者位置 origin を原点として評価される（#52）ため、狙点も origin 基準の相対座標で持つ
  const rx = target.x - origin.x
  const ry = target.y - origin.y
  const L = Math.hypot(rx, ry) || 1
  const ux = rx / L
  const uy = ry / L
  const base = RUPTOR.zBase * polarity
  const k = -RUPTOR.poleK * polarity // 接近側（g<0）で k/g が base と同符号になる
  return (x, y) => {
    const g = (x - rx) * ux + (y - ry) * uy
    return base + k / g
  }
}

/** 評価済み候補（辞書式 rank・§12.7）。 */
interface RuptorCandidate {
  traj: Trajectory
  rank: readonly number[]
  end: Vec2
  /** 実際に暴発する（極に到達し、削り・結界で失速しない）＝予告を出してよい候補 */
  misfire: boolean
  /** AoE 期待半径で巻き込み対象（点 or 壁素材）を捉えている */
  inExpected: boolean
  /** 経路が素材に触れない（クリーン） */
  noMaterial: boolean
  /** 反対極結界の横断がない */
  noRingBlock: boolean
  /** 自爆：暴発点が自分の AoE 危険圏（上振れ込み）内（#65：自爆しない場所を優先する） */
  selfInAoE: boolean
  /** 巻き込む味方（敵チーム）の数（#65） */
  matesInAoE: number
}

/**
 * AoE の巻き込み判定の対象（§12.2）。ユニット狙いは「点」（対象の見かけ位置）、
 * 壁狙い（壁面手前・第4面デモ）は「素材」＝AoE が削れる壁に重なっていれば有効。
 * 横へ逃がした極（自爆・味方巻き込み回避）でも壁沿いなら有効性を失わない。
 */
type Cover = { kind: 'point'; pos: Vec2 } | { kind: 'material' }

/**
 * 崩し手の攻撃計画（#42・05b §4）。狙う対象の近傍に z 場の極（暴発点）が来る軌道を、
 * 迂回型と同じ family（abs/arc/poly34・#46）＋経路フィットから選ぶ。
 * aimOverride を渡すとその位置を狙う（ボス断末魔の分散ターゲティング・#45）。
 * standingRings（持続結界）があれば極をリング迎撃範囲の手前に置く（#48）。
 * instability は暴発 AoE の下振れ（04b §4b.3）：下振れしても巻き込める候補を優先する（§12.6）。
 */
export function planRuptorShot(
  enemy: Enemy,
  allies: Ally[],
  obstacles: Obstacle[] = [],
  aimOverride?: { pos: Vec2; targetId: string },
  standingRings: RingPoint[][] = [],
  fieldR?: number,
  instability = 0,
  teammates: { id: string; pos: Vec2; hp: number }[] = [],
): EnemyPlan | null {
  const alive = allies.filter((a) => a.hp > 0)
  if (alive.length === 0) return null
  // 隠蔽の扱いは attacker と同じ（#35）：完全に隠れた味方は狙えず、見かけ位置で計画する
  const visible = alive.filter((a) => (a.concealed ?? 0) < COMBAT.orbitConcealFull)
  const candidates = visible.length > 0 ? visible : alive
  const target = candidates.reduce((best, a) => (threatScore(a) > threatScore(best) ? a : best))

  // 弾の極性は自陣の element（無属性なら対象の反対極）
  let polarity: 1 | -1 =
    enemy.element === 'light' ? 1 : enemy.element === 'dark' ? -1 : target.element === 'light' ? -1 : 1
  // 高難度個体（slipThrough・05b §5.2/§5.3）：狙う相手が結界に守られていれば、
  // 結界の平均属性と同極に極性を合わせてすり抜け、極（暴発点）を内側へ届ける
  let slipRing: RingPoint[] | null = null
  if (enemy.slipThrough && standingRings.length > 0) {
    const slipAim = aimOverride?.pos ?? perceivedPos(target)
    const enclosing = standingRings.find((r) => r.length >= 3 && ringEncloses(r, slipAim))
    if (enclosing) {
      const rAttr = ringAverageAttr(enclosing)
      if (rAttr !== 'neutral') {
        polarity = rAttr === 'light' ? 1 : -1
        slipRing = enclosing // 同極で透過できる＝リング手前補正は不要（奥まで届かせる・§7.3）
      }
    }
  }

  // 迂回型と同じ family 制約（#46・05b §2/§5.3）：abs/arc/poly34 のみ。
  // 有効な family を持たない個体（wave/exp/line 素）は主力一式（abs/arc/poly34）へフォールバック。
  const own = avoiderFamiliesOf(enemy).filter((f) => AVOIDER_FAMILIES.includes(f))
  const fams: readonly EnemyFamily[] = own.length > 0 ? own : AVOIDER_FAMILIES
  const wide: readonly EnemyFamily[] = AVOIDER_FAMILIES.filter((f) => !fams.includes(f))
  const guaranteed = FIELD.aoeRadius * (1 - varianceOf(instability))
  // 自爆・味方巻き込みの危険圏（#65）：AoE 半径は instability で上振れしうるため、
  // 「上振れ込みの最大半径」より内側に極を置く計画は自爆と見なして避ける
  const selfDanger = FIELD.aoeRadius * (1 + varianceOf(instability))
  const env = obstacles.length > 0 ? buildPlanningEnv(obstacles, fieldR) : null
  const allyTargets = alive.map((a) => ({ id: a.id, pos: a.pos, radius: GAME.allyHitbox }))
  // 反対極の持続結界の迎撃圏（中心・半径＋手前マージン）。この圏内に極を置く計画は
  // 「際どすぎて不発リスクが高い」として暴発採用しない＝リング半径を広げる防御側の
  // 対抗策（05b §4.6）を尊重する。同極（slipThrough 透過含む）の結界は制限しない。
  const hostileRingZones = standingRings
    .filter((r) => {
      if (r.length < 3) return false
      const rAttr = ringAverageAttr(r)
      return (rAttr === 'light' && polarity === -1) || (rAttr === 'dark' && polarity === 1)
    })
    .map((r) => ({ c: ringCentroid(r), reach: ringRadius(r) + RUPTOR.ringFrontMargin }))
  const poleTooCloseToHostileRing = (p: Vec2): boolean =>
    hostileRingZones.some((zone) => dist(p, zone.c) < zone.reach - 1e-6)

  // 巻き込み判定：点（対象位置）or 素材（AoE が削れる壁に重なるか）
  const breakables = obstacles.filter((ob) => (ob.kind ?? 'normal') !== 'unbreakable')
  const covers = (cover: Cover, end: Vec2, radius: number): boolean =>
    cover.kind === 'point'
      ? dist(end, cover.pos) <= radius
      : breakables.some((ob) => obstacleOverlapsCircle(ob, end, radius))
  const coverDist = (cover: Cover, end: Vec2, aim: Vec2): number =>
    cover.kind === 'point' ? dist(end, cover.pos) : dist(end, aim)

  /** 1候補を本番物理で評価し、辞書式 rank（§12.7）を組む。 */
  const evalTraj = (traj: Trajectory, aim: Vec2, cover: Cover, ownFam: boolean, turnXs?: number[]): RuptorCandidate => {
    const ev = evaluateEnemyShot(traj, enemy.castInitialSpeed, obstacles, standingRings, { turnXs })
    const dPole = dist(ev.endPos, aim)
    const dCover = coverDist(cover, ev.endPos, aim)
    const inExpected = covers(cover, ev.endPos, FIELD.aoeRadius)
    const inGuaranteed = covers(cover, ev.endPos, guaranteed)
    // 暴発として採用できる条件（§14.2）：極に到達して実際に暴発し（迎撃・削りで失速しない）、
    // 反対極結界の迎撃圏に際どく踏み込まず（防御側の対抗策を貫かない・05b §4.6）、
    // 巻き込み対象が AoE 期待半径内（圏外の暴発は無害なので無理に撃たない＝通常弾へ切り替え）。
    const misfire = ev.ruptured && !ev.stalled && !poleTooCloseToHostileRing(ev.endPos) && inExpected
    // 極到達前の通常ヒットボックス接触（§12.2.1）：対象を素通りして奥で暴発する見た目を避ける
    const hb = firstHitAmong(ev.flight.samples, allyTargets)
    const hitBeforePole = hb !== null && hb.arcLen < ev.pathLength - 0.5
    // 自爆・味方（敵チーム）巻き込みの回避（§12.7 selfInsideAoE／#65）：暴発は敵味方無差別。
    // 危険圏は AoE の上振れ込み（selfDanger）で見積もり、被覆キーより上位で強く避ける
    // （＝巻き込みが確実な極より、少し外して安全な極を必ず優先する）
    const selfInAoE = misfire && dist(ev.endPos, enemy.pos) <= selfDanger
    const matesInAoE = misfire
      ? teammates.filter((m) => m.id !== enemy.id && m.hp > 0 && dist(ev.endPos, m.pos) <= selfDanger).length
      : 0
    const rank = [
      misfire ? 0 : 1,
      // ユニット狙い（点被覆）を壁削り狙い（素材被覆）より常に優先する（§14.2 の採用順）
      misfire && cover.kind === 'point' ? 0 : 1,
      selfInAoE ? 1 : 0, // 自爆回避は被覆より優先（#65：自爆しない場所を選ぶ）
      matesInAoE,
      inGuaranteed ? 0 : 1, // 下振れ込みで巻き込める（本命・§12.6）
      inExpected ? 0 : 1, // 期待半径でなら巻き込める（次点）
      hitBeforePole ? 1 : 0,
      ev.unbreakableArc !== null ? 1 : 0, // unbreakable 横断は採用しない（§9.3）
      ev.turnInMaterialArcs.length, // 壁内部の折れ点は採用しない（§9.3）
      ev.materialArcs.length > 0 ? 1 : 0, // クリーン経路を壁削りより優先（§9.1）
      ev.oppositeRingArcs.length,
      ownFam ? 0 : 1, // 個体の得意 family の個性を保つ
      dPole,
      Math.max(0, dCover - guaranteed),
      ev.pathLength,
    ]
    return {
      traj,
      rank,
      end: ev.endPos,
      misfire,
      inExpected,
      noMaterial: ev.materialArcs.length === 0,
      noRingBlock: ev.oppositeRingArcs.length === 0,
      selfInAoE,
      matesInAoE,
    }
  }

  /** 指定の狙点に極を仕込み、family 候補＋経路フィット候補から rank 最良を選ぶ。 */
  const searchAim = (aim: Vec2, cover: Cover): RuptorCandidate | null => {
    const z = buildRuptorZField(enemy.pos, aim, polarity)
    const base = aimAt(enemy.pos, aim)
    const hFold = dist(enemy.pos, aim) * ABS_H_RATIO
    let best: RuptorCandidate | null = null
    const consider = (c: RuptorCandidate) => {
      if (!best || compareRank(c.rank, best.rank) < 0) best = c
    }
    const tryFams = (list: readonly EnemyFamily[], ownFam: boolean) => {
      for (const fam of list) {
        for (const traj of familyTrajectories(fam, enemy.pos, base, z, hFold, fieldR)) {
          consider(evalTraj(traj, aim, cover, ownFam))
        }
      }
    }
    const tryRoute = (mode: RouteMode) => {
      if (!env) return
      const route = findRoute(env, enemy.pos, aim, mode)
      if (!route) return
      for (const fit of fitRouteToFamilies(route.points, enemy.pos, AVOIDER_FAMILIES)) {
        const traj: Trajectory = { mode: 'rotate', g: fit.g, angle: fit.angle, origin: enemy.pos, z, fieldR }
        consider(evalTraj(traj, aim, cover, fams.includes(fit.family), fit.turnXs))
      }
    }
    tryFams(fams, true)
    const good = (c: RuptorCandidate | null): boolean =>
      c !== null && c.misfire && c.inExpected && c.noMaterial // 暴発成立・AoE 圏内・クリーン
    if (!good(best)) tryRoute('clean')
    if (!good(best) && wide.length > 0) tryFams(wide, false)
    if (!good(best)) tryRoute('wallTunnel')
    return best
  }

  // 障害物狙いの個体（第4面デモ・#42）：壁の素材（unbreakable 以外）の「面の手前」に極を置く。
  // 敵から近い順に素材セル（円・矩形とも・#56）を試し、確実に暴発できる狙いを選ぶ。
  if (!aimOverride && enemy.ruptorTarget === 'obstacles') {
    const discs: { pos: Vec2; r: number; d: number }[] = []
    for (const ob of obstacles) {
      if ((ob.kind ?? 'normal') === 'unbreakable') continue
      for (const disc of materialCells(ob)) {
        discs.push({ pos: { x: disc.x, y: disc.y }, r: disc.r, d: dist(enemy.pos, { x: disc.x, y: disc.y }) })
      }
    }
    // 自爆圏より近い素材は狙わない（#65）：極は面の手前 1.2 に置かれるため、
    // セル中心までの距離が「危険圏＋半径＋手前マージン」以下なら自爆になる＝候補から除外。
    // 遠いセルは残るので、周囲が全て至近でない限りデモは安全な壁で成立する。
    const safeDiscs = discs.filter((disc) => disc.d - disc.r - 1.2 > selfDanger + 0.3)
    safeDiscs.sort((a, b) => a.d - b.d)
    let fallback: RuptorCandidate | null = null
    for (const disc of safeDiscs.slice(0, RP.maxGoalsPerEnemy)) {
      // 極（g の零点）は中心でなく壁「面」の手前（05b §4）＝素材の外に出るまで敵側へ引く
      const L = disc.d || 1
      const pt = (t: number): Vec2 => ({
        x: enemy.pos.x + (disc.pos.x - enemy.pos.x) * t,
        y: enemy.pos.y + (disc.pos.y - enemy.pos.y) * t,
      })
      let t = Math.max(0, (L - disc.r) / L)
      while (t > 0 && obstacles.some((ob) => isSolidAt(ob, pt(t)))) t -= 0.4 / L
      const aim = pt(Math.max(0, t - 1.2 / L))
      const found = searchAim(aim, { kind: 'material' })
      // 確実に暴発でき（極到達）、壁・結界に阻まれず、自爆・味方巻き込みが無い狙いなら即採用（#65）
      if (found && found.misfire && found.noMaterial && found.noRingBlock && !found.selfInAoE && found.matesInAoE === 0) {
        return { trajectory: found.traj, targetId: '', expectedDamage: 0, misfirePos: found.end }
      }
      if (found && (!fallback || compareRank(found.rank, fallback.rank) < 0)) fallback = found
    }
    // 自爆になる暴発は採用しない（#65）：その場合は通常の味方狙いフローへ落とす
    if (fallback && !(fallback.misfire && fallback.selfInAoE)) {
      return { trajectory: fallback.traj, targetId: '', expectedDamage: 0, misfirePos: fallback.misfire ? fallback.end : null }
    }
    // 壁が全て崩れた・安全な壁が無い等：以後は通常の味方狙いへフォールバック
  }

  /**
   * 結界に囲まれた対象を狙うときの狙点補正（#48・05b §4）：極（暴発点）を
   * 「リングの迎撃範囲に入る手前」＝敵側の経路上に置く。手前で暴発させれば
   * 弾自体はリングの迎撃を経験せず、AoE がリング内側（対象）へ届く。
   * ただし手前に引いた極が AoE 半径の外（リングが大きすぎる）なら成立しない＝補正しない。
   * slipThrough で同極透過できる場合も補正不要（奥まで届かせる・§7.3）。
   */
  const ringFrontAim = (pos: Vec2): Vec2 => {
    if (slipRing) return pos
    const enclosing = standingRings.find((ring) => ring.length >= 3 && ringEncloses(ring, pos))
    if (!enclosing) return pos
    const c = ringCentroid(enclosing)
    const stand = ringRadius(enclosing) + RUPTOR.ringFrontMargin
    if (stand >= FIELD.aoeRadius) return pos
    const dir = { x: c.x - enemy.pos.x, y: c.y - enemy.pos.y }
    const D = Math.hypot(dir.x, dir.y) || 1
    const back = Math.max(0, D - stand)
    return { x: enemy.pos.x + (dir.x / D) * back, y: enemy.pos.y + (dir.y / D) * back }
  }

  // 壁の手前に暴発点を引く補正（#48/#42・05b §4.6）：狙う味方が壁の奥に隠れているとき、
  // 極（暴発点）を壁の敵側の面の手前に置く。手前で暴発させれば弾は壁に阻まれず確実に暴発する。
  const wallFrontAim = (pos: Vec2): Vec2 => {
    if (obstacles.length === 0) return pos
    const dir = { x: pos.x - enemy.pos.x, y: pos.y - enemy.pos.y }
    const L = Math.hypot(dir.x, dir.y)
    if (L < 2) return pos
    const ux = dir.x / L
    const uy = dir.y / L
    let sHit = -1
    for (let s = 0.4; s <= L; s += 0.4) {
      const p = { x: enemy.pos.x + ux * s, y: enemy.pos.y + uy * s }
      if (obstacles.some((ob) => isSolidAt(ob, p))) {
        sHit = s
        break
      }
    }
    if (sHit < 0) return pos // 壁に阻まれない＝補正不要（真位置を狙う）
    const sFront = Math.max(0.5, sHit - RUPTOR.wallFrontMargin)
    return { x: enemy.pos.x + ux * sFront, y: enemy.pos.y + uy * sFront }
  }

  // 狙点候補（§12.2.1）：補正が掛かるならその1点。掛からない開けた盤面では、対象中心でなく
  // 「手前・横・奥」のヒットボックス外に極を置く候補を並べ、素通り（極到達前の通常接触）を避ける。
  const rawAim = aimOverride?.pos ?? perceivedPos(target)
  const targetId = aimOverride?.targetId ?? target.id
  // aim=極を置く点／cover=その暴発が AoE で巻き込むべき対象。
  // - 通常狙い・結界手前補正：対象の位置（点被覆）。対象中心でなく手前・横のヒットボックス外に
  //   極候補を並べ、素通り（極到達前の通常接触）を避ける（§12.2.1）。
  // - 壁越し（wallFrontAim が補正する局面）：点被覆の候補も必ず併走させる＝壁に隙間・回廊が
  //   あれば曲線で通して対象付近で暴発する方を優先し（rank のユニット被覆キー）、
  //   どうしても届かないときだけ壁面手前（素材被覆＝封印帯を削って積む）へ落とす（§14.2）。
  const aims: { aim: Vec2; cover: Cover }[] = []
  const pushPointAims = (center: Vec2) => {
    const L = dist(enemy.pos, center) || 1
    const dir = { x: (center.x - enemy.pos.x) / L, y: (center.y - enemy.pos.y) / L }
    const side = { x: -dir.y, y: dir.x }
    const front = GAME.allyHitbox + 0.9
    const lateral = GAME.allyHitbox + 1.2
    const pointCover: Cover = { kind: 'point', pos: center }
    aims.push(
      { aim: { x: center.x - dir.x * front, y: center.y - dir.y * front }, cover: pointCover },
      { aim: { x: center.x + side.x * lateral, y: center.y + side.y * lateral }, cover: pointCover },
      { aim: { x: center.x - side.x * lateral, y: center.y - side.y * lateral }, cover: pointCover },
      { aim: center, cover: pointCover },
    )
  }
  if (aimOverride) {
    aims.push({ aim: rawAim, cover: { kind: 'point', pos: rawAim } })
  } else {
    const ringAim = ringFrontAim(rawAim)
    const wallAim = wallFrontAim(ringAim)
    if (wallAim.x !== ringAim.x || wallAim.y !== ringAim.y) {
      pushPointAims(ringAim) // 隙間・回廊があれば対象付近の暴発を優先（ユニット被覆）
      aims.push({ aim: wallAim, cover: { kind: 'material' } }) // 届かなければ壁面手前で積む
    } else if (ringAim.x !== rawAim.x || ringAim.y !== rawAim.y) {
      aims.push({ aim: ringAim, cover: { kind: 'point', pos: rawAim } })
    } else {
      pushPointAims(rawAim)
    }
  }
  let best: RuptorCandidate | null = null
  for (const a of aims) {
    const found = searchAim(a.aim, a.cover)
    if (found && (!best || compareRank(found.rank, best.rank) < 0)) best = found
  }
  if (!best) return null
  return {
    trajectory: best.traj,
    targetId,
    expectedDamage: 0,
    // 極に到達し失速しない候補だけが実際に暴発する（予告もそれに合わせる・§14.2）
    misfirePos: best.misfire ? best.end : null,
  }
}
