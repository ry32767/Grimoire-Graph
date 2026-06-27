// ターン解決（#15：自陣営3人 vs 敵チーム）。同時発射→解決。純粋関数。
// 解決順：敵弾構築 → 味方発射の分類 → 防御(軌道型リング迎撃/発射型パリィ) → 障害物の削り
//          → 攻撃(命中/掃射/暴発) → 敵弾が味方へ命中。
import type {
  Ally,
  AllyCast,
  CarveBurst,
  Enemy,
  Flight,
  FlightSample,
  LogEntry,
  Mechanics,
  Obstacle,
  Trajectory,
  Vec2,
  ZPoint,
} from './types'
import {
  attributeOf,
  strengthOf,
  computeDamage,
  affinityMultiplier,
  zfieldAt,
} from './attribute'
import {
  simulateFlight,
  simulateWithLosses,
  simulatePath,
  polyFromPoints,
  sampleAtLength,
  type LossEvent,
} from './physics'
import { firstHitAmong, type Target } from './collision'
import { firstCrossing, resolveParry } from './parry'
import { isSolidAt, carveSpeedLoss, carveRadius } from './obstacle'
import { resolveMisfire } from './misfire'
import { makeStatus, addStatus } from './status'
import { dist } from './coords'
import { classifyTrajectory, type MagicKind } from './loop'
import {
  buildRing,
  orbitSweep,
  ringInterception,
  orbitBlockLoss,
  type RingPoint,
  type OrbitTarget,
} from './orbit'
import { planEnemyShot, enemyFlight } from './enemyAI'
import { FIELD, GAME } from '../data/constants'

/** 敵弾の描画・解決用データ */
export interface EnemyShot {
  enemyId: string
  targetAllyId: string
  path: Vec2[]
  flight: Flight
  castZ: number
  /** 敵弾の軌道（z 場つき）。位置ごとの属性・強度の評価に使う（#28） */
  traj: Trajectory
  blocked: boolean
  reachedTarget: boolean
  damage: number
  /** 障害物を削った演出データ（#11） */
  carves: CarveBurst[]
  /** 味方へ命中した時の対象IDと到達弧長（赤フラッシュ＋揺れ演出・#20） */
  hitAllyId: string | null
  hitArcLen: number
}

/** 味方の発射（描画・解決用） */
export interface AllyShot {
  allyId: string
  kind: MagicKind
  /** 描画用パス（発射型=飛行軌道／軌道型=リング）。z つき */
  path: ZPoint[]
  /** 発射型の最終飛行 */
  flight: Flight | null
  misfirePos: Vec2 | null
  /** 障害物を削った演出データ（#11） */
  carves: CarveBurst[]
  /** 発射型が命中した敵IDと到達弧長（赤フラッシュ＋揺れ演出・#20） */
  hitEnemyId: string | null
  hitArcLen: number
  /** 軌道型が掃射で当てた敵ID群（#20） */
  sweptEnemyIds: string[]
}

export interface ResolveInput {
  allies: Ally[]
  /** 生存味方の発射（軌道は味方位置を origin に持つ）。発射しない味方は含めない */
  casts: AllyCast[]
  enemies: Enemy[]
  /** このターン実際に発射する敵のID（ひるみ等は除外） */
  castingEnemyIds: string[]
  obstacles: Obstacle[]
  mechanics: Mechanics
}

export interface ResolveResult {
  allies: Ally[]
  enemies: Enemy[]
  obstacles: Obstacle[]
  log: LogEntry[]
  allyShots: AllyShot[]
  enemyShots: EnemyShot[]
}

/** 始点→終点の直線パス。 */
function straightPath(from: Vec2, to: Vec2, steps = 44): Vec2[] {
  const path: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    path.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
  }
  return path
}

/** 敵が狙う味方を選ぶ：最もHPが低い味方（同値は敵に近い方）。Phase D でより賢く。 */
export function chooseTarget(enemy: Enemy, allies: Ally[]): Ally | null {
  const alive = allies.filter((a) => a.hp > 0)
  if (alive.length === 0) return null
  return alive.reduce((best, a) => {
    if (a.hp < best.hp) return a
    if (a.hp === best.hp && dist(a.pos, enemy.pos) < dist(best.pos, enemy.pos)) return a
    return best
  })
}

/** 飛行サンプルの平均速度（軌道型リングの代表速度に使う）。 */
function meanSpeed(flight: Flight): number {
  if (flight.samples.length === 0) return 0
  const sum = flight.samples.reduce((s, x) => s + x.speed, 0)
  return sum / flight.samples.length
}

