// エンドロール（DC プロトタイプ v3 の _drawEndroll を移植）。
// 「本物の敵AI同士が撃ち合う」自動対戦をクレジットの背景として流す。
// 計画は本番と同じ planEnemyShots、飛行は enemyFlight → traverseObstacles、
// 相殺は resolveParry、結界の迎撃は ringInterception。ロジックは一切書き換えない（読むだけ）。
import type { Ally, Attribute, CarveBurst, Enemy, EnemyFamily, EnemyRole, Flight, Obstacle, Trajectory, Vec2 } from '../game/types'
import { FIELD, GAME } from '../data/constants'
import { toScreen, type Viewport } from '../game/coords'
import { planEnemyShots, enemyFlight } from '../game/enemyAI'
import { traverseObstacles } from '../game/turn'
import { flightTimes } from '../game/physics'
import { attributeOf, strengthOf, affinityMultiplier, zfieldAt } from '../game/attribute'
import { attachRingSpeeds, buildRing, ringInterception, type RingPoint } from '../game/orbit'
import { resolveParry } from '../game/parry'
import { drawObstacles, drawBullet, drawCarveBurst, drawMisfire, drawOrbitDissipation, drawDamageNumber, strokeZPath, drawParticle } from './draw'
import { TOKENS } from './palette'

const TAU = Math.PI * 2
const MAX_LEVEL = 5
const START_HP = 140
const POS_A: Vec2 = { x: -16, y: -6 }
const POS_B: Vec2 = { x: 15, y: 5 }
/** 弾が飛ぶ見かけの秒数（実飛行秒 → 画面秒の倍率をここから決める） */
const FLIGHT_SEC = 3.4
const FIRE_AT = 0.45

type Side = 'A' | 'B'

interface Shot {
  side: Side
  traj: Trajectory
  samples: Flight['samples']
  times: number[]
  total: number
  carves: (CarveBurst & { t?: number })[]
  misfirePos: Vec2 | null
  /** 発射時刻（画面秒）と時間倍率 */
  at: number
  k: number
  dead?: boolean
  hitDone?: boolean
}

interface RingRec {
  ring: RingPoint[]
  lite: RingPoint[]
  brokenAt: number | null
  bornBout: number
}

interface Bout {
  shots: Shot[]
  hits: { victim: Side; dmg: number; pos: Vec2; t: number; attr: Attribute; misfire?: boolean; done?: boolean }[]
  clashes: { pos: Vec2; t: number; power: number }[]
  blocks: { pos: Vec2; t: number; broke: boolean }[]
  blasts: { pos: Vec2; t: number; r: number }[]
  duration: number
  ko?: number
  koSide?: Side
  next?: { lvA: number; lvB: number; hpA: number; hpB: number; obstacles: Obstacle[] }
  carvesKept?: boolean
}

/** 1 フレームに 1 手だけ進めるための計画ジョブ。 */
interface PlanJob {
  side: Side
  guard: boolean
  role: EnemyRole
}

export interface EndrollState {
  lvA: number
  lvB: number
  hpA: number
  hpB: number
  bout: number
  obstacles: Obstacle[]
  ringA: RingRec | null
  ringB: RingRec | null
  round: Bout | null
  t0: number
  banner: 'lvup' | 'reset' | null
  /** 次の幕を先取りで計画するためのキュー */
  pre: { jobs: PlanJob[]; i: number; shots: Shot[]; guards: { side: Side; traj: Trajectory }[] } | null
}

const rnd = () => Math.random()

/** 線分が円に触れるか（直線で直接届く経路が残っていないかを確かめる）。 */
function segHitsCircle(a: Vec2, b: Vec2, c: Vec2, r: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = dx * dx + dy * dy
  let t = L > 0 ? ((c.x - a.x) * dx + (c.y - a.y) * dy) / L : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y) <= r
}

/** 壁は決着ごとに引き直す。LVL が上がるほど本数が増え、直進では届かない配置にする。 */
function makeObstacles(level: number): Obstacle[] {
  const n = Math.min(8, level + 1)
  const kinds: NonNullable<Obstacle['kind']>[] = ['normal', 'normal', 'fragile', 'tough']
  const out: Obstacle[] = []
  const mk = (x: number, y: number, r: number, i: number): Obstacle => ({
    id: `ew${level}-${i}-${Math.floor(rnd() * 1e6)}`,
    element: (rnd() < 0.45 ? (rnd() < 0.5 ? 'light' : 'dark') : 'neutral') as Attribute,
    kind: kinds[Math.floor(rnd() * kinds.length)],
    solids: [{ x, y, r }],
    carves: [],
  })
  const free = (x: number, y: number, r: number) =>
    Math.hypot(x - POS_A.x, y - POS_A.y) > r + 4.5 &&
    Math.hypot(x - POS_B.x, y - POS_B.y) > r + 4.5 &&
    out.every((o) => Math.hypot(x - o.solids[0].x, y - o.solids[0].y) > r + o.solids[0].r + 1.4)
  // 1本目：必ず視線の真ん中に置く（迂回か掘削でしか通れない）
  const ux = POS_B.x - POS_A.x
  const uy = POS_B.y - POS_A.y
  const len = Math.hypot(ux, uy)
  const nx = -uy / len
  const ny = ux / len
  for (let k = 0; k < 60; k++) {
    const t = 0.34 + rnd() * 0.32
    const r = 1.7 + rnd() * 1.1
    const off = (rnd() * 2 - 1) * r * 0.55
    const x = POS_A.x + ux * t + nx * off
    const y = POS_A.y + uy * t + ny * off
    if (free(x, y, r)) {
      out.push(mk(x, y, r, 0))
      break
    }
  }
  for (let i = out.length; i < n; i++) {
    for (let k = 0; k < 50; k++) {
      const a = rnd() * TAU
      const d = 3 + rnd() * 10.5
      const x = Math.cos(a) * d
      const y = Math.sin(a) * d * 0.75
      const r = 1.2 + rnd() * 1.5
      if (free(x, y, r)) {
        out.push(mk(x, y, r, i))
        break
      }
    }
  }
  // 念のため：それでも直線が通っていたら中点に一本足す
  if (!out.some((o) => segHitsCircle(POS_A, POS_B, o.solids[0], o.solids[0].r))) {
    out.push(mk((POS_A.x + POS_B.x) / 2, (POS_A.y + POS_B.y) / 2, 1.9, 99))
  }
  return out
}

