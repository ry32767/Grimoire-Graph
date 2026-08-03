// 守護型（guardian・#71／05b §5.4）の結界計画。純粋関数。
// 満たすべき条件（この順に優先する）：
//   ① 障害物の素材に**絶対に触れない**（周回は一度触れただけで丸ごと霧散するため・#34）
//   ② 自分と**近くの味方**を覆う（覆った味方は迎撃に守られ、光なら毎ターン回復する・#61）
//   ③ 既に自分が張っている結界と**同じ結界は張らない**（別形状を重ねて層を増やす。上限まで
//      達したら同じ結界を張り直して速度を回復させる＝迎撃で失速した結界の再展開）
//   ④ 外形（フーリエ項数）と z 場（多重余弦・exp の積・過励起）の複雑さは LVL で決まる（#70 と同じ）
// 外形は guardianShape（角度ごとの半径プロファイル→フーリエフィット）、z 場は guardianZ
// （本番物理で採点）に分け、ここでは候補の組み立て・順位づけ・最終検証を行う。
import type { Ally, Enemy, Obstacle, Trajectory, Vec2 } from '../types'
import { buildRing, ringEncloses, type RingPoint } from '../orbit'
import { COMBAT, ENEMY_GUARD_PLANNING as GP, GAME } from '../../data/constants'
import { threatScore } from './perception'
import { aimAt } from './trajectories'
import { guardTierFor } from './guardianTier'
import {
  coverRequirement,
  fourierProfile,
  freeRadiusProfile,
  guardAngles,
  profileGap,
  radialProfile,
  ringClearsMaterial,
  type CoverTarget,
} from './guardianShape'
import { guardZCandidates, pickGuardZ, uniformGuardZ } from './guardianZ'
import type { EnemyPlan } from '../enemyAI'

/** 守護型が結界を組むのに要る周辺情報。 */
export interface GuardianContext {
  /** 脅威方向 φ_threat の判定に使う（見えている味方のうち最も脅威度が高い者の方向） */
  allies: Ally[]
  obstacles: Obstacle[]
  /** 自陣の味方（覆う対象）。自分自身が含まれていてよい */
  teammates: { id: string; pos: Vec2; hp: number; hitboxRadius?: number }[]
  /** 自分が既に展開している結界（#71 ③：同じ結界の重ね張りを避ける） */
  ownRings?: RingPoint[][]
  fieldR?: number
}

/** 外形の候補（半径関数＋順位づけ用の情報）。 */
interface ShapeCandidate {
  f: (theta: number) => number
  /** 覆える味方の id（自分は含まない） */
  covered: string[]
  /** 平均半径（同点時に基準半径へ近いものを選ぶ） */
  meanR: number
}

/**
 * 脅威方向 φ_threat（05b §5.4・#47）：見えている味方のうち最も脅威度の高い者の方向。
 * 方向づけられた場（directedAura）を持たない個体は方向を持たない＝一様な場を張る。
 */
function threatDirection(enemy: Enemy, allies: Ally[]): number | null {
  if (!enemy.directedAura) return null
  const visible = allies.filter((a) => a.hp > 0 && (a.concealed ?? 0) < COMBAT.orbitConcealFull)
  if (visible.length === 0) return null
  const t = visible.reduce((best, a) => (threatScore(a) > threatScore(best) ? a : best))
  return aimAt(enemy.pos, t.pos)
}

/** 半径関数を角度サンプル上で評価する。 */
function sampleF(f: (t: number) => number, angles: number[]): number[] {
  return angles.map((a) => f(a))
}

/** 星形（origin から見て一意な半径）の閉曲線なので、味方が内側かは f(φ) と距離の比較で決まる。 */
function coveredBy(f: (t: number) => number, origin: Vec2, mates: CoverTarget[], ids: string[]): string[] {
  const out: string[] = []
  mates.forEach((m, i) => {
    const dx = m.pos.x - origin.x
    const dy = m.pos.y - origin.y
    const d = Math.hypot(dx, dy)
    if (f(Math.atan2(dy, dx)) >= d + m.radius + GP.coverMargin) out.push(ids[i])
  })
  return out
}