/** 名前を引く小ヘルパ。 */
function nameOf<T extends { id: string; name: string }>(arr: T[], id: string): string {
  return arr.find((x) => x.id === id)?.name ?? '？'
}

/** 内部：味方発射の中間表現 */
interface AllyPlan {
  cast: AllyCast
  kind: MagicKind
  ring: RingPoint[] | null
  ringSpeed: number
  freeFlight: Flight | null
  carves: CarveBurst[]
}

/**
 * 弾が障害物を「えぐり取りながら」進む解決の中核（#1/#16・Graph War 風）。
 * パスが素材（solids にあり carves に無い点）に触れた点を衝突とみなし、その点を中心に
 * 威力分の半径の円を carves に足して滑らかにえぐる。えぐった穴の先は素通りなので、次に
 * 素材へ再突入した点で再びえぐる。えぐるたびに弾は減速し、速度が 0 になればその場で消滅し
 * 貫通しない。威力が高いほど一撃で広くえぐれる＝少ない回数で抜けられる＝貫通しやすい。
 * losses は呼び出し側と共有し、resim は「元の初速＋全減衰」で飛行を作り直す。
 * obstacles の carves は in place で更新（呼び出し側が複製済み）。
 */
function carveAlong(
  geom: FlightSample[],
  obstacles: Obstacle[],
  zAt: (pos: Vec2) => number,
  losses: LossEvent[],
  resim: (losses: LossEvent[]) => Flight,
  current: Flight,
): { flight: Flight; bursts: CarveBurst[]; vanished: boolean } {
  let flight = current
  const bursts: CarveBurst[] = []
  if (geom.length <= 1) return { flight, bursts, vanished: false }
  let vanished = false
  // パスを原点側から辿り、素材へ触れた点でえぐる。えぐった穴の中は素通り。
  for (let s = 0; s < geom.length; s++) {
    let hit: Obstacle | null = null
    for (const ob of obstacles) {
      if (isSolidAt(ob, geom[s].pos)) {
        hit = ob
        break
      }
    }
    if (!hit) continue // 素材に触れていない（空間 or 穴の中）
    const cur = sampleAtLength(flight, geom[s].arcLen)
    if (!cur || cur.speed <= 0) {
      vanished = true
      break
    }
    const z = zAt(geom[s].pos)
    const attr = attributeOf(z)
    const power = cur.speed * (strengthOf(z) + 1) // 中立弾でも運動量で少しえぐれる
    const r = carveRadius(power)
    // 当たった点を中心に円を引き算して滑らかにえぐる
    hit.carves.push({ x: geom[s].pos.x, y: geom[s].pos.y, r })
    bursts.push({ pos: geom[s].pos, r, arcLen: geom[s].arcLen, attr, obstacleId: hit.id })
    losses.push({ arcLen: geom[s].arcLen, deltaV: carveSpeedLoss(attr, hit.element) })
    flight = resim(losses)
    if (flight.end === 'vanished') {
      vanished = true
      break
    }
  }
  return { flight, bursts, vanished }
}

/** 味方弾（軌道・z=関数値）が障害物セルを削りながら進む。おすすめ探索でも再利用。 */
export function traverseObstacles(
  traj: Trajectory,
  initSpeed: number,
  freeFlight: Flight,
  obstacles: Obstacle[],
): { flight: Flight; logs: LogEntry[]; carves: CarveBurst[] } {
  const losses: LossEvent[] = []
  const r = carveAlong(
    freeFlight.samples,
    obstacles,
    (pos) => zfieldAt(traj, pos),
    losses,
    (ls) => simulateWithLosses(traj, initSpeed, ls),
    freeFlight,
  )
  const logs: LogEntry[] = []
  if (r.bursts.length > 0) {
    logs.push({
      kind: 'obstacle',
      text: r.vanished ? '障害物をえぐったが弾は止まった' : '障害物をえぐり抜いて貫通した',
    })
  }
  return { flight: r.flight, logs, carves: r.bursts }
}