/** LVL ごとの同時発射数。 */
const shotCount = (lv: number) => [1, 2, 2, 3, 3][Math.min(4, Math.max(0, lv - 1))]

/**
 * 戦い方の配分。低 LVL は火力型（直進で押す）と迂回型（曲げて回す）をぶつける。
 * 高 LVL は 1 発を結界（guardian）に回すので、攻めの手数はその分減る。
 */
function rolePool(side: Side, lv: number, bout: number): EnemyRole[] {
  const aggro = (side === 'A') === (bout % 2 === 0)
  const r0: EnemyRole = aggro ? 'breaker' : 'attacker'
  const r1: EnemyRole = aggro ? 'attacker' : 'breaker'
  const n = shotCount(lv)
  const pool: EnemyRole[] = []
  if (lv >= 4) pool.push('guardian')
  while (pool.length < n) pool.push(pool.length % 2 ? (lv >= MAX_LEVEL ? 'ruptor' : r1) : r0)
  return pool.slice(0, n)
}

const FAMILY_TABLE: { A: EnemyFamily[]; B: EnemyFamily[] }[] = [
  { A: ['line', 'arc'], B: ['arc', 'line'] },
  { A: ['arc', 'wave'], B: ['wave', 'exp'] },
  { A: ['wave', 'exp'], B: ['spiral', 'arc'] },
  { A: ['spiral', 'poly34', 'abs'], B: ['abs', 'wave', 'exp'] },
  { A: ['harmonic', 'wave', 'exp'], B: ['poly34', 'spiral', 'harmonic'] },
]

/** LVL ごとの個体像。本番の敵と同じ形で組み、実際の敵AIへそのまま渡す。 */
function makeMage(s: EndrollState, side: Side, bout: number): Enemy {
  const lv = side === 'A' ? s.lvA : s.lvB
  const fam = FAMILY_TABLE[Math.min(4, Math.max(0, lv - 1))]
  const mag = (2.7 + lv * 0.36) * (0.92 + rnd() * 0.18)
  const fams = (side === 'A' ? fam.A : fam.B).slice().sort(() => rnd() - 0.5)
  const pool = rolePool(side, lv, bout)
  const el: Attribute = side === 'A' ? 'light' : 'dark'
  const sg = side === 'A' ? 1 : -1
  return {
    id: `m${side}`,
    name: side === 'A' ? 'LIGHT MAGE' : 'DARK MAGE',
    pos: side === 'A' ? POS_A : POS_B,
    hp: side === 'A' ? s.hpA : s.hpB,
    maxHp: START_HP,
    element: el,
    hitboxRadius: GAME.enemyHitbox,
    statuses: [],
    family: fams[0],
    families: fams,
    role: pool[0],
    castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
    castInitialSpeed: FIELD.fixedSpeed,
    castZ: sg * mag,
    // 結界は幕ごとに極性を入れ替える（張り替えで裏をかける＝結界が本当に弾を止める）
    guardZSign: (bout % 2 === 0 ? sg : -sg) as 1 | -1,
    castCount: pool.length,
    patternPool: pool,
    // すり抜け（結界と同極に合わせて透過する高難度個体）は最上位だけ
    slipThrough: lv >= MAX_LEVEL,
    directedAura: lv >= MAX_LEVEL,
    species: side === 'A' ? 'wraith' : 'oni',
    level: Math.min(7, lv + 2),
  }
}

/** 発散寸前のサンプルは飛び飛びに跳ぶので、破綻した所で切る（見た目のワープ防止）。 */
function tameCount(samples: Flight['samples']): number {
  const MAXSEG = 1.6
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].pos
    const b = samples[i].pos
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (!Number.isFinite(seg) || !Number.isFinite(b.x) || !Number.isFinite(b.y) || seg > MAXSEG) {
      return Math.max(2, i)
    }
  }
  return samples.length
}

