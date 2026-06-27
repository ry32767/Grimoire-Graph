// ターン解決：敵公開 → プレイヤー後出し → 同時発射 → 解決（機能6・13）。
// 解決順序：物理 → パリィ → 障害物 → 命中 → ダメージ/状態異常（勝敗は battle で判定）。純粋関数。
//
// 新モデル：属性は「弾の関数値 z」で決まる。プレイヤー弾は軌道の関数値 g(x)/f(θ)、
// 敵弾は enemy.castZ（符号=属性, |z|=強度）。
import type {
  Enemy,
  Flight,
  LogEntry,
  Mechanics,
  Obstacle,
  PlayerAction,
  PlayerState,
  Shield,
  Vec2,
} from './types'
import {
  attributeOf,
  strengthOf,
  computeDamage,
  dominantAttribute,
  trajectoryZ,
  affinityMultiplier,
} from './attribute'
import { simulateFlight, simulateWithLosses, simulatePath, type LossEvent } from './physics'
import { firstHitAmong, firstHit } from './collision'
import { firstCrossing, resolveParry } from './parry'
import { applyObstacleHit } from './obstacle'
import { crossesShield, applyShieldHit } from './shield'
import { resolveMisfire } from './misfire'
import { makeStatus, addStatus } from './status'

/** 敵弾の描画・解決用データ */
export interface EnemyShot {
  enemyId: string
  path: Vec2[]
  flight: Flight
  /** 敵弾が帯びる z（高さ＝属性） */
  castZ: number
  blocked: boolean
  parried: boolean
  reachedPlayer: boolean
  damage: number
}

export interface ResolveInput {
  player: PlayerState
  enemies: Enemy[]
  /** このターン実際に発射する敵のID（ひるみ等で発射しない敵は除外） */
  castingEnemyIds: string[]
  obstacles: Obstacle[]
  action: PlayerAction
  mechanics: Mechanics
}

export interface ResolveResult {
  player: PlayerState
  enemies: Enemy[]
  obstacles: Obstacle[]
  log: LogEntry[]
  playerFlight: Flight | null
  enemyShots: EnemyShot[]
}

/** 敵の位置から原点（術者）へ向かう直線パスを生成する。 */
function enemyPath(from: Vec2, steps = 40): Vec2[] {
  const path: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    path.push({ x: from.x * (1 - t), y: from.y * (1 - t) })
  }
  return path
}

