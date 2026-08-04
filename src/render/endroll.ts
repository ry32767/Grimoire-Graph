// エンドロール（DC プロトタイプ v3 の _drawEndroll を移植）。
// 「本物の敵AI同士が撃ち合う」自動対戦をクレジットの背景として流す。
//
// **計算は本番と完全に同一**（#72）：計画は planEnemyShots、解決は resolveTurn をそのまま呼ぶ。
// 相殺・結界の迎撃・障害物の削り・暴発・ダメージ・状態異常はすべて本番の実装が返した結果を
// 描くだけで、この層はロジックを一切持たない（かつては迎撃順・ダメージ式・相殺距離を
// 独自に書き直していて、壁を貫く結界・因果の逆転した霧散が出ていた）。
// 演出の時刻もエンジンが返すゲーム秒（flightTimes / clashes[].t / breakTime）をそのまま使う。
import type {
  ActiveOrbit,
  Ally,
  AllyCast,
  Attribute,
  CarveBurst,
  Enemy,
  EnemyFamily,
  EnemyRole,
  FlightSample,
  Obstacle,
  Trajectory,
  Vec2,
  ZPoint,
} from '../game/types'
import { FIELD, GAME } from '../data/constants'
import { toScreen, type Viewport } from '../game/coords'
import { planEnemyShots } from '../game/enemyAI'
import { resolveTurn, type ResolveResult } from '../game/turn'
import { flightTimes, timeToArc } from '../game/physics'
import { attributeOf, zfieldAt } from '../game/attribute'
import {
  drawObstacles,
  drawBullet,
  drawCarveBurst,
  drawMisfire,
  drawOrbitDissipation,
  drawDamageNumber,
  strokeZPath,
  drawParticle,
} from './draw'
import { trailWidthPx } from './board'
import { TOKENS } from './palette'

const TAU = Math.PI * 2
const MAX_LEVEL = 5
const START_HP = 140
const POS_A: Vec2 = { x: -16, y: -6 }
const POS_B: Vec2 = { x: 15, y: 5 }
/** 弾が飛ぶ見かけの秒数（実飛行秒 → 画面秒の倍率をここから決める） */
const FLIGHT_SEC = 3.4
const FIRE_AT = 0.45
/** 結界が散り切るまでの画面秒 */
const DISSIPATE_SEC = 0.76

type Side = 'A' | 'B'

/** 画面に描く1発（味方＝A側／敵＝B側どちらも同じ形で扱う）。 */
interface Bolt {
  side: Side
  samples: FlightSample[]
  /** サンプルごとの z（色・弾の大きさ用） */
  zs: number[]
  /** 各サンプルへの到達ゲーム秒（physics.flightTimes） */
  times: number[]
  total: number
  /** 壁を削った点（到達ゲーム秒つき） */
  carves: (CarveBurst & { t: number })[]
  misfirePos: Vec2 | null
  /** 暴発したゲーム秒 */
  misfireT: number
}

/** 画面に描く結界1枚。 */
interface RingView {
  ring: ZPoint[]
  side: Side
  /** 霧散したゲーム秒（エンジンの breakTime）。存続中は null */
  breakT: number | null
  /** この幕で新しく張られたか（フェードインさせる） */
  fresh: boolean
}

/** ダメージ表示1件（時刻はエンジンの飛行時間から引く）。 */
interface DamageView {
  pos: Vec2
  amount: number
  kind: Attribute | 'misfire' | 'heal'
  t: number
}

interface Bout {
  bolts: Bolt[]
  rings: RingView[]
  clashes: { pos: Vec2; power: number; t: number }[]
  blasts: { pos: Vec2; t: number; r: number }[]
  damages: DamageView[]
  obstacles: Obstacle[]
  /** 画面秒 = FIRE_AT + ゲーム秒 × k */
  k: number
  duration: number
  /** 決着した画面秒 */
  ko?: number
  koSide?: Side
  /** 幕の終わりに反映する状態 */
  after: { hpA: number; hpB: number; obstacles: Obstacle[]; orbits: ActiveOrbit[] }
}

/** 1 フレームに 1 手だけ進めるための計画ジョブ。 */
interface PlanJob {
  side: Side
  role: EnemyRole
}