/** AI が返した軌道を本番と同じ手順で飛ばす（enemyFlight → traverseObstacles）。 */
function shotFromPlan(s: EndrollState, side: Side, traj: Trajectory): Shot | null {
  let flight: Flight
  let carves: CarveBurst[] = []
  try {
    flight = enemyFlight(traj, FIELD.fixedSpeed).flight
    if (s.obstacles.length) {
      const tr = traverseObstacles(
        traj,
        FIELD.fixedSpeed,
        flight,
        s.obstacles.map((o) => ({ ...o, carves: [...o.carves] })),
      )
      flight = tr.flight
      carves = tr.carves
    }
  } catch {
    return null
  }
  const raw = flight.samples
  const samples = raw.slice(0, tameCount(raw))
  if (samples.length < 2) return null
  const times = flightTimes(samples)
  const total = times[times.length - 1]
  const last = samples[samples.length - 1]
  return {
    side,
    traj,
    samples,
    times,
    total: Number.isFinite(total) && total > 0 ? total : 1,
    carves,
    misfirePos: flight.end === 'invalid' ? { x: last.pos.x, y: last.pos.y } : null,
    at: FIRE_AT,
    k: 1,
  }
}

/** 味方（＝相手の術者）として AI に見せる 1 人ぶん。 */
function asAlly(e: Enemy): Ally {
  return {
    id: e.id,
    name: e.name,
    pos: e.pos,
    hp: e.hp,
    maxHp: e.maxHp,
    element: e.element,
    statuses: [],
  } as Ally
}

/** 次の幕ぶんの「一手」リスト（弾 1 発ずつ・結界 1 枚ずつ）。 */
function makeJobs(s: EndrollState, bout: number): PlanJob[] {
  const out: PlanJob[] = []
  for (const side of ['A', 'B'] as Side[]) {
    const lv = side === 'A' ? s.lvA : s.lvB
    const pool = rolePool(side, lv, bout)
    if (pool.includes('guardian')) out.push({ side, guard: true, role: 'guardian' })
    for (const role of pool.filter((r) => r !== 'guardian')) out.push({ side, guard: false, role })
  }
  return out
}

/** 一手だけ計画する（本番の敵AIを castCount:1 で呼ぶ）。false を返したら同じジョブを次フレームへ持ち越す。 */
function planOne(
  s: EndrollState,
  job: PlanJob,
  bout: number,
  bucket: { shots: Shot[]; guards: { side: Side; traj: Trajectory }[] },
): boolean {
  const me = makeMage(s, job.side, bout)
  const foe = makeMage(s, job.side === 'A' ? 'B' : 'A', bout)
  const allies = [asAlly(foe)]
  const foeRing = job.side === 'A' ? s.ringB : s.ringA
  const rings = foeRing && foeRing.brokenAt === null ? [foeRing.lite] : []
  const one: Enemy = { ...me, role: job.role, castCount: 1, patternPool: [job.role] }
  let plan
  try {
    plan = planEnemyShots(one, allies, s.obstacles, rings, [], FIELD.rField, 0)[0]
  } catch {
    plan = undefined
  }
  if (job.guard) {
    if (plan?.trajectory) bucket.guards.push({ side: job.side, traj: plan.trajectory })
    return true
  }
  const shot = plan ? shotFromPlan(s, job.side, plan.trajectory) : null
  if (shot) {
    bucket.shots.push(shot)
    return true
  }
  // 暴発型などは手が見つからないことがある。次フレームに迂回型で撃ち直す
  if (job.role !== 'attacker') {
    job.role = 'attacker'
    return false
  }
  return true
}

/** 結界の迎撃：本番と同じ ringInterception → resolveParry。同極はすり抜ける。 */
function ringBlock(shot: Shot, rec: RingRec | null): { i: number; pos: Vec2; stop: boolean; breakRing: boolean } | null {
  if (!rec || rec.ring.length < 3 || rec.brokenAt !== null) return null
  let it
  try {
    it = ringInterception(rec.ring, shot.samples.map((q) => q.pos))
  } catch {
    return null
  }
  if (!it.crossed || !it.pos) return null
  const hit = it.pos
  let bi = 1
  let bd = Number.POSITIVE_INFINITY
  shot.samples.forEach((q, i) => {
    if (i === 0) return
    const d = Math.hypot(q.pos.x - hit.x, q.pos.y - hit.y)
    if (d < bd) {
      bd = d
      bi = i
    }
  })
  let ri = 0
  let rd = Number.POSITIVE_INFINITY
  rec.ring.forEach((q, i) => {
    const d = Math.hypot(q.pos.x - hit.x, q.pos.y - hit.y)
    if (d < rd) {
      rd = d
      ri = i
    }
  })
  const q = shot.samples[bi]
  const rp = rec.ring[ri]
  const z = zfieldAt(shot.traj, q.pos)
  const pr = resolveParry(
    attributeOf(z),
    q.speed,
    q.speed * strengthOf(z),
    attributeOf(rp.z),
    rp.speed ?? 0,
    (rp.speed ?? 0) * strengthOf(rp.z),
  )
  if (pr.passthrough) return null
  return { i: bi, pos: { x: hit.x, y: hit.y }, stop: pr.vanishA, breakRing: pr.vanishB }
}

