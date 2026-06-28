// 戦闘ループ＆勝敗判定（#15：パーティ戦）。HP・状態異常・障害物・ターン状態の遷移。純粋関数。
import type { Ally, AllyCast, BattleState, LogEntry, Stage } from './types'
import { tickStatuses } from './status'
import { resolveTurn, type ResolveResult } from './turn'

/** ステージ定義＋パーティから戦闘状態を初期化する（HPは各ステージ開始時に全快）。 */
export function createBattleState(stage: Stage, stageIndex: number, party: Ally[]): BattleState {
  return {
    stageIndex,
    allies: party.map((a) => ({ ...a, hp: a.maxHp, statuses: [] })),
    enemies: stage.enemies.map((e) => ({ ...e, statuses: [...e.statuses] })),
    obstacles: stage.obstacles.map((o) => ({ ...o, carves: [...o.carves] })),
    mechanics: stage.mechanics,
    turn: 1,
    phase: 'enemyReveal',
    log: [{ kind: 'info', text: `${stage.name} 開始` }],
    outcome: 'ongoing',
    orbits: [],
  }
}

function checkOutcome(state: BattleState): BattleState['outcome'] {
  if (state.allies.every((a) => a.hp <= 0)) return 'gameover'
  if (state.enemies.every((e) => e.hp <= 0)) return 'cleared'
  return 'ongoing'
}

/**
 * ターン開始処理：状態異常をターン減衰（DoT適用・ひるみ判定）し、
 * このターン発射できる敵ID・行動できない（ひるみ）味方IDを返す。
 */
export function prepareTurn(state: BattleState): {
  state: BattleState
  castingEnemyIds: string[]
  impairedAllyIds: string[]
} {
  const log: LogEntry[] = []

  // 味方の状態異常を減衰（DoT・ひるみ）
  const impairedAllyIds: string[] = []
  const allies = state.allies.map((a) => {
    if (a.hp <= 0) return a
    const t = tickStatuses(a.statuses)
    let hp = a.hp
    if (t.burnDamage > 0) {
      hp = Math.max(0, hp - t.burnDamage)
      log.push({ kind: 'status', text: `継続ダメージ：${a.name}に ${t.burnDamage.toFixed(0)}` })
    }
    if (t.impaired) {
      impairedAllyIds.push(a.id)
      log.push({ kind: 'status', text: `${a.name}はひるんで動けない` })
    }
    return { ...a, hp, statuses: t.statuses }
  })

  // 敵の状態異常を減衰し、ひるみ中の敵は発射しない
  const castingEnemyIds: string[] = []
  const enemies = state.enemies.map((e) => {
    if (e.hp <= 0) return e
    const t = tickStatuses(e.statuses)
    let hp = e.hp
    if (t.burnDamage > 0) {
      hp = Math.max(0, hp - t.burnDamage)
      log.push({ kind: 'status', text: `継続ダメージ：${e.name}に ${t.burnDamage.toFixed(0)}` })
    }
    if (t.impaired) log.push({ kind: 'status', text: `${e.name}はひるんで動けない` })
    const canCast = hp > 0 && state.mechanics.enemyFire && !t.impaired
    if (canCast) castingEnemyIds.push(e.id)
    return { ...e, hp, statuses: t.statuses }
  })

  const next: BattleState = {
    ...state,
    allies,
    enemies,
    phase: 'compose',
    log: [...state.log, ...log],
  }
  next.outcome = checkOutcome(next)
  return { state: next, castingEnemyIds, impairedAllyIds }
}

/** 味方の同時発射を適用して解決し、勝敗を判定する。 */
export function resolveAllyCasts(
  state: BattleState,
  casts: AllyCast[],
  castingEnemyIds: string[],
): { state: BattleState; resolution: ResolveResult } {
  const resolution = resolveTurn({
    allies: state.allies,
    casts,
    enemies: state.enemies,
    castingEnemyIds,
    obstacles: state.obstacles,
    mechanics: state.mechanics,
    activeOrbits: state.orbits ?? [],
  })

  const next: BattleState = {
    ...state,
    allies: resolution.allies,
    enemies: resolution.enemies,
    obstacles: resolution.obstacles,
    orbits: resolution.orbits,
    turn: state.turn + 1,
    phase: 'resolve',
    log: [...state.log, ...resolution.log],
  }
  next.outcome = checkOutcome(next)
  if (next.outcome === 'cleared') next.log = [...next.log, { kind: 'info', text: '全ての敵を撃破した！' }]
  if (next.outcome === 'gameover') next.log = [...next.log, { kind: 'info', text: '自陣営は全滅した…' }]
  return { state: next, resolution }
}

/** 戦闘が決着したか */
export function isBattleOver(state: BattleState): boolean {
  return state.outcome !== 'ongoing'
}