export interface EndrollState {
  lvA: number
  lvB: number
  hpA: number
  hpB: number
  bout: number
  obstacles: Obstacle[]
  /** 持続している結界（両陣営・resolveTurn がそのまま持ち越す） */
  orbits: ActiveOrbit[]
  round: Bout | null
  t0: number
  banner: 'lvup' | 'reset' | null
  /** 次の幕を先取りで計画するためのキュー */
  pre: { jobs: PlanJob[]; i: number; casts: AllyCast[]; roles: EnemyRole[] } | null
  /** 一つ前の幕で A 側が撃った手（#75：B 側の読みに渡す。A 側の読みは planOne では持たない） */
  lastCasts: AllyCast[]
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
    id: side === 'A' ? 'mA' : 'mB',
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

/** 次の幕ぶんの「一手」リスト（A 側は1発ずつ計画、B 側は resolveTurn 内でまとめて計画される）。 */
function makeJobs(s: EndrollState, bout: number): PlanJob[] {
  return rolePool('A', s.lvA, bout).map((role) => ({ side: 'A' as const, role }))
}

/**
 * A 側の一手だけ計画する（本番の敵AIを castCount:1 で呼び、結果を「味方の発射」として使う）。
 * false を返したら同じジョブを次フレームへ持ち越す。
 */
function planOne(
  s: EndrollState,
  job: PlanJob,
  bout: number,
  bucket: { casts: AllyCast[] },
): boolean {
  const me = makeMage(s, 'A', bout)
  const foe = makeMage(s, 'B', bout)
  // 敵AIから見える結界＝相手（B側）が張っている持続結界
  const foeRings = s.orbits.filter((o) => o.owner === 'enemy').map((o) => o.ring)
  const one: Enemy = { ...me, role: job.role, castCount: 1, patternPool: [job.role] }
  let traj: Trajectory | undefined
  try {
    traj = planEnemyShots(one, [asAlly(foe)], s.obstacles, foeRings, [], FIELD.rField, 0)[0]?.trajectory
  } catch {
    traj = undefined
  }
  if (traj) {
    bucket.casts.push({ allyId: 'mA', trajectory: traj, initialSpeed: FIELD.fixedSpeed })
    return true
  }
  // 暴発型などは手が見つからないことがある。次フレームに迂回型で撃ち直す
  if (job.role !== 'attacker') {
    job.role = 'attacker'
    return false
  }
  return true
}

/** 発散寸前のサンプルは飛び飛びに跳ぶので、破綻した所で切る（見た目のワープ防止）。 */
function tameCount(samples: FlightSample[]): number {
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

/** 飛行＋z から描画用の1発を組む。時刻はすべて physics.flightTimes（本番と同じ定義）。 */
function boltOf(
  side: Side,
  samples: FlightSample[],
  zAt: (pos: Vec2, i: number) => number,
  carves: CarveBurst[],
  misfirePos: Vec2 | null,
): Bolt | null {
  const cut = samples.slice(0, tameCount(samples))
  if (cut.length < 2) return null
  const times = flightTimes(cut)
  const endArc = cut[cut.length - 1].arcLen
  let total = times[times.length - 1]
  if (!Number.isFinite(total) || total <= 0) {
    for (let i = times.length - 1; i >= 0; i--)
      if (Number.isFinite(times[i])) {
        total = times[i]
        break
      }
  }
  if (!Number.isFinite(total) || total <= 0) total = 1
  return {
    side,
    samples: cut,
    zs: cut.map((sm, i) => zAt(sm.pos, i)),
    times,
    total,
    carves: carves
      .filter((c) => c.arcLen <= endArc + 1e-6)
      .map((c) => ({ ...c, t: timeToArc(cut, c.arcLen) }))
      .filter((c) => Number.isFinite(c.t)),
    misfirePos,
    misfireT: misfirePos ? total : 0,
  }
}

/** 幕を組み立てる：本番の resolveTurn を1回呼び、返ってきた結果を描画データへ読み替える。 */
function startBout(s: EndrollState, now: number): void {
  s.bout++
  const bucket = s.pre ?? { casts: [], jobs: [], i: 0, roles: [] }
  // 先取りが間に合っていない手はここで補う
  const jobs = s.pre?.jobs ?? makeJobs(s, s.bout)
  for (let i = s.pre?.i ?? 0, guard = 0; i < jobs.length && guard < 24; guard++) {
    if (planOne(s, jobs[i], s.bout, bucket)) i++
  }
  s.pre = null

  const mageA = makeMage(s, 'A', s.bout)
  const mageB = makeMage(s, 'B', s.bout)
  const allyA: Ally = asAlly(mageA)
  let res: ResolveResult
  try {
    res = resolveTurn({
      allies: [allyA],
      casts: bucket.casts,
      enemies: [mageB],
      castingEnemyIds: [mageB.id],
      obstacles: s.obstacles,
      mechanics: { obstacles: true, enemyFire: true },
      activeOrbits: s.orbits,
      lastAllyCasts: s.lastCasts, // B 側の読み（#75）：A が前の幕と同じ手を撃つと仮定させる
    })
  } catch {
    s.round = null
    s.t0 = now
    return
  }

  s.lastCasts = bucket.casts // 次の幕で B 側が読む「A の前の手」（#75）

  // --- 弾（A=味方の発射型／B=敵弾）---
  const bolts: Bolt[] = []
  for (const sh of res.allyShots) {
    if (sh.kind !== 'projectile' || !sh.flight) continue
    const b = boltOf('A', sh.flight.samples, (_p, i) => sh.path[i]?.z ?? 0, sh.carves, sh.misfirePos)
    if (b) bolts.push(b)
  }
  for (const sh of res.enemyShots) {
    const b = boltOf(
      'B',
      sh.flight.samples,
      (p) => zfieldAt(sh.traj, p),
      sh.carves,
      sh.misfired ? sh.misfirePos : null,
    )
    if (b) bolts.push(b)
  }

  // --- 結界（今ターン張った新規＋前ターンからの持続）---
  const rings: RingView[] = []
  for (const sh of res.allyShots) {
    if (sh.kind !== 'orbit' || sh.path.length < 3) continue
    rings.push({ ring: sh.path, side: 'A', breakT: sh.breakTime, fresh: true })
  }
  for (const er of res.enemyRings) {
    if (er.ring.length < 3) continue
    rings.push({ ring: er.ring, side: 'B', breakT: er.breakTime, fresh: true })
  }
  for (const po of s.orbits) {
    const survived = res.orbits.some((o) => o.id === po.id)
    const brk = res.orbitBreaks[po.id]
    // 同じ場所へ張り直したぶんは新規側で描く（二重表示の防止）
    if (survived && rings.some((r) => r.ring === po.ring)) continue
    rings.push({
      ring: po.ring,
      side: po.owner === 'player' ? 'A' : 'B',
      breakT: survived ? null : (brk?.t ?? 0),
      fresh: false,
    })
  }

  // --- 暴発の爆発 ---
  const blasts: Bout['blasts'] = bolts
    .filter((b) => b.misfirePos)
    .map((b) => ({ pos: b.misfirePos as Vec2, t: b.misfireT, r: FIELD.aoeRadius }))

  // --- ダメージ表示：量はエンジンの popups、時刻は同じ対象への命中時刻から引く ---
  const hitTimes: Record<string, number[]> = {}
  const pushHit = (id: string, t: number) => {
    if (!Number.isFinite(t)) return
    ;(hitTimes[id] ??= []).push(t)
  }
  for (const sh of res.allyShots) {
    if (!sh.flight) continue
    for (const h of sh.hits) pushHit(h.targetId, timeToArc(sh.flight.samples, h.arcLen))
  }
  for (const sh of res.enemyShots) {
    for (const h of sh.hits) pushHit(h.targetId, timeToArc(sh.flight.samples, h.arcLen))
  }
  for (const id in hitTimes) hitTimes[id].sort((a, b) => a - b)
  const firstBlast = blasts.length ? Math.min(...blasts.map((b) => b.t)) : 0
  const damages: DamageView[] = res.popups.map((p) => {
    let t = 0
    if (p.trigger === 'flash') t = hitTimes[p.targetId]?.shift() ?? 0
    else if (p.trigger === 'misfire') t = firstBlast
    return { pos: p.pos, amount: p.amount, kind: p.kind, t }
  })

  // --- 画面時間へのスケール ---
  const spans = [
    ...bolts.map((b) => b.total),
    ...res.clashes.map((c) => c.t),
    ...rings.map((r) => r.breakT ?? 0),
    ...damages.map((d) => d.t),
  ].filter((x) => Number.isFinite(x) && x > 0)
  const k = FLIGHT_SEC / Math.max(0.25, ...spans)
  const lastGame = spans.length ? Math.max(...spans) : 0
  const last = FIRE_AT + lastGame * k

  s.round = {
    bolts,
    rings,
    clashes: res.clashes.filter((c) => Number.isFinite(c.t)),
    blasts,
    damages,
    obstacles: s.obstacles,
    k,
    duration: Math.min(14, last + 1.6),
    after: {
      hpA: res.allies[0]?.hp ?? s.hpA,
      hpB: res.enemies[0]?.hp ?? s.hpB,
      obstacles: res.obstacles,
      orbits: res.orbits,
    },
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
    orbits: [],
    round: null,
    t0: now,
    banner: null,
    pre: null,
    lastCasts: [],
  }
  s.obstacles = makeObstacles(1)
  startBout(s, now)
  return s
}

/** 幕を進める。やられた側だけが LVL を上げて全回復し、壁は別配置に組み直す。 */
function tick(s: EndrollState, now: number): number {
  const R = s.round
  if (!R) {
    startBout(s, now)
    return 0
  }
  const lt = (now - s.t0) / 1000
  // HP は「ダメージ表示が出た時刻」に合わせて減らす（見た目と数字を揃える）
  let dmgA = 0
  let dmgB = 0
  for (const d of R.damages) {
    if (lt < FIRE_AT + d.t * R.k) continue
    const sign = d.kind === 'heal' ? -1 : 1
    // 位置で被害者を判定する（A の術者位置に近い方が A の被弾）
    if (Math.hypot(d.pos.x - POS_A.x, d.pos.y - POS_A.y) < Math.hypot(d.pos.x - POS_B.x, d.pos.y - POS_B.y))
      dmgA += sign * d.amount
    else dmgB += sign * d.amount
  }
  const hpA = Math.max(0, Math.min(START_HP, s.hpA - dmgA))
  const hpB = Math.max(0, Math.min(START_HP, s.hpB - dmgB))
  if (R.ko === undefined && (hpA <= 0 || hpB <= 0)) {
    R.ko = lt
    R.koSide = hpA <= 0 ? 'A' : 'B'
    R.duration = Math.min(R.duration, lt + 3.0)
    const lv = R.koSide === 'A' ? s.lvA : s.lvB
    s.banner = lv >= MAX_LEVEL ? 'reset' : 'lvup'
    s.pre = null
  }
  // 幕の尻尾で次の幕の計画を 1 フレーム 1 手ずつ進めておく（切り替わりで描画が止まらない）
  if (lt > R.duration - 2.4 && R.ko === undefined) {
    if (!s.pre) s.pre = { jobs: makeJobs(s, s.bout + 1), i: 0, casts: [], roles: [] }
    else if (s.pre.i < s.pre.jobs.length) {
      if (planOne(s, s.pre.jobs[s.pre.i], s.bout + 1, s.pre)) s.pre.i++
    }
  }
  if (lt >= R.duration) {
    // 幕の終わりにエンジンの最終状態を反映する（削れた壁・持続結界・HP）
    s.obstacles = R.after.obstacles
    s.orbits = R.after.orbits
    s.hpA = R.after.hpA
    s.hpB = R.after.hpB
    if (R.ko !== undefined) {
      const lv = R.koSide === 'A' ? s.lvA : s.lvB
      if (lv >= MAX_LEVEL) {
        s.lvA = 1
        s.lvB = 1
        s.hpA = START_HP
        s.hpB = START_HP
      } else if (R.koSide === 'A') {
        s.lvA += 1
        s.hpA = START_HP
      } else {
        s.lvB += 1
        s.hpB = START_HP
      }
      s.obstacles = makeObstacles(Math.max(s.lvA, s.lvB))
      s.orbits = [] // 決着で場の結界は消える
      s.banner = null
      s.pre = null
    }
    s.round = null
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
  /** ゲーム秒 → 画面秒 */
  const at = (t: number) => FIRE_AT + t * R.k

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

  // 結界：霧散はエンジンが返した breakTime ちょうどから始まる（#72）
  for (const rec of R.rings) {
    if (rec.breakT !== null) {
      const bt = at(rec.breakT)
      if (lt >= bt) {
        const pr = (lt - bt) / DISSIPATE_SEC
        if (pr < 1) drawOrbitDissipation(ctx, rec.ring, Math.min(0.999, pr), vp)
        continue
      }
    }
    ctx.save()
    if (rec.fresh) ctx.globalAlpha = Math.min(1, Math.max(0, (lt - 0.45) / 0.6))
    ctx.globalAlpha *= 0.34
    strokeZPath(ctx, rec.ring, vp)
    ctx.restore()
    for (let n = 0; n < 12; n++) {
      const dir = rec.side === 'A' ? 1 : -1
      // 逆回り（dir=-1）では index が大きく負になる。JS の % は負を返すので必ず正へ畳む
      // （従来は `+ ring.length` を1回足すだけで、now が大きいと負のまま＝**闇側だけ粒が出なかった**）
      const raw = Math.floor((n / 12 + (now / 3400) * dir) * rec.ring.length)
      const idx = ((raw % rec.ring.length) + rec.ring.length) % rec.ring.length
      const pt = rec.ring[idx]
      if (pt) drawParticle(ctx, pt.pos, col(attributeOf(pt.z), 1), vp, phase + n, 0.5)
    }
  }

  // 壁（弾が届いた削りだけ見せる）
  if (R.obstacles.length) {
    const view = R.obstacles.map((o) => {
      const holes: { x: number; y: number; r: number }[] = []
      for (const b of R.bolts) {
        for (const c of b.carves) {
          if (c.obstacleId === o.id && lt >= at(c.t)) holes.push({ x: c.pos.x, y: c.pos.y, r: c.r })
        }
      }
      return holes.length ? { ...o, carves: [...o.carves, ...holes] } : o
    })
    drawObstacles(ctx, view, vp)
  }

  // 弾
  for (const b of R.bolts) {
    const tg = (lt - FIRE_AT) / R.k // 現在のゲーム秒
    if (tg < 0) continue
    const done = tg >= b.total
    let i = 1
    while (i < b.times.length - 1 && b.times[i] < tg) i++
    if (done) i = b.samples.length - 1
    const fade = done ? Math.max(0, 1 - (lt - at(b.total)) / 1.2) : 1
    if (fade <= 0) continue
    ctx.save()
    ctx.lineCap = 'round'
    ctx.globalCompositeOperation = 'lighter'
    const back = Math.min(i, 44)
    for (let n = 0; n < back; n++) {
      const p = b.samples[i - n]
      const q = b.samples[i - n - 1]
      if (!q) break
      const a = (1 - n / back) * (1 - n / back) * 0.6 * fade
      const zn = b.zs[i - n] ?? 0
      ctx.strokeStyle = col(attributeOf(zn), a)
      // 太さ＝属性強度。本編（board.drawFlightPath）と同じ規則を共有する（#74）
      ctx.lineWidth = trailWidthPx(zn, vp)
      const P = S(p.pos)
      const Q = S(q.pos)
      ctx.beginPath()
      ctx.moveTo(P.x, P.y)
      ctx.lineTo(Q.x, Q.y)
      ctx.stroke()
    }
    ctx.restore()
    if (!done) drawBullet(ctx, b.samples[i].pos, b.zs[i] ?? 0, vp, phase, b.samples[i].speed)
    for (const c of b.carves) {
      const dt = (lt - at(c.t)) / 0.55
      if (dt >= 0 && dt < 1) drawCarveBurst(ctx, c.pos, c.r, c.attr, dt, vp)
    }
  }

  // 相殺・迎撃の火花（時刻はエンジンの clashes[].t）
  for (const cl of R.clashes) {
    const dt = (lt - at(cl.t)) / 0.95
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

  // 暴発
  for (const bl of R.blasts) {
    const q = (lt - at(bl.t)) / 1.5
    if (q < 0 || q >= 1) continue
    // 0.62 までは広がり、そこからは畳まれる（広がりっぱなしにしない）
    const kk = q < 0.62 ? 1 : Math.pow(Math.max(0, 1 - (q - 0.62) / 0.38), 0.9)
    if (kk <= 0.02) continue
    const P = S(bl.pos)
    ctx.save()
    ctx.translate(P.x, P.y)
    ctx.scale(kk, kk)
    ctx.translate(-P.x, -P.y)
    drawMisfire(ctx, bl.pos, Math.min(0.999, q), vp, bl.r)
    ctx.restore()
  }

  // 術者（HP はダメージ表示と同じ時刻で減る）
  let shownA = s.hpA
  let shownB = s.hpB
  for (const d of R.damages) {
    if (lt < at(d.t)) continue
    const sign = d.kind === 'heal' ? -1 : 1
    if (Math.hypot(d.pos.x - POS_A.x, d.pos.y - POS_A.y) < Math.hypot(d.pos.x - POS_B.x, d.pos.y - POS_B.y))
      shownA -= sign * d.amount
    else shownB -= sign * d.amount
  }
  shownA = Math.max(0, Math.min(START_HP, shownA))
  shownB = Math.max(0, Math.min(START_HP, shownB))
  for (const [p, attr, hp] of [
    [POS_A, 'light', shownA],
    [POS_B, 'dark', shownB],
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
  for (const d of R.damages) {
    const dt = (lt - at(d.t)) * 1000
    if (dt < 0 || dt >= 1000) continue
    const pr = dt / 1000
    const P = S(d.pos)
    const size = Math.round(15 + Math.min(15, d.amount / 11))
    drawDamageNumber(
      ctx,
      P.x,
      P.y - 14 - Math.pow(pr, 0.6) * 30,
      String(Math.round(d.amount)),
      d.kind === 'misfire' ? '#ffffff' : d.kind === 'heal' ? '#5ad16a' : col(d.kind, 1),
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
  bar(24, shownA, TOKENS.light, 'LIGHT MAGE', s.lvA, false)
  bar(w - 24 - barW, shownB, TOKENS.dark, 'DARK MAGE', s.lvB, true)

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