/** 弾どうしの相殺（同じ画面時刻に同じ場所で判定する）。 */
function clashBetween(a: Shot, b: Shot): { pos: Vec2; t: number; power: number } | null {
  const CD = 1.2
  const ta = (i: number) => a.at + a.times[Math.min(i, a.times.length - 1)] * a.k
  const tb = (j: number) => b.at + b.times[Math.min(j, b.times.length - 1)] * b.k
  let j = 0
  for (let i = 0; i < a.samples.length; i++) {
    const t = ta(i)
    while (j < b.samples.length - 1 && tb(j) < t) j++
    const A = a.samples[i].pos
    const B = b.samples[j].pos
    if (Math.abs(tb(j) - t) < 0.08 && Math.hypot(A.x - B.x, A.y - B.y) <= CD) {
      const sa = a.samples[i]
      const sb = b.samples[j]
      const za = zfieldAt(a.traj, sa.pos)
      const zb = zfieldAt(b.traj, sb.pos)
      const pr = resolveParry(
        attributeOf(za),
        sa.speed,
        sa.speed * strengthOf(za),
        attributeOf(zb),
        sb.speed,
        sb.speed * strengthOf(zb),
      )
      if (pr.passthrough) return null
      if (pr.vanishA) {
        a.samples = a.samples.slice(0, Math.max(2, i + 1))
        a.dead = true
      }
      if (pr.vanishB) {
        b.samples = b.samples.slice(0, Math.max(2, j + 1))
        b.dead = true
      }
      for (const sh of [a, b]) {
        sh.times = flightTimes(sh.samples)
        const tt = sh.times[sh.times.length - 1]
        if (Number.isFinite(tt) && tt > 0) sh.total = tt
      }
      return {
        pos: { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 },
        t,
        power: sa.speed * strengthOf(za) + sb.speed * strengthOf(zb),
      }
    }
  }
  return null
}

/** 前の幕で削れたぶんを壁へ残す。 */
function keepCarves(s: EndrollState): void {
  const R = s.round
  if (!R || R.carvesKept) return
  for (const sh of R.shots) {
    for (const c of sh.carves) {
      const o = s.obstacles.find((q) => q.id === c.obstacleId)
      if (o) o.carves.push({ x: c.pos.x, y: c.pos.y, r: c.r })
    }
  }
  R.carvesKept = true
}

