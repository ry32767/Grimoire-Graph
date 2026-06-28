// 敵AI（#2・#17）：敵ごとの「得意関数（系統）」で攻撃を最適化する。純粋関数。
// 各敵は family（直線/弧/波/渦）を持ち、AI は狙い角と形状係数の候補から、
// 狙う味方へ最大ダメージを与える軌道を選ぶ（軌跡型は陣営有利＝強属性で展開）。
import type { Ally, Enemy, EnemyFamily, Flight, Obstacle, Trajectory, Vec2, ZField } from './types'
import { sampleTrajectory, validPrefix } from './coords'
import { simulatePath } from './physics'
import { firstHit } from './collision'
import { isSolidAt } from './obstacle'
import { attributeOf, strengthOf, affinityMultiplier, zfieldAt } from './attribute'
import { constZField } from './zfields'
import { COMBAT, FIELD, GAME } from '../data/constants'

/** 闇の周回1重あたり、敵が見誤る距離（ユニット・#35）。ヒットボックスより大きく外す。 */
const CONCEAL_JITTER = 3.5

/** 文字列IDから安定した方向ベクトルを作る（隠れた味方の見かけ位置をずらす・#35）。 */
function idDir(id: string): Vec2 {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997
  const ang = (h / 997) * Math.PI * 2
  return { x: Math.cos(ang), y: Math.sin(ang) }
}

/** 敵が認識する味方位置（#35）。闇の周回で隠れているほど真の位置から離れて見える。 */
function perceivedPos(ally: Ally): Vec2 {
  const conceal = ally.concealed ?? 0
  if (conceal <= 0) return ally.pos
  const d = idDir(ally.id)
  const mag = conceal * CONCEAL_JITTER
  return { x: ally.pos.x + d.x * mag, y: ally.pos.y + d.y * mag }
}

/**
 * 攻撃属性の強さ候補（#31）：最強 zPeak は近距離で大威力だが |z|>zRef なので減速して失速する。
 * 減速しない zRef は中遠距離でも確実に届く。AI は両方を試し「実際に届く威力」が最大の方を選ぶ。
 */
const ATTACK_Z_MAGS = [FIELD.zPeak, FIELD.zRef]

/**
 * 攻撃用の z 場候補を返す（#28/#31：敵は属性に関係なく光・闇を自由に使う）。
 * 署名の castZField があればそれ1つ、無ければ対象の反対極を ATTACK_Z_MAGS の各強さで突く一定場。
 */
function attackZCandidates(
  enemy: Enemy,
  targetElement: Enemy['element'],
): { z: ZField; zVal: number }[] {
  if (enemy.castZField) return [{ z: enemy.castZField, zVal: enemy.castZ }]
  const sign = targetElement === 'light' ? -1 : 1 // 反対極を突く
  return ATTACK_Z_MAGS.map((m) => ({ z: constZField(sign * m), zVal: sign * m }))
}

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