/**
 * 目標プロファイルを「どの角度でも自由半径を超えない」フーリエ級数へフィットする（#71 ①）。
 * 有限項の級数は目標の段差を少し超えて振動するので、超えた角度の目標を下げて再フィットする
 * ことを数回繰り返す（制約への投影）。全角度で上限以下・下限以上に収まらなければ null。
 */
function constrainedFit(
  desired: number[],
  free: number[],
  angles: number[],
  terms: number,
): { f: (t: number) => number; meanR: number } | null {
  let target = desired.slice()
  for (let pass = 0; pass < GP.fitPasses; pass++) {
    const f = fourierProfile(target, angles, terms)
    const vals = sampleF(f, angles)
    if (vals.some((v) => !Number.isFinite(v))) return null
    const over = vals.map((v, i) => v - free[i])
    if (over.every((o) => o <= 0) && vals.every((v) => v >= GP.minRadius)) {
      return { f, meanR: vals.reduce((s, v) => s + v, 0) / vals.length }
    }
    // 超過ぶん（＋わずかな余裕）だけ目標を引き下げて再フィット。下限は結界の最小半径
    target = target.map((v, i) => (over[i] > 0 ? Math.max(GP.minRadius, v - over[i] - 0.1) : v))
  }
  return null
}

/** 外形候補を組み立てる（覆う相手の部分集合 × 基準半径ラダー × 真円/フーリエ）。 */
function buildShapeCandidates(
  origin: Vec2,
  mates: { id: string; target: CoverTarget }[],
  free: number[],
  angles: number[],
  shapeTerms: number,
  maxR: number,
): ShapeCandidate[] {
  const minFree = Math.min(...free)
  const ids = mates.map((m) => m.id)
  const targets = mates.map((m) => m.target)
  const out: ShapeCandidate[] = []
  // 同じ半径の真円が候補に何本も並ぶと（半径ラダーが自由半径で頭打ちになるため）検証枠を食い潰す
  const seenCircles = new Set<string>()
  for (let k = 0; k <= mates.length; k++) {
    const req = coverRequirement(origin, targets.slice(0, k), angles)
    // 覆うのに必要な半径が自由半径を超える＝間に壁がある。この組み合わせは諦める（①を絶対に守る）
    if (req.some((r, i) => r > free[i])) continue
    const needR = Math.max(0, ...req)
    for (const scale of GP.radiusScales) {
      const R0 = Math.min(maxR, Math.max(GP.minRadius, GAME.enemyGuardRadius * scale))
      // 真円候補：素材に触れない最大半径（minFree）を超えない範囲で、要求半径と基準半径を満たす
      const circleR = Math.min(Math.max(needR, R0), minFree)
      const key = `${k}:${circleR.toFixed(2)}`
      if (circleR >= Math.max(needR, GP.minRadius) && !seenCircles.has(key)) {
        seenCircles.add(key)
        const f = () => circleR
        out.push({ f, covered: coveredBy(f, origin, targets, ids), meanR: circleR })
      }
      if (shapeTerms <= 0) continue
      // フーリエ候補：角度ごとの理想半径（味方を覆う下限 ⊂ 素材に触れない上限）へフィットする
      const desired = angles.map((_, i) => Math.min(Math.max(req[i], R0), free[i]))
      const fit = constrainedFit(desired, free, angles, shapeTerms)
      if (!fit) continue
      out.push({ f: fit.f, covered: coveredBy(fit.f, origin, targets, ids), meanR: fit.meanR })
    }
  }
  return out
}

/**
 * 守護型の結界を計画する（#71）。
 * どの候補も素材に触れずに張れないときは **null（＝この敵はこのターン結界を張らない）** を返す。
 * 触れる結界は張った瞬間に霧散して無駄になるため、張らない方が常に良い。
 */
