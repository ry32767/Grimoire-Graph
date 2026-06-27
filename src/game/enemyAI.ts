// 敵AI（#2・#17）：敵ごとの「得意関数（系統）」で攻撃を最適化する。純粋関数。
// 各敵は family（直線/弧/波/渦）を持ち、AI は狙い角と形状係数の候補から、
// 狙う味方へ最大ダメージを与える軌道を選ぶ（軌跡型は陣営有利＝強属性で展開）。
import type { Ally, Enemy, EnemyFamily, Flight, Obstacle, Trajectory, Vec2 } from './types'
import { sampleTrajectory, validPrefix } from './coords'
import { simulatePath } from './physics'
import { firstHit } from './collision'
import { isSolidAt } from './obstacle'
import { attributeOf, strengthOf, affinityMultiplier } from './attribute'
import { GAME } from '../data/constants'

/** family の見た目情報（スプライトの記号・名称）。 */
export const ARCHETYPES: Record<EnemyFamily, { label: string; glyph: EnemyFamily }> = {
  line: { label: '直進', glyph: 'line' },
  arc: { label: '弧', glyph: 'arc' },
  wave: { label: '波', glyph: 'wave' },
  spiral: { label: '渦', glyph: 'spiral' },
}

/** 敵位置 from から to を向く基準角。 */
function aimAt(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

/** family＋狙い角＋形状係数から敵の軌道を組み立てる（origin=敵位置）。 */
function buildEnemyTrajectory(
  family: EnemyFamily,
  origin: Vec2,
  angle: number,
  shape: number,
): Trajectory {
  switch (family) {
    case 'line':
      return { mode: 'rotate', g: () => 0, angle, origin }
    case 'arc':
      // 緩い放物の弧（左右に曲がる）
      return { mode: 'rotate', g: (x) => shape * x * x, angle, origin }
    case 'wave':
      // 波打って進む（shape=振幅）
      return { mode: 'rotate', g: (x) => shape * Math.sin(0.45 * x), angle, origin }
    case 'spiral':
      // 渦巻き（shape=巻きの強さ）。狙い角ぶん回す
      return { mode: 'polar', f: (t) => shape * (t + angle), origin }
  }
}

/** family ごとの形状係数候補。 */
function shapeCandidates(family: EnemyFamily): number[] {
  switch (family) {
    case 'line':
      return [0]
    case 'arc':
      return [-0.09, -0.04, 0.04, 0.09]
    case 'wave':
      return [1.5, 3]
    case 'spiral':
      return [0.7, 1.1]
  }
}

/** 敵の軌道から path と飛行を作る（z は castZ 一定＝敵の属性）。 */
export function enemyFlight(traj: Trajectory, speed: number, castZ: number): { path: Vec2[]; flight: Flight } {
  const path = validPrefix(sampleTrajectory(traj)).map((s) => s.pos)
  const flight = simulatePath(path, speed, () => castZ)
  return { path, flight }
}

/** 敵AIの選択結果 */
export interface EnemyPlan {
  trajectory: Trajectory
  targetId: string
  /** 見込みダメージ（0=命中見込みなし＝牽制） */
  expectedDamage: number
}

/**
 * 敵の攻撃を計画する：狙う味方×（狙い角×形状）の候補から、最大ダメージの軌道を選ぶ。
 * どの候補も命中見込みがなければ、最もHPの低い味方へ直進で牽制する。
 */
export function planEnemyShot(enemy: Enemy, allies: Ally[], obstacles: Obstacle[] = []): EnemyPlan | null {
  const alive = allies.filter((a) => a.hp > 0)
  if (alive.length === 0) return null

  const bAttr = attributeOf(enemy.castZ)
  const bStr = strengthOf(enemy.castZ)
  const shapes = shapeCandidates(enemy.family)
  const aimOffsets = enemy.family === 'spiral' ? [0] : [-0.28, -0.14, 0, 0.14, 0.28]

  let best: EnemyPlan | null = null
  for (const ally of alive) {
    const base = aimAt(enemy.pos, ally.pos)
    for (const off of aimOffsets) {
      for (const shape of shapes) {
        const traj = buildEnemyTrajectory(enemy.family, enemy.pos, base + off, shape)
        const { flight } = enemyFlight(traj, enemy.castInitialSpeed, enemy.castZ)
        const hit = firstHit(flight.samples, ally.pos, GAME.allyHitbox)
        if (!hit) continue
        // 障害物（素材）が手前にあると弾が削れる＝評価を下げる
        let penalty = 1
        for (const sm of flight.samples) {
          if (sm.arcLen >= hit.arcLen) break
          if (obstacles.some((ob) => isSolidAt(ob, sm.pos))) {
            penalty = 0.55
            break
          }
        }
        const baseDmg = hit.speed * bStr * affinityMultiplier(bAttr, ally.element) * penalty
        // とどめを刺せる相手を最優先、次に手負い（割合）を優先
        const killBonus = baseDmg >= ally.hp ? 2.2 : 1
        const woundFocus = 1 + (1 - ally.hp / ally.maxHp) * 0.5
        // 絶対HPが低い相手をわずかに優先（同割合なら低HPを狙う）
        const lowHpBias = 1 + Math.max(0, (60 - ally.hp) / 60) * 0.25
        const score = baseDmg * killBonus * woundFocus * lowHpBias
        if (!best || score > best.expectedDamage) {
          best = { trajectory: traj, targetId: ally.id, expectedDamage: score }
        }
      }
    }
  }
  if (best) return best

  // 命中見込みなし：最もHPが低い味方へ直進で牽制
  const target = alive.reduce((lo, a) => (a.hp < lo.hp ? a : lo))
  return {
    trajectory: buildEnemyTrajectory('line', enemy.pos, aimAt(enemy.pos, target.pos), 0),
    targetId: target.id,
    expectedDamage: 0,
  }
}
