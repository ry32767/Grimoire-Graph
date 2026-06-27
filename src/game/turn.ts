// ターン解決（#15：自陣営3人 vs 敵チーム）。同時発射→解決。純粋関数。
// 解決順：敵弾構築 → 味方発射の分類 → 防御(軌道型リング迎撃/発射型パリィ) → 障害物の削り
//          → 攻撃(命中/掃射/暴発) → 敵弾が味方へ命中。
import type {
  Ally,
  AllyCast,
  Enemy,
  Flight,
  LogEntry,
  Mechanics,
  Obstacle,
  Vec2,
  ZPoint,
} from './types'
import {
  attributeOf,
  strengthOf,
  computeDamage,
  affinityMultiplier,
  trajectoryZ,
} from './attribute'
import { simulateFlight, simulateWithLosses, simulatePath, type LossEvent } from './physics'
import { firstHit, firstHitAmong, type Target } from './collision'
import { firstCrossing, resolveParry } from './parry'
import { applyObstacleHit } from './obstacle'
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
  blocked: boolean
  reachedTarget: boolean
  damage: number
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
}

/** 同時発射の解決。入力は変更せず、新しい状態とログ・飛行データを返す。 */
export function resolveTurn(input: ResolveInput): ResolveResult {
  const { mechanics } = input
  const log: LogEntry[] = []
  const allies = input.allies.map((a) => ({ ...a, statuses: [...a.statuses] }))
  const enemies = input.enemies.map((e) => ({ ...e, statuses: [...e.statuses] }))
  const obstacles = input.obstacles.map((o) => ({ ...o }))

  const allyById = (id: string) => allies.find((a) => a.id === id)
  const enemyTargets = (): Target[] =>
    enemies.filter((e) => e.hp > 0).map((e) => ({ id: e.id, pos: e.pos, radius: e.hitboxRadius }))

  // === 1. 敵弾を構築（敵AIが得意関数で最大ダメージへ最適化・#2/#17。z は castZ 一定） ===
  const enemyShots: EnemyShot[] = []
  for (const e of enemies) {
    if (!input.castingEnemyIds.includes(e.id) || e.hp <= 0) continue
    const plan = planEnemyShot(e, allies, obstacles)
    if (!plan) continue
    const { path, flight } = enemyFlight(plan.trajectory, e.castInitialSpeed, e.castZ)
    enemyShots.push({
      enemyId: e.id,
      targetAllyId: plan.targetId,
      path,
      flight,
      castZ: e.castZ,
      blocked: false,
      reachedTarget: false,
      damage: 0,
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
      plans.push({ cast, kind, ring, ringSpeed: meanSpeed(ringFlight), freeFlight: null })
    } else {
      const freeFlight = simulateFlight(cast.trajectory, cast.initialSpeed)
      plans.push({ cast, kind, ring: null, ringSpeed: 0, freeFlight })
    }
  }

  // === 3. 防御：軌道型リングの迎撃 → 発射型のパリィ（敵弾を削る） ===
  for (const shot of enemyShots) {
    // 3a. 軌道型リングが境界で迎撃
    for (const p of plans) {
      if (p.kind !== 'orbit' || !p.ring || shot.blocked) continue
      const inter = ringInterception(p.ring, shot.path)
      if (!inter.crossed || inter.ringZ === undefined || inter.enemyIndex === undefined) continue
      const loss = orbitBlockLoss(inter.ringZ, attributeOf(shot.castZ))
      const crossArc = shot.flight.samples[Math.min(inter.enemyIndex, shot.flight.samples.length - 1)].arcLen
      shot.flight = simulatePath(shot.path, shot.flight.samples[0]?.speed ?? 0, () => shot.castZ, [
        { arcLen: crossArc, deltaV: loss },
      ])
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
      const eSample = shot.flight.samples[Math.min(cross.indexB, shot.flight.samples.length - 1)]
      const pZ = trajectoryZ(p.cast.trajectory, pSample.param)
      const pAttr = attributeOf(pZ)
      const pStr = strengthOf(pZ)
      const eAttr = attributeOf(shot.castZ)
      const eStr = strengthOf(shot.castZ)
      const parry = resolveParry(pAttr, pSample.speed, pSample.speed * pStr, eAttr, eSample.speed, eSample.speed * eStr)
      if (parry.passthrough) continue
      const crossArc = eSample.arcLen
      shot.flight = simulatePath(shot.path, shot.flight.samples[0]?.speed ?? 0, () => shot.castZ, [
        { arcLen: crossArc, deltaV: eSample.speed - parry.speedB },
      ])
      log.push({ kind: 'parry', text: `${nameOf(allies, p.cast.allyId)}の弾が敵弾を相殺` })
      if (shot.flight.end === 'vanished') {
        shot.blocked = true
        break
      }
    }
  }

  // === 4. 障害物：各発射型が通過点で耐久＝半径を削り、減速する（#1/#16） ===
  for (const p of plans) {
    if (p.kind !== 'projectile' || !p.freeFlight) continue
    const losses: LossEvent[] = []
    if (mechanics.obstacles) {
      for (let i = 0; i < obstacles.length; i++) {
        const ob = obstacles[i]
        if (ob.durability <= 0 || ob.hitboxRadius <= 0) continue
        const hit = firstHit(p.freeFlight.samples, ob.pos, ob.hitboxRadius)
        if (!hit) continue
        const z = trajectoryZ(p.cast.trajectory, hit.param)
        const power = hit.speed * strengthOf(z)
        const res = applyObstacleHit(ob, power, attributeOf(z))
        obstacles[i] = res.obstacle
        losses.push({ arcLen: hit.arcLen, deltaV: res.speedLoss })
        log.push({ kind: 'obstacle', text: res.destroyed ? '障害物を砕いた' : '障害物が弾を削った' })
      }
    }
    p.freeFlight = simulateWithLosses(p.cast.trajectory, p.cast.initialSpeed, losses)
  }

  // === 5. 攻撃：命中（発射型）／掃射（軌道型）／暴発 ===
  const allyShots: AllyShot[] = []
  for (const p of plans) {
    if (p.kind === 'orbit' && p.ring) {
      const targets: OrbitTarget[] = enemies
        .filter((e) => e.hp > 0)
        .map((e) => ({ id: e.id, pos: e.pos, radius: e.hitboxRadius, element: e.element }))
      const hits = orbitSweep(p.ring, p.ringSpeed, targets)
      for (const h of hits) {
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
      allyShots.push({ allyId: p.cast.allyId, kind: 'orbit', path: p.ring, flight: null, misfirePos: null })
      continue
    }

    // 発射型
    const flight = p.freeFlight!
    const traj = p.cast.trajectory
    const path: ZPoint[] = flight.samples.map((s) => ({ pos: s.pos, z: trajectoryZ(traj, s.param) }))
    let misfirePos: Vec2 | null = null
    const hit = firstHitAmong(flight.samples, enemyTargets())
    if (hit) {
      const idx = enemies.findIndex((e) => e.id === hit.id)
      const enemy = enemies[idx]
      const z = trajectoryZ(traj, hit.param)
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
      const speed = flight.samples.length > 0 ? flight.endSpeed : p.cast.initialSpeed
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
    allyShots.push({ allyId: p.cast.allyId, kind: 'projectile', path, flight, misfirePos })
  }

  // === 6. 敵弾が味方へ命中（パス上で最初に当たった味方。逸れれば回避） ===
  for (const shot of enemyShots) {
    if (shot.blocked) continue
    const allyTargets: Target[] = allies
      .filter((a) => a.hp > 0)
      .map((a) => ({ id: a.id, pos: a.pos, radius: GAME.allyHitbox }))
    const hit = firstHitAmong(shot.flight.samples, allyTargets)
    if (!hit || hit.speed <= 0) continue
    const bAttr = attributeOf(shot.castZ)
    const bStr = strengthOf(shot.castZ)
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
    log.push({
      kind: 'enemyHit',
      text: `${nameOf(enemies, shot.enemyId)}の術式が${allies[idx].name}に命中！ ${damage.toFixed(0)} ダメージ`,
    })
  }

  return { allies, enemies, obstacles, log, allyShots, enemyShots }
}

export { straightPath }