/** 幕を組み立てる（結界の迎撃 → 命中 → 弾どうしの相殺 → 暴発 の順に解く）。 */
function startBout(s: EndrollState, now: number): void {
  s.bout++
  if (s.round && !s.round.carvesKept) keepCarves(s)
  const bucket = s.pre ?? { shots: [], guards: [], jobs: [], i: 0 }
  // 先取りが間に合っていない手はここで補う
  const jobs = s.pre?.jobs ?? makeJobs(s, s.bout)
  for (let i = s.pre?.i ?? 0, guard = 0; i < jobs.length && guard < 24; guard++) {
    if (planOne(s, jobs[i], s.bout, bucket)) i++
  }
  s.pre = null
  const shots = bucket.shots

  // 新しい結界を確定（同時詠唱なので張ったその幕から効く）
  for (const g of bucket.guards) {
    let ring: RingPoint[] | null = null
    try {
      ring = attachRingSpeeds(buildRing(g.traj), FIELD.fixedSpeed)
    } catch {
      ring = null
    }
    if (ring && ring.length >= 3) {
      const st = Math.max(1, Math.floor(ring.length / 24))
      const rec: RingRec = { ring, lite: ring.filter((_, i) => i % st === 0), brokenAt: null, bornBout: s.bout }
      if (g.side === 'A') s.ringA = rec
      else s.ringB = rec
    }
  }

  if (shots.length === 0) {
    s.round = { shots: [], hits: [], clashes: [], blocks: [], blasts: [], duration: 1.6 }
    s.t0 = now
    return
  }
  const k = FLIGHT_SEC / Math.max(0.25, ...shots.map((q) => q.total))
  shots.forEach((sh, i) => {
    sh.k = k
    sh.at = FIRE_AT + (i % 3) * 0.05
  })
  const timeAt = (sh: Shot, arc: number) => {
    let i = 0
    while (i < sh.samples.length - 1 && sh.samples[i].arcLen < arc) i++
    const t = sh.times[Math.min(i, sh.times.length - 1)]
    return sh.at + (Number.isFinite(t) ? t : sh.total) * sh.k
  }
  const cut = (sh: Shot, i: number) => {
    sh.samples = sh.samples.slice(0, Math.max(2, i + 1))
    sh.times = flightTimes(sh.samples)
    const t = sh.times[sh.times.length - 1]
    if (Number.isFinite(t) && t > 0) sh.total = t
  }

  // 結界の迎撃
  const blocks: Bout['blocks'] = []
  for (const sh of shots) {
    const rec = sh.side === 'A' ? s.ringB : s.ringA
    const bl = ringBlock(sh, rec)
    if (!bl) continue
    const t = timeAt(sh, sh.samples[Math.min(bl.i, sh.samples.length - 1)].arcLen)
    if (bl.stop) {
      cut(sh, bl.i)
      sh.misfirePos = null
      sh.dead = true
    }
    if (bl.breakRing && rec && rec.brokenAt === null) rec.brokenAt = t
    blocks.push({ pos: bl.pos, t, broke: bl.breakRing })
  }

  // 命中
  const hits: Bout['hits'] = []
  const blasts: Bout['blasts'] = []
  for (const sh of shots) {
    if (sh.dead) continue
    const tgt = sh.side === 'A' ? POS_B : POS_A
    const tel: Attribute = sh.side === 'A' ? 'dark' : 'light'
    for (let i = 1; i < sh.samples.length; i++) {
      const q = sh.samples[i]
      if (q.speed > 0.6 && Math.hypot(q.pos.x - tgt.x, q.pos.y - tgt.y) <= GAME.enemyHitbox) {
        const z = zfieldAt(sh.traj, q.pos)
        const at = attributeOf(z)
        const dmg = Math.max(3, Math.round(q.speed * strengthOf(z) * affinityMultiplier(at, tel)))
        hits.push({
          victim: sh.side === 'A' ? 'B' : 'A',
          dmg,
          pos: { x: tgt.x, y: tgt.y },
          t: timeAt(sh, q.arcLen),
          attr: at,
        })
        cut(sh, i)
        sh.misfirePos = null
        sh.hitDone = true
        break
      }
    }
  }

  // 弾どうしの相殺
  const clashes: Bout['clashes'] = []
  for (const a of shots.filter((q) => q.side === 'A')) {
    for (const b of shots.filter((q) => q.side === 'B')) {
      if (a.dead || b.dead || a.hitDone || b.hitDone) continue
      const c = clashBetween(a, b)
      if (c) clashes.push(c)
    }
  }
  // 削りは弾が届いた時刻へ同期させる
  for (const sh of shots) {
    const endArc = sh.samples[sh.samples.length - 1].arcLen + 1e-6
    sh.carves = sh.carves.filter((c) => c.arcLen <= endArc)
    for (const c of sh.carves) c.t = timeAt(sh, c.arcLen)
  }
  // 暴発（AoE に入っている術者は巻き込まれる）
  for (const sh of shots) {
    if (!sh.misfirePos) continue
    const mp = sh.misfirePos
    const t = timeAt(sh, sh.samples[sh.samples.length - 1].arcLen)
    blasts.push({ pos: mp, t, r: FIELD.aoeRadius })
    for (const [side, p] of [['A', POS_A] as const, ['B', POS_B] as const]) {
      const d = Math.hypot(p.x - mp.x, p.y - mp.y)
      if (d <= FIELD.aoeRadius) {
        hits.push({
          victim: side,
          dmg: Math.round(8 + 20 * (1 - d / FIELD.aoeRadius)),
          pos: { x: p.x, y: p.y },
          t: t + 0.14,
          attr: 'neutral',
          misfire: true,
        })
      }
    }
  }

  const fin = (x: number) => Number.isFinite(x)
  const ends = shots.filter((q) => fin(q.at) && fin(q.total)).map((q) => q.at + q.total * q.k)
  const H = hits.filter((q) => fin(q.t))
  const C = clashes.filter((q) => fin(q.t))
  const B = blocks.filter((q) => fin(q.t))
  const BL = blasts.filter((q) => fin(q.t))
  const last = Math.max(FIRE_AT + 0.8, ...ends, ...H.map((q) => q.t), ...C.map((q) => q.t), ...B.map((q) => q.t))
  s.round = {
    shots,
    hits: H,
    clashes: C,
    blocks: B,
    blasts: BL,
    duration: Math.min(14, (fin(last) ? last : FIRE_AT + 0.8) + 1.3),
  }
  s.t0 = now
}

/** 新しいエンドロールを開始する。 */
export function createEndroll(now: number): EndrollState {
  const s: EndrollState = {
    lvA: 1,
    lvB: 1,
    hpA: START_HP,
    hpB: START_HP,
    bout: 0,
    obstacles: [],
    ringA: null,
    ringB: null,
    round: null,
    t0: now,
    banner: null,
    pre: null,
  }
  s.obstacles = makeObstacles(1)
  startBout(s, now)
  return s
}