/** 同時発射の解決。入力は変更せず、新しい状態とログ・飛行データを返す。 */
export function resolveTurn(input: ResolveInput): ResolveResult {
  const { mechanics, action } = input
  const log: LogEntry[] = []
  const enemies = input.enemies.map((e) => ({ ...e, statuses: [...e.statuses] }))
  const obstacles = input.obstacles.map((o) => ({ ...o }))
  const player: PlayerState = { ...input.player, statuses: [...input.player.statuses] }

  // 防御行動：結界を展開
  let activeShield: Shield | null = player.shield
  if (action.kind === 'shield') {
    activeShield = action.shield
    player.shield = action.shield
    log.push({ kind: 'shield', text: `結界（${action.shield.shape === 'circle' ? '円' : '楕円'}）を展開した` })
  }

  // === 1. 物理：敵弾を構築（z は敵の castZ 一定） ===
  const enemyShots: EnemyShot[] = []
  for (const e of enemies) {
    if (!input.castingEnemyIds.includes(e.id)) continue
    const path = enemyPath(e.pos)
    const flight = simulatePath(path, e.castInitialSpeed, () => e.castZ)
    enemyShots.push({
      enemyId: e.id,
      path,
      flight,
      castZ: e.castZ,
      blocked: false,
      parried: false,
      reachedPlayer: false,
      damage: 0,
    })
  }

  let playerFlight: Flight | null = null

  if (action.kind === 'attack') {
    const traj = action.trajectory
    const freeFlight = simulateFlight(traj, action.initialSpeed)
    const losses: LossEvent[] = []

    // === 2. パリィ：自弾と敵弾の最初の交差を解決 ===
    if (mechanics.parry && freeFlight.samples.length > 1) {
      const playerPath = freeFlight.samples.map((s) => s.pos)
      let best: { shot: EnemyShot; indexA: number; indexB: number } | null = null
      for (const shot of enemyShots) {
        const cross = firstCrossing(playerPath, shot.path)
        if (cross && (best === null || cross.indexA < best.indexA)) {
          best = { shot, indexA: cross.indexA, indexB: cross.indexB }
        }
      }
      if (best) {
        const pSample = freeFlight.samples[best.indexA]
        const eSample = best.shot.flight.samples[Math.min(best.indexB, best.shot.flight.samples.length - 1)]
        // 自弾の支配属性（経路で |z| 最大）と、敵弾の属性（castZ）でパリィ判定
        const pDom = dominantAttribute(traj, freeFlight.samples)
        const eAttr = attributeOf(best.shot.castZ)
        const eStr = strengthOf(best.shot.castZ)
        const pPower = pSample.speed * pDom.strength
        const ePower = eSample.speed * eStr
        const parry = resolveParry(pDom.attr, pSample.speed, pPower, eAttr, eSample.speed, ePower)
        if (!parry.passthrough) {
          log.push({ kind: 'parry', text: `パリィ：${pDom.attr === 'light' ? '光' : '闇'}×${eAttr === 'light' ? '光' : '闇'} が衝突` })
          losses.push({ arcLen: pSample.arcLen, deltaV: pSample.speed - parry.speedA })
          if (parry.vanishB) {
            best.shot.parried = true
            log.push({ kind: 'parry', text: '敵弾を相殺した' })
          }
          if (parry.vanishA) log.push({ kind: 'parry', text: '自弾は相殺で消えた' })
        }
      }
    }

    // === 3. 障害物：自弾の通過点で速度を削り耐久を削る ===
    if (mechanics.obstacles) {
      for (let i = 0; i < obstacles.length; i++) {
        const ob = obstacles[i]
        if (ob.durability <= 0) continue
        const hit = firstHit(freeFlight.samples, ob.pos, ob.hitboxRadius)
        if (hit) {
          const z = trajectoryZ(traj, hit.param)
          const power = hit.speed * strengthOf(z)
          const res = applyObstacleHit(ob, power, attributeOf(z))
          obstacles[i] = res.obstacle
          losses.push({ arcLen: hit.arcLen, deltaV: res.speedLoss })
          log.push({ kind: 'obstacle', text: res.destroyed ? '障害物を破壊した' : '障害物が弾速を削った' })
        }
      }
    }

    // 減衰イベントを適用して最終飛行を求める
    playerFlight = simulateWithLosses(traj, action.initialSpeed, losses)

    // === 4&5. 命中 → ダメージ/状態異常（z は命中点の関数値） ===
    const targets = enemies
      .filter((e) => e.hp > 0)
      .map((e) => ({ id: e.id, pos: e.pos, radius: e.hitboxRadius }))
    const hit = firstHitAmong(playerFlight.samples, targets)
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
        text: `${enemy.name}に命中！ 速度${dmg.speed.toFixed(1)}×強度${dmg.strength.toFixed(1)}×相性${dmg.affinity} = ${dmg.damage.toFixed(0)} ダメージ`,
      })
    } else if (playerFlight.end === 'invalid' || playerFlight.end === 'outOfField') {
      // === 6. 暴発（命中せず軌道がエラー終端）===
      const point = { type: playerFlight.end, pos: playerFlight.endPos }
      const speed = playerFlight.samples.length > 0 ? playerFlight.endSpeed : action.initialSpeed
      const mis = resolveMisfire(point, speed, enemies.map((e) => ({ id: e.id, pos: e.pos })))
      for (const id of mis.hitIds) {
        const idx = enemies.findIndex((e) => e.id === id)
        if (idx >= 0)
          enemies[idx] = {
            ...enemies[idx],
            hp: Math.max(0, enemies[idx].hp - mis.damage),
            statuses: mis.statuses.reduce((acc, s) => addStatus(acc, s), enemies[idx].statuses),
          }
      }
      if (mis.selfHit) {
        player.hp = Math.max(0, player.hp - mis.damage)
        player.statuses = mis.statuses.reduce((acc, s) => addStatus(acc, s), player.statuses)
      }
      log.push({
        kind: 'misfire',
        text: `術式の綻び（暴発）！ ${mis.damage.toFixed(0)} のAoEダメージ${mis.selfHit ? '（術者も巻き込み）' : ''}`,
      })
    } else {
      log.push({ kind: 'miss', text: '外れ。ダメージなし' })
    }
  }

  // === 7. 敵弾の解決：結界 → 術者への命中（z は敵の castZ 一定） ===
  for (const shot of enemyShots) {
    if (shot.parried) continue
    const bAttr = attributeOf(shot.castZ)
    const bStr = strengthOf(shot.castZ)
    let reachSpeed = shot.flight.endSpeed
    // 結界
    if (mechanics.shield && activeShield && activeShield.durability > 0) {
      const cross = crossesShield(shot.path, activeShield)
      if (cross) {
        const crossSample = shot.flight.samples[Math.min(cross.index, shot.flight.samples.length - 1)]
        const bPow = crossSample.speed * bStr
        const sh = applyShieldHit(activeShield, bPow, bAttr, crossSample.speed)
        activeShield = sh.shield
        player.shield = sh.broken ? null : sh.shield
        if (sh.broken) log.push({ kind: 'shield', text: '結界が割れた' })
        if (sh.blocked) {
          shot.blocked = true
          log.push({ kind: 'shield', text: '結界が敵弾を止めた' })
          continue
        }
        // 結界通過後の速度で原点まで再計算
        const reFlight = simulatePath(shot.path, shot.flight.samples[0].speed, () => shot.castZ, [
          { arcLen: crossSample.arcLen, deltaV: crossSample.speed - sh.newBulletSpeed },
        ])
        shot.flight = reFlight
        reachSpeed = reFlight.end === 'vanished' ? 0 : reFlight.endSpeed
        if (reachSpeed <= 0) {
          shot.blocked = true
          continue
        }
      }
    }
    // 術者へ命中（プレイヤーは中立扱い＝相性×1.0）
    shot.reachedPlayer = true
    const damage = reachSpeed * bStr * affinityMultiplier(bAttr, 'neutral')
    player.hp = Math.max(0, player.hp - damage)
    player.statuses = addStatus(player.statuses, makeStatus(bAttr, bStr))
    shot.damage = damage
    const ename = enemies.find((e) => e.id === shot.enemyId)?.name ?? '敵'
    log.push({ kind: 'enemyHit', text: `${ename}の術式が術者に命中！ ${damage.toFixed(0)} ダメージ` })
  }

  return { player, enemies, obstacles, log, playerFlight, enemyShots }
}

export { enemyPath }