export function planGuardianBarrier(enemy: Enemy, ctx: GuardianContext): EnemyPlan | null {
  const tier = guardTierFor(enemy.level)
  const sign: 1 | -1 = enemy.guardZSign ?? (enemy.element === 'dark' ? -1 : 1)
  const origin = enemy.pos
  const angles = guardAngles()
  const maxR = GAME.enemyGuardRadius * Math.max(...GP.radiusScales)
  const free = freeRadiusProfile(origin, ctx.obstacles, maxR, angles)
  // 覆う候補（生存する自陣の味方・近い順）。どの半径でも届かない相手は最初から外す
  const mates = ctx.teammates
    .filter((t) => t.id !== enemy.id && t.hp > 0)
    .map((t) => ({
      id: t.id,
      target: { pos: t.pos, radius: t.hitboxRadius ?? GAME.enemyHitbox } as CoverTarget,
      d: Math.hypot(t.pos.x - origin.x, t.pos.y - origin.y),
    }))
    .filter((m) => m.d + m.target.radius + GP.coverMargin <= maxR)
    .sort((a, b) => a.d - b.d)
  const candidates = buildShapeCandidates(origin, mates, free, angles, tier.shapeTerms, maxR)
  if (candidates.length === 0) return null

  // 既存の自前結界（#71 ③）：同形状は「重ね張り」にならないので避ける。上限枚数まで達していたら
  // 逆に同形状を選び直す＝張り直して速度を回復させる（迎撃で失速した結界の再展開）
  const ownRings = (ctx.ownRings ?? []).filter((r) => r.length >= 3)
  const ownProfiles = ownRings.map((r) => radialProfile(r.map((p) => p.pos), origin, angles))
  const atCapacity = ownRings.length >= tier.maxLayers
  const alreadyCovered = new Set<string>()
  for (const ring of ownRings) {
    for (const m of mates) if (ringEncloses(ring, m.target.pos)) alreadyCovered.add(m.id)
  }
  const ranked = candidates
    .map((c) => {
      const prof = sampleF(c.f, angles)
      const dup = ownProfiles.some((op) => profileGap(prof, op) < GP.distinctRadius)
      const newCover = c.covered.filter((id) => !alreadyCovered.has(id)).length
      const rank = [
        atCapacity ? (dup ? 0 : 1) : dup ? 1 : 0,
        -newCover,
        -c.covered.length,
        Math.abs(c.meanR - GAME.enemyGuardRadius),
      ]
      return { c, rank }
    })
    .sort((x, y) => {
      for (let i = 0; i < x.rank.length; i++) if (x.rank[i] !== y.rank[i]) return x.rank[i] - y.rank[i]
      return 0
    })

  // 上位候補から順に、**本番と同じリング点列**で素材に触れないことを確かめる（①の最終保証）。
  // 上位が全滅したときの最後の砦として、最も小さい（最も安全な）候補も必ず1本試す。
  const safest = candidates.reduce((lo, c) => (c.meanR < lo.meanR ? c : lo))
  const order = [...ranked.slice(0, GP.rankedVerifyLimit).map((r) => r.c), safest]
  const threatPhi = threatDirection(enemy, ctx.allies)
  for (const c of order) {
    const probe: Trajectory = { mode: 'polar', f: c.f, origin, z: uniformGuardZ(sign), fieldR: ctx.fieldR }
    const ring = buildRing(probe)
    if (ring.length < 3) continue
    if (!ringClearsMaterial(ring.map((p) => p.pos), ctx.obstacles, origin, GP.verifyMargin)) continue
    // 外形が決まったら z 場を最適化する（LVL 段階ぶんの候補を本番物理で採点・#71 ④）
    const zChoice = pickGuardZ(
      c.f,
      origin,
      enemy.castInitialSpeed,
      guardZCandidates(sign, threatPhi, tier),
      threatPhi,
      ctx.fieldR,
    )
    const traj: Trajectory = {
      mode: 'polar',
      f: c.f,
      origin,
      z: zChoice?.z ?? uniformGuardZ(sign),
      fieldR: ctx.fieldR,
    }
    return { trajectory: traj, targetId: '', expectedDamage: 0 }
  }
  return null
}