/** 幕を進める。やられた側だけが LVL を上げて全回復し、壁は別配置に組み直す。 */
function tick(s: EndrollState, now: number): number {
  const R = s.round
  if (!R) return 0
  const lt = (now - s.t0) / 1000
  for (const h of R.hits) {
    if (h.done || lt < h.t) continue
    h.done = true
    if (h.victim === 'A') s.hpA = Math.max(0, s.hpA - h.dmg)
    else s.hpB = Math.max(0, s.hpB - h.dmg)
  }
  if (R.ko === undefined && (s.hpA <= 0 || s.hpB <= 0)) {
    R.ko = lt
    R.koSide = s.hpA <= 0 ? 'A' : 'B'
    R.duration = lt + 3.0
    for (const h of R.hits) h.done = true // 決着後に届くダメージは無かったことにする
    const lv = R.koSide === 'A' ? s.lvA : s.lvB
    s.banner = lv >= MAX_LEVEL ? 'reset' : 'lvup'
    const next = { lvA: s.lvA, lvB: s.lvB, hpA: s.hpA, hpB: s.hpB, obstacles: s.obstacles }
    if (lv >= MAX_LEVEL) {
      next.lvA = 1
      next.lvB = 1
      next.hpA = START_HP
      next.hpB = START_HP
    } else if (R.koSide === 'A') {
      next.lvA = s.lvA + 1
      next.hpA = START_HP
    } else {
      next.lvB = s.lvB + 1
      next.hpB = START_HP
    }
    next.obstacles = makeObstacles(Math.max(next.lvA, next.lvB))
    R.next = next
    s.pre = null
  }
  // 幕の尻尾で次の幕の計画を 1 フレーム 1 手ずつ進めておく（切り替わりで描画が止まらない）
  if (lt > R.duration - 2.4) {
    if (!R.next && !R.carvesKept) keepCarves(s)
    if (!s.pre) s.pre = { jobs: makeJobs(s, s.bout + 1), i: 0, shots: [], guards: [] }
    else if (s.pre.i < s.pre.jobs.length) {
      if (planOne(s, s.pre.jobs[s.pre.i], s.bout + 1, s.pre)) s.pre.i++
    }
  }
  if (lt >= R.duration) {
    if (R.ko !== undefined) {
      const nx = R.next
      if (nx) {
        s.lvA = nx.lvA
        s.lvB = nx.lvB
        s.hpA = nx.hpA
        s.hpB = nx.hpB
        s.obstacles = nx.obstacles
      }
      s.ringA = null
      s.ringB = null
      s.banner = null
      s.round = null
    } else {
      if (s.ringA && s.ringA.brokenAt !== null) s.ringA = null
      if (s.ringB && s.ringB.brokenAt !== null) s.ringB = null
    }
    startBout(s, now)
    return 0
  }
  return lt
}

const col = (attr: Attribute, a = 1) =>
  attr === 'light' ? `rgba(244,196,48,${a})` : attr === 'dark' ? `rgba(138,111,214,${a})` : `rgba(150,160,180,${a})`

