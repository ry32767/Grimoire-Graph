// 戦闘ループ＆勝敗判定（機能13）。HP・状態異常・シールド・障害物・ターン状態の遷移。純粋関数。
import type { BattleState, LogEntry, PlayerAction, Stage } from './types'
import { tickStatuses } from './status'
import { resolveTurn, type ResolveResult } from './turn'

/** ステージ定義から戦闘状態を初期化する（ステージデータは変更しない）。 */
export function createBattleState(stage: Stage, stageIndex: number, playerMaxHp: number): BattleState {
  return {
    stageIndex,
    field: stage.field,
    fieldName: stage.fieldName,
    player: { hp: playerMaxHp, maxHp: playerMaxHp, statuses: [], shield: null },
    enemies: stage.enemies.map((e) => ({ ...e, statuses: [...e.statuses] })),
    obstacles: stage.obstacles.map((o) => ({ ...o })),
    mechanics: stage.mechanics,
    turn: 1,
    phase: 'enemyReveal',
    log: [{ kind: 'info', text: `${stage.name} 開始` }],
    outcome: 'ongoing',
  }
}

function checkOutcome(state: BattleState): BattleState['outcome'] {
  if (state.player.hp <= 0) return 'gameover'
  if (state.enemies.every((e) => e.hp <= 0)) return 'cleared'
  return 'ongoing'
}

/**
 * ターン開始処理：状態異常をターン減衰（DoT 適用・ひるみ判定）し、敵の発射可否を決める。
 * 敵公開フェーズへ移り、このターン発射する敵IDを返す。
 */
export function prepareTurn(state: BattleState): { state: BattleState; castingEnemyIds: string[] } {
  const log: LogEntry[] = []

  // プレイヤーの状態異常を減衰（DoT）
  const pTick = tickStatuses(state.player.statuses)
  let playerHp = state.player.hp
  if (pTick.burnDamage > 0) {
    playerHp = Math.max(0, playerHp - pTick.burnDamage)
    log.push({ kind: 'status', text: `継続ダメージ：術者に ${pTick.burnDamage.toFixed(0)}` })
  }

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
    player: { ...state.player, hp: playerHp, statuses: pTick.statuses },
    enemies,
    phase: 'compose',
    log: [...state.log, ...log],
  }
  next.outcome = checkOutcome(next)
  return { state: next, castingEnemyIds }
}

/** プレイヤーの行動を適用して同時発射を解決し、勝敗を判定する。 */
export function resolvePlayerAction(
  state: BattleState,
  action: PlayerAction,
  castingEnemyIds: string[],
): { state: BattleState; resolution: ResolveResult } {
  const resolution = resolveTurn({
    field: state.field,
    player: state.player,
    enemies: state.enemies,
    castingEnemyIds,
    obstacles: state.obstacles,
    action,
    mechanics: state.mechanics,
  })

  const next: BattleState = {
    ...state,
    player: resolution.player,
    enemies: resolution.enemies,
    obstacles: resolution.obstacles,
    turn: state.turn + 1,
    phase: 'resolve',
    log: [...state.log, ...resolution.log],
  }
  next.outcome = checkOutcome(next)
  if (next.outcome === 'cleared') next.log = [...next.log, { kind: 'info', text: '全ての敵を撃破した！' }]
  if (next.outcome === 'gameover') next.log = [...next.log, { kind: 'info', text: '術者は倒れた…' }]
  return { state: next, resolution }
}

/** 戦闘が決着したか */
export function isBattleOver(state: BattleState): boolean {
  return state.outcome !== 'ongoing'
}