/** family＋狙い角＋形状係数から敵の軌道を組み立てる（origin=敵位置・z 場つき）。 */
function buildEnemyTrajectory(
  family: EnemyFamily,
  origin: Vec2,
  angle: number,
  shape: number,
  z: ZField,
): Trajectory {
  switch (family) {
    case 'line':
      return { mode: 'rotate', g: () => 0, angle, origin, z }
    case 'arc':
      // 緩い放物の弧（左右に曲がる）
      return { mode: 'rotate', g: (x) => shape * x * x, angle, origin, z }
    case 'wave':
      // 波打って進む（shape=振幅）
      return { mode: 'rotate', g: (x) => shape * Math.sin(0.45 * x), angle, origin, z }
    case 'spiral':
      // 渦巻き（shape=巻きの強さ）。狙い角ぶん回す
      return { mode: 'polar', f: (t) => shape * (t + angle), origin, z }
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

/** 敵の軌道から path と飛行を作る（z は軌道の z 場を位置で評価・#28）。 */
export function enemyFlight(traj: Trajectory, speed: number): { path: Vec2[]; flight: Flight } {
  const path = validPrefix(sampleTrajectory(traj)).map((s) => s.pos)
  const flight = simulatePath(path, speed, (i) => zfieldAt(traj, path[Math.min(i, path.length - 1)]))
  return { path, flight }
}

/** 敵AIの選択結果 */
export interface EnemyPlan {
  trajectory: Trajectory
  targetId: string
  /** 見込みダメージ（0=命中見込みなし＝牽制） */
  expectedDamage: number
}

/** 敵が実際に使う得意関数の系統一覧（#28：family＋families を重複なくまとめる）。 */
function enemyFamilies(enemy: Enemy): EnemyFamily[] {
  if (!enemy.families || enemy.families.length === 0) return [enemy.family]
  return Array.from(new Set([enemy.family, ...enemy.families]))
}

/**
 * 防御ロール（guardian・#28）：自分の周りに周回結界（閉じた円）を張る。
 * z は自陣の属性で最強に張り、味方弾を迎撃する（同属性は透過・反対極は相殺＝#34）。
 */
function planGuardianOrbit(enemy: Enemy): EnemyPlan {
  // 結界は減速しない最大強度 |z|=zRef で張る（#31：|z|>zRef だと結界自身が失速して霧散してしまう）
  const zVal =
    enemy.element === 'light' ? FIELD.zRef : enemy.element === 'dark' ? -FIELD.zRef : FIELD.zRef
  const traj: Trajectory = {
    mode: 'polar',
    f: () => GAME.enemyGuardRadius,
    origin: enemy.pos,
    z: constZField(zVal),
  }
  return { trajectory: traj, targetId: '', expectedDamage: 0 }
}

/**
 * 敵の攻撃を計画する：狙う味方×（狙い角×形状）の候補から、最大ダメージの軌道を選ぶ。
 * どの候補も命中見込みがなければ、最もHPの低い味方へ直進で牽制する。
 */
export function planEnemyShot(enemy: Enemy, allies: Ally[], obstacles: Obstacle[] = []): EnemyPlan | null {
  const alive = allies.filter((a) => a.hp > 0)
  if (alive.length === 0) return null

  // 防御ロール：自陣を守る周回結界を張る（#28）
  if (enemy.role === 'guardian') return planGuardianOrbit(enemy)

  // 闇の周回で完全に隠れた味方は視認不可＝狙えない（#35）。全員隠れていれば見えないなりに撃つ。
  const visible = alive.filter((a) => (a.concealed ?? 0) < COMBAT.orbitConcealFull)
  const candidates = visible.length > 0 ? visible : alive

  // 壁を貫くロール（breaker）は障害物のペナルティを受けない（#28：壁を破壊して届かせる）
  const breaker = enemy.role === 'breaker'
  const families = enemyFamilies(enemy)

  let best: EnemyPlan | null = null
  for (const ally of candidates) {
    // 隠れている味方は見かけの位置（ずれた位置）で狙う＝命中評価もそこに対して行う（#35）
    const aimPos = perceivedPos(ally)
    const base = aimAt(enemy.pos, aimPos)
    // 攻撃の z 場は対象の弱点（反対極）を、強さ違い（zPeak/zRef）で試す（#28/#31：届く威力を最大化）
    const zCands = attackZCandidates(enemy, ally.element)
    // 得意関数を1～2個すべて試す（#28：複数関数を組み合わせて戦う）
    for (const fam of families) {
      const shapes = shapeCandidates(fam)
      const aimOffsets = fam === 'spiral' ? [0] : [-0.28, -0.14, 0, 0.14, 0.28]
      for (const off of aimOffsets) {
       for (const shape of shapes) {
        for (const zc of zCands) {
        const bAttr = attributeOf(zc.zVal)
        const bStr = strengthOf(zc.zVal)
        const traj = buildEnemyTrajectory(fam, enemy.pos, base + off, shape, zc.z)
        const { flight } = enemyFlight(traj, enemy.castInitialSpeed)
        const hit = firstHit(flight.samples, aimPos, GAME.allyHitbox)
        if (!hit || hit.speed <= 0) continue // 失速して届かない（速度0）候補は捨てる（#31）
        // 障害物（素材）が手前にあると弾が削れる＝評価を下げる（breaker は貫くので無視）
        let penalty = 1
        if (!breaker) {
          for (const sm of flight.samples) {
            if (sm.arcLen >= hit.arcLen) break
            if (obstacles.some((ob) => isSolidAt(ob, sm.pos))) {
              penalty = 0.55
              break
            }
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
    }
  }
  if (best) return best

  // 命中見込みなし：最もHPが低い味方へ直進で牽制（見える相手・見かけ位置へ・#35）。
  // 牽制弾も失速しないよう、減速しない zRef（反対極）で撃つ（#31）。
  const target = candidates.reduce((lo, a) => (a.hp < lo.hp ? a : lo))
  const fallbackZ = enemy.castZField ?? constZField((target.element === 'light' ? -1 : 1) * FIELD.zRef)
  return {
    trajectory: buildEnemyTrajectory('line', enemy.pos, aimAt(enemy.pos, perceivedPos(target)), 0, fallbackZ),
    targetId: target.id,
    expectedDamage: 0,
  }
}