/** エンドロールを 1 フレーム描く。 */
export function drawEndroll(
  ctx: CanvasRenderingContext2D,
  s: EndrollState,
  w: number,
  h: number,
  now: number,
): void {
  const lt = tick(s, now)
  const R = s.round
  if (!R) return
  ctx.clearRect(0, 0, w, h)
  const UR = FIELD.rField * 0.8
  const vp: Viewport = { width: w, height: h, unitsRadius: UR, zoom: 1, pan: { x: 0, y: -8 } }
  const S = (p: Vec2) => toScreen(p, vp)
  const scale = Math.min(w, h) / 2 / UR
  const phase = (now / 1000) * 3

  // 方眼・場の境界
  ctx.lineWidth = 1
  for (let g = -FIELD.rField; g <= FIELD.rField; g += 5) {
    const P = S({ x: g, y: -FIELD.rField })
    const Q = S({ x: g, y: FIELD.rField })
    const C0 = S({ x: -FIELD.rField, y: g })
    const D0 = S({ x: FIELD.rField, y: g })
    ctx.strokeStyle = g % 10 === 0 ? 'rgba(125,143,196,.15)' : 'rgba(125,143,196,.075)'
    ctx.beginPath()
    ctx.moveTo(P.x, P.y)
    ctx.lineTo(Q.x, Q.y)
    ctx.moveTo(C0.x, C0.y)
    ctx.lineTo(D0.x, D0.y)
    ctx.stroke()
  }
  const O = S({ x: 0, y: 0 })
  ctx.strokeStyle = 'rgba(125,143,196,.42)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(O.x, O.y, FIELD.rField * scale, 0, TAU)
  ctx.stroke()

  // 結界
  for (const [rec, owner] of [
    [s.ringA, 'ally'],
    [s.ringB, 'enemy'],
  ] as [RingRec | null, string][]) {
    if (!rec) continue
    if (rec.brokenAt !== null && lt >= rec.brokenAt) {
      const pr = (lt - rec.brokenAt) / 0.76
      if (pr < 1) drawOrbitDissipation(ctx, rec.ring, Math.min(0.999, pr), vp)
      continue
    }
    ctx.save()
    if (rec.bornBout === s.bout) ctx.globalAlpha = Math.min(1, Math.max(0, (lt - 0.45) / 0.6))
    ctx.globalAlpha *= 0.34
    strokeZPath(ctx, rec.ring, vp)
    ctx.restore()
    for (let n = 0; n < 12; n++) {
      const idx = Math.floor((n / 12 + (now / 3400) * (owner === 'ally' ? 1 : -1)) * rec.ring.length + rec.ring.length) % rec.ring.length
      const pt = rec.ring[idx]
      if (pt) drawParticle(ctx, pt.pos, col(attributeOf(pt.z), 1), vp, phase + n, 0.5)
    }
  }

  // 壁（弾が届いた削りだけ見せる）
  if (s.obstacles.length) {
    const view = s.obstacles.map((o) => {
      const holes: { x: number; y: number; r: number }[] = []
      for (const sh of R.shots) {
        for (const c of sh.carves) {
          if (c.obstacleId === o.id && c.t !== undefined && lt >= c.t) holes.push({ x: c.pos.x, y: c.pos.y, r: c.r })
        }
      }
      return holes.length ? { ...o, carves: [...o.carves, ...holes] } : o
    })
    drawObstacles(ctx, view, vp)
  }

  // 弾
  for (const sh of R.shots) {
    const tr = (lt - sh.at) / sh.k
    if (tr < 0) continue
    const done = tr >= sh.total
    let i = 1
    while (i < sh.times.length - 1 && sh.times[i] < tr) i++
    if (done) i = sh.samples.length - 1
    const fade = done ? Math.max(0, 1 - (lt - sh.at - sh.total * sh.k) / 1.2) : 1
    if (fade <= 0) continue
    ctx.save()
    ctx.lineCap = 'round'
    ctx.globalCompositeOperation = 'lighter'
    const back = Math.min(i, 44)
    for (let n = 0; n < back; n++) {
      const p = sh.samples[i - n]
      const q = sh.samples[i - n - 1]
      if (!q) break
      const z = zfieldAt(sh.traj, p.pos)
      const a = (1 - n / back) * (1 - n / back) * 0.5 * fade
      ctx.strokeStyle = col(attributeOf(z), a)
      ctx.lineWidth = 0.9 + (1 - n / back) * 2.0
      const P = S(p.pos)
      const Q = S(q.pos)
      ctx.beginPath()
      ctx.moveTo(P.x, P.y)
      ctx.lineTo(Q.x, Q.y)
      ctx.stroke()
    }
    ctx.restore()
    if (!done) {
      const p = sh.samples[i]
      drawBullet(ctx, p.pos, zfieldAt(sh.traj, p.pos), vp, phase, p.speed)
    }
    for (const c of sh.carves) {
      if (c.t === undefined) continue
      const dt = (lt - c.t) / 0.55
      if (dt >= 0 && dt < 1) drawCarveBurst(ctx, c.pos, c.r, c.attr, dt, vp)
    }
  }

  // 相殺・迎撃・暴発
  for (const cl of R.clashes) {
    const dt = (lt - cl.t) / 0.95
    if (dt < 0 || dt >= 1) continue
    const P = S(cl.pos)
    const pw = Math.min(1, cl.power / 140)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    for (let j = 0; j < 2; j++) {
      const q = Math.min(1, Math.max(0, (dt - j * 0.16) / 0.84))
      if (q <= 0) continue
      ctx.strokeStyle = `rgba(255,246,224,${((1 - q) * (1 - q) * 0.9).toFixed(3)})`
      ctx.lineWidth = (5 - j * 2.2) * (1 - q) + 0.8
      ctx.beginPath()
      ctx.arc(P.x, P.y, 9 + pw * 20 + q * (40 + pw * 50), 0, TAU)
      ctx.stroke()
    }
    for (let j = 0; j < 12; j++) {
      const aa = (j / 12) * TAU + 0.25
      const len = (18 + pw * 44) * Math.pow(dt, 0.55)
      ctx.strokeStyle = col(j % 2 ? 'light' : 'dark', 0.8 * (1 - dt))
      ctx.lineWidth = 2.2 * (1 - dt) + 0.4
      ctx.beginPath()
      ctx.moveTo(P.x + Math.cos(aa) * len * 0.3, P.y + Math.sin(aa) * len * 0.3)
      ctx.lineTo(P.x + Math.cos(aa) * len, P.y + Math.sin(aa) * len)
      ctx.stroke()
    }
    ctx.restore()
  }
  for (const bk of R.blocks) {
    const dt = (lt - bk.t) / 0.7
    if (dt < 0 || dt >= 1) continue
    const P = S(bk.pos)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = `rgba(255,246,224,${((1 - dt) * (1 - dt) * 0.85).toFixed(3)})`
    ctx.lineWidth = 2.6 * (1 - dt) + 0.5
    ctx.beginPath()
    ctx.arc(P.x, P.y, 6 + dt * (bk.broke ? 34 : 18), 0, TAU)
    ctx.stroke()
    ctx.restore()
  }
  for (const bl of R.blasts) {
    const q = (lt - bl.t) / 1.5
    if (q < 0 || q >= 1) continue
    // 0.62 までは広がり、そこからは畳まれる（広がりっぱなしにしない）
    const k = q < 0.62 ? 1 : Math.pow(Math.max(0, 1 - (q - 0.62) / 0.38), 0.9)
    if (k <= 0.02) continue
    const P = S(bl.pos)
    ctx.save()
    ctx.translate(P.x, P.y)
    ctx.scale(k, k)
    ctx.translate(-P.x, -P.y)
    drawMisfire(ctx, bl.pos, Math.min(0.999, q), vp, bl.r)
    ctx.restore()
  }

  // 術者
  for (const [p, attr, hp] of [
    [POS_A, 'light', s.hpA],
    [POS_B, 'dark', s.hpB],
  ] as [Vec2, Attribute, number][]) {
    const P = S(p)
    if (hp <= 0) {
      const dt = R.ko !== undefined ? Math.min(1, Math.max(0, (lt - R.ko) / 1.1)) : 1
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let j = 0; j < 10; j++) {
        const aa = (j / 10) * TAU + 0.2
        const len = 10 + 34 * Math.pow(dt, 0.5)
        ctx.strokeStyle = col(j % 2 ? 'light' : 'dark', 0.8 * (1 - dt))
        ctx.lineWidth = 2.4 * (1 - dt) + 0.4
        ctx.beginPath()
        ctx.moveTo(P.x + Math.cos(aa) * len * 0.25, P.y + Math.sin(aa) * len * 0.25)
        ctx.lineTo(P.x + Math.cos(aa) * len, P.y + Math.sin(aa) * len)
        ctx.stroke()
      }
      ctx.restore()
      continue
    }
    ctx.globalAlpha = hp <= 35 ? 0.55 + 0.45 * Math.sin((now / 1000) * 9) : 1
    ctx.fillStyle = col(attr, 0.85)
    ctx.fillRect(P.x - 3, P.y - 3, 6, 6)
    ctx.strokeStyle = col(attr, 0.3)
    ctx.lineWidth = 1
    ctx.strokeRect(P.x - 7, P.y - 7, 14, 14)
    ctx.globalAlpha = 1
  }

  // ダメージ表示
  for (const hi of R.hits) {
    const dt = (lt - hi.t) * 1000
    if (dt < 0 || dt >= 1000) continue
    const pr = dt / 1000
    const P = S(hi.pos)
    const size = Math.round(15 + Math.min(15, hi.dmg / 11))
    drawDamageNumber(
      ctx,
      P.x,
      P.y - 14 - Math.pow(pr, 0.6) * 30,
      String(hi.dmg),
      hi.misfire ? '#ffffff' : col(hi.attr, 1),
      size,
      Math.min(1, (1 - pr) * 2.6),
    )
  }

  // HUD：両者の HP と LVL
  const barW = Math.min(240, w * 0.26)
  const barH = 9
  const top = 18
  const bar = (x: number, hp: number, c: string, name: string, lv: number, right: boolean) => {
    ctx.save()
    ctx.fillStyle = 'rgba(10,10,20,.72)'
    ctx.fillRect(x, top, barW, barH)
    ctx.strokeStyle = 'rgba(125,143,196,.5)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, top + 0.5, barW - 1, barH - 1)
    const fw = Math.max(0, Math.min(1, hp / START_HP)) * (barW - 4)
    ctx.fillStyle = hp <= 35 ? TOKENS.hpLow : hp <= 70 ? TOKENS.light : c
    if (right) ctx.fillRect(x + barW - 2 - fw, top + 2, fw, barH - 4)
    else ctx.fillRect(x + 2, top + 2, fw, barH - 4)
    ctx.font = "10px 'DotGothic16', monospace"
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = right ? 'right' : 'left'
    ctx.fillStyle = TOKENS.textDim
    ctx.fillText(name, right ? x + barW : x, top - 5)
    ctx.fillStyle = c
    ctx.fillText(String(Math.round(hp)), right ? x - 10 : x + barW + 10, top + barH - 0.5)
    ctx.font = "700 11px 'DotGothic16', monospace"
    ctx.fillText(`LVL ${lv}`, right ? x + barW : x, top + barH + 13)
    ctx.font = "9px 'DotGothic16', monospace"
    ctx.fillStyle = TOKENS.textDim
    const nm: Record<string, string> = { breaker: '火力', attacker: '迂回', ruptor: '暴発', guardian: '結界' }
    ctx.fillText(
      rolePool(right ? 'B' : 'A', lv, s.bout)
        .map((r) => nm[r] ?? r)
        .join('・'),
      right ? x + barW : x,
      top + barH + 25,
    )
    ctx.restore()
  }
  bar(24, s.hpA, TOKENS.light, 'LIGHT MAGE', s.lvA, false)
  bar(w - 24 - barW, s.hpB, TOKENS.dark, 'DARK MAGE', s.lvB, true)

  // 決着の見出し
  if (R.ko !== undefined && s.banner) {
    const q = Math.min(1, Math.max(0, (lt - R.ko) / 0.4))
    ctx.save()
    ctx.globalAlpha = q * Math.min(1, (R.duration - lt) / 0.5)
    ctx.textAlign = 'center'
    ctx.font = "700 26px 'DotGothic16', monospace"
    ctx.lineJoin = 'miter'
    ctx.miterLimit = 2
    const lo = R.koSide === 'A' ? 'LIGHT MAGE' : 'DARK MAGE'
    const lv = R.koSide === 'A' ? s.lvA : s.lvB
    const txt = s.banner === 'lvup' ? `${lo} LVL ${lv + 1}` : 'LVL 1 から やり直し'
    ctx.strokeStyle = TOKENS.edgeDark
    ctx.lineWidth = 6
    ctx.strokeText(txt, w / 2, h * 0.3)
    ctx.fillStyle = s.banner === 'lvup' ? TOKENS.lightSoft : TOKENS.hpLow
    ctx.fillText(txt, w / 2, h * 0.3)
    ctx.font = "10px 'DotGothic16', monospace"
    ctx.fillStyle = TOKENS.textDim
    ctx.fillText(s.banner === 'lvup' ? '全回復して壁を組み直す' : '両者 LVL 1・全回復', w / 2, h * 0.3 + 20)
    ctx.restore()
  }

  // 中央を読ませる暗幕
  const g2 = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6)
  g2.addColorStop(0, 'rgba(4,4,10,.52)')
  g2.addColorStop(0.42, 'rgba(4,4,10,.34)')
  g2.addColorStop(1, 'rgba(4,4,10,.04)')
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, w, h)
}