/** 同時発射の解決。入力は変更せず、新しい状態とログ・飛行データを返す。 */
export function resolveTurn(input: ResolveInput): ResolveResult {
  const { mechanics } = input
  const log: LogEntry[] = []
  const allies = input.allies.map((a) => ({ ...a, statuses: [...a.statuses] }))
  const enemies = input.enemies.map((e) => ({ ...e, statuses: [...e.statuses] }))
  // carves は削りで増えるので、入力を壊さないようターンごとに新しい配列へ複製（solids は不変で共有）
  const obstacles = input.obstacles.map((o) => ({ ...o, carves: [...o.carves] }))

  const allyById = (id: string) => allies.find((a) => a.id === id)
  const enemyTargets = (): Target[] =>
    enemies.filter((e) => e.hp > 0).map((e) => ({ id: e.id, pos: e.pos, radius: e.hitboxRadius }))

  // === 1. 敵弾を構築（敵AIが得意関数で最大ダメージへ最適化・#2/#17。z は castZ 一定） ===
  const enemyShots: EnemyShot[] = []
  for (const e of enemies) {
    if (!input.castingEnemyIds.includes(e.id) || e.hp <= 0) continue
    const plan = planEnemyShot(e, allies, obstacles)
    if (!plan) continue
    const { path, flight } = enemyFlight(plan.trajectory, e.castInitialSpeed)
    enemyShots.push({
      enemyId: e.id,
      targetAllyId: plan.targetId,
      path,
      flight,
      castZ: e.castZ,
      traj: plan.trajectory,
      blocked: false,
      reachedTarget: false,
      damage: 0,
      carves: [],
      hitAllyId: null,
      hitArcLen: 0,
    })
  }

  // === 2. 味方発射を分類・構築 ===
  const plans: AllyPlan[] = []
  for (const cast of input.casts) {
    const ally = allyById(cast.allyId)
    if (!ally || ally.hp <= 0) continue
    const kind = classifyTrajectory(cast.trajectory)
    if (kind === 'orbit') {
      const ring = buildRing(cast.trajectory)
      const ringFlight = simulateFlight(cast.trajectory, cast.initialSpeed)
      plans.push({ cast, kind, ring, ringSpeed: meanSpeed(ringFlight), freeFlight: null, carves: [] })
    } else {
      const freeFlight = simulateFlight(cast.trajectory, cast.initialSpeed)
      plans.push({ cast, kind, ring: null, ringSpeed: 0, freeFlight, carves: [] })
    }
  }

  // === 3. 防御：軌道型リングの迎撃 → 発射型のパリィ（敵弾を削る） ===
  // 減衰イベントは shot ごとに蓄積し、毎回「元の初速＋全減衰」で再シミュレートする
  // （軌道型→パリィなど複数防御の速度損を正しく重ねる）。
  for (const shot of enemyShots) {
    const initSpeed = shot.flight.samples[0]?.speed ?? 0
    const geom = shot.flight.samples // 幾何（位置・弧長）は減衰で変わらない
    const pathPoly = polyFromPoints(shot.path)
    const arcAt = (idx: number) => pathPoly[Math.min(idx, pathPoly.length - 1)]?.cumLen ?? 0
    // 敵弾の z は軌道に紐づく z 場をパス位置で評価する（#28）
    const enemyZByIdx = (i: number) => zfieldAt(shot.traj, shot.path[Math.min(i, shot.path.length - 1)])
    const losses: LossEvent[] = []
    const resim = () => {
      shot.flight = simulatePath(shot.path, initSpeed, enemyZByIdx, losses)
    }

    // 3z. 障害物は敵弾も削りながら遮る（味方の盾になる・#16）。削り切れず速度0で止まれば消滅。
    if (mechanics.obstacles && geom.length > 1) {
      const r = carveAlong(
        geom,
        obstacles,
        (pos) => zfieldAt(shot.traj, pos),
        losses,
        (ls) => simulatePath(shot.path, initSpeed, enemyZByIdx, ls),
        shot.flight,
      )
      shot.flight = r.flight
      shot.carves = r.bursts
      if (r.bursts.length > 0) {
        log.push({
          kind: 'obstacle',
          text: r.vanished ? '敵弾は障害物に阻まれて消えた' : '敵弾が障害物をえぐった',
        })
      }
      if (shot.flight.end === 'vanished') shot.blocked = true
    }
    if (shot.blocked) continue

    // 3a. 軌道型リングが境界で迎撃
    for (const p of plans) {
      if (p.kind !== 'orbit' || !p.ring || shot.blocked) continue
      const inter = ringInterception(p.ring, shot.path)
      if (!inter.crossed || inter.ringZ === undefined || inter.enemyIndex === undefined) continue
      const eAttrHere = attributeOf(inter.pos ? zfieldAt(shot.traj, inter.pos) : shot.castZ)
      losses.push({ arcLen: arcAt(inter.enemyIndex), deltaV: orbitBlockLoss(inter.ringZ, eAttrHere) })
      resim()
      const aName = nameOf(allies, p.cast.allyId)
      if (shot.flight.end === 'vanished') {
        shot.blocked = true
        log.push({ kind: 'orbit', text: `${aName}の周回結界が敵弾を止めた` })
      } else {
        log.push({ kind: 'orbit', text: `${aName}の周回結界が敵弾を弱めた` })
      }
    }
    if (shot.blocked) continue

    // 3b. 発射型のパリィ（反対極なら相殺）
    for (const p of plans) {
      if (p.kind !== 'projectile' || !p.freeFlight || p.freeFlight.samples.length < 2) continue
      const playerPath = p.freeFlight.samples.map((s) => s.pos)
      const cross = firstCrossing(playerPath, shot.path)
      if (!cross) continue
      const pSample = p.freeFlight.samples[cross.indexA]
      const crossArc = arcAt(cross.indexB)
      // 直前までの減衰を反映した現在の飛行から、交差点（弧長基準）の速度を引く
      const eSample = sampleAtLength(shot.flight, crossArc) ?? shot.flight.samples[shot.flight.samples.length - 1]
      const pZ = zfieldAt(p.cast.trajectory, pSample.pos)
      const pAttr = attributeOf(pZ)
      const pStr = strengthOf(pZ)
      const eZ = zfieldAt(shot.traj, eSample.pos)
      const eAttr = attributeOf(eZ)
      const eStr = strengthOf(eZ)
      const parry = resolveParry(pAttr, pSample.speed, pSample.speed * pStr, eAttr, eSample.speed, eSample.speed * eStr)
      if (parry.passthrough) continue
      losses.push({ arcLen: crossArc, deltaV: eSample.speed - parry.speedB })
      resim()
      log.push({ kind: 'parry', text: `${nameOf(allies, p.cast.allyId)}の弾が敵弾を相殺` })
      if (shot.flight.end === 'vanished') {
        shot.blocked = true
        break
      }
    }
  }

  // === 4. 障害物：弾は障害物内を進むほど減速し、威力で耐久＝半径を削る（#1/#16） ===
  for (const p of plans) {
    if (p.kind !== 'projectile' || !p.freeFlight || !mechanics.obstacles) continue
    const res = traverseObstacles(p.cast.trajectory, p.cast.initialSpeed, p.freeFlight, obstacles)
    p.freeFlight = res.flight
    p.carves = res.carves
    for (const l of res.logs) log.push(l)
  }

  // === 5. 攻撃：命中（発射型）／掃射（軌道型）／暴発 ===
  const allyShots: AllyShot[] = []
  for (const p of plans) {
    if (p.kind === 'orbit' && p.ring) {
      const targets: OrbitTarget[] = enemies
        .filter((e) => e.hp > 0)
        .map((e) => ({ id: e.id, pos: e.pos, radius: e.hitboxRadius, element: e.element }))
      const hits = orbitSweep(p.ring, p.ringSpeed, targets)
      const sweptEnemyIds: string[] = []
      for (const h of hits) {
        sweptEnemyIds.push(h.id)
        const idx = enemies.findIndex((e) => e.id === h.id)
        if (idx < 0) continue
        enemies[idx] = {
          ...enemies[idx],
          hp: Math.max(0, enemies[idx].hp - h.damage),
          statuses: addStatus(enemies[idx].statuses, makeStatus(h.attr, h.strength)),
        }
        log.push({
          kind: 'playerHit',
          text: `${nameOf(allies, p.cast.allyId)}の周回が${enemies[idx].name}を掃射！ ${h.damage.toFixed(0)} ダメージ`,
        })
      }
      if (hits.length === 0) {
        log.push({ kind: 'orbit', text: `${nameOf(allies, p.cast.allyId)}は周回結界を展開した` })
      }
      allyShots.push({
        allyId: p.cast.allyId,
        kind: 'orbit',
        path: p.ring,
        flight: null,
        misfirePos: null,
        carves: p.carves,
        hitEnemyId: null,
        hitArcLen: 0,
        sweptEnemyIds,
      })
      continue
    }

    // 発射型
    const flight = p.freeFlight!
    const traj = p.cast.trajectory
    const path: ZPoint[] = flight.samples.map((s) => ({ pos: s.pos, z: zfieldAt(traj, s.pos) }))
    let misfirePos: Vec2 | null = null
    let hitEnemyId: string | null = null
    let hitArcLen = 0
    const hit = firstHitAmong(flight.samples, enemyTargets())
    if (hit) {
      hitEnemyId = hit.id
      hitArcLen = hit.arcLen
      const idx = enemies.findIndex((e) => e.id === hit.id)
      const enemy = enemies[idx]
      const z = zfieldAt(traj, hit.pos)
      const dmg = computeDamage(hit.speed, z, enemy.element)
      enemies[idx] = {
        ...enemy,
        hp: Math.max(0, enemy.hp - dmg.damage),
        statuses: addStatus(enemy.statuses, makeStatus(dmg.attackAttr, dmg.strength)),
      }
      log.push({
        kind: 'playerHit',
        text: `${nameOf(allies, p.cast.allyId)}→${enemy.name}に命中！ 速${dmg.speed.toFixed(1)}×強${dmg.strength.toFixed(1)}×相性${dmg.affinity} = ${dmg.damage.toFixed(0)}`,
      })
    } else if (flight.end === 'invalid') {
      // 暴発（関数エラー・#3/#9）：敵＋近くの味方を巻き込む AoE
      misfirePos = flight.endPos
      // endSpeed は samples 空でも v0(=初速) を保持するため常に正しい
      const speed = flight.endSpeed
      const mis = resolveMisfire({ type: 'invalid', pos: misfirePos }, speed, enemies.map((e) => ({ id: e.id, pos: e.pos })))
      for (const id of mis.hitIds) {
        const idx = enemies.findIndex((e) => e.id === id)
        if (idx >= 0)
          enemies[idx] = {
            ...enemies[idx],
            hp: Math.max(0, enemies[idx].hp - mis.damage),
            statuses: mis.statuses.reduce((acc, s) => addStatus(acc, s), enemies[idx].statuses),
          }
      }
      for (let i = 0; i < allies.length; i++) {
        if (allies[i].hp > 0 && dist(allies[i].pos, misfirePos) <= FIELD.aoeRadius) {
          allies[i] = {
            ...allies[i],
            hp: Math.max(0, allies[i].hp - mis.damage),
            statuses: mis.statuses.reduce((acc, s) => addStatus(acc, s), allies[i].statuses),
          }
        }
      }
      log.push({
        kind: 'misfire',
        text: `${nameOf(allies, p.cast.allyId)}の術式が綻び暴発！ ${mis.damage.toFixed(0)} のAoE`,
      })
    } else {
      log.push({ kind: 'miss', text: `${nameOf(allies, p.cast.allyId)}の弾は外れた` })
    }
    allyShots.push({
      allyId: p.cast.allyId,
      kind: 'projectile',
      path,
      flight,
      misfirePos,
      carves: p.carves,
      hitEnemyId,
      hitArcLen,
      sweptEnemyIds: [],
    })
  }

  // === 6. 敵弾が味方へ命中（パス上で最初に当たった味方。逸れれば回避） ===
  for (const shot of enemyShots) {
    if (shot.blocked) continue
    const allyTargets: Target[] = allies
      .filter((a) => a.hp > 0)
      .map((a) => ({ id: a.id, pos: a.pos, radius: GAME.allyHitbox }))
    const hit = firstHitAmong(shot.flight.samples, allyTargets)
    if (!hit || hit.speed <= 0) continue
    const bZ = zfieldAt(shot.traj, hit.pos)
    const bAttr = attributeOf(bZ)
    const bStr = strengthOf(bZ)
    const idx = allies.findIndex((a) => a.id === hit.id)
    if (idx < 0) continue
    const damage = hit.speed * bStr * affinityMultiplier(bAttr, allies[idx].element)
    allies[idx] = {
      ...allies[idx],
      hp: Math.max(0, allies[idx].hp - damage),
      statuses: addStatus(allies[idx].statuses, makeStatus(bAttr, bStr)),
    }
    shot.reachedTarget = true
    shot.damage = damage
    shot.hitAllyId = allies[idx].id
    shot.hitArcLen = hit.arcLen
    log.push({
      kind: 'enemyHit',
      text: `${nameOf(enemies, shot.enemyId)}の術式が${allies[idx].name}に命中！ ${damage.toFixed(0)} ダメージ`,
    })
  }

  return { allies, enemies, obstacles, log, allyShots, enemyShots }
}

export { straightPath }
