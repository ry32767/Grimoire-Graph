// 戦闘ループ＆勝敗判定（#15：パーティ戦）。HP・状態異常・障害物・ターン状態の遷移。純粋関数。
import type { Ally, AllyCast, BattleState, LogEntry, Stage } from './types'
import { tickStatuses } from './status'
import { resolveTurn, type ResolveResult } from './turn'
import { finaleVariant } from './enemyAI'

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
    bossPhases: stage.bossPhases,
    bossPhase: 0,
  }
}

function checkOutcome(state: BattleState): BattleState['outcome'] {
  if (state.allies.every((a) => a.hp <= 0)) return 'gameover'
  // 断末魔（#45）：ボスが倒れても「最後の一手」を解決し切るまで勝敗を確定しない
  if (state.finale === 'pending' || state.finale === 'cast') return 'ongoing'
  if (state.enemies.every((e) => e.hp <= 0)) return 'cleared'
  return 'ongoing'
}

/** ボスが今倒れたら断末魔を予約する（#45）。既に予約/解決済みなら何もしない。 */
function markFinaleIfBossDown(state: BattleState, log: LogEntry[]): BattleState {
  if (state.finale) return state
  const boss = state.enemies.find((e) => e.boss)
  if (!boss || boss.hp > 0) return state
  log.push({ kind: 'info', text: '守護者の力が尽きた――頭上に三つの綻びが同時に開く！' })
  return { ...state, finale: 'pending' }
}

/**
 * ボスの HP フェーズ移行（#45・06b §6 第7面）：HP 割合がしきいを下回ったら床が崩れ、
 * アリーナ（障害物）を差し替え、同時発射数を変え、（指定があれば）眷属を間引く。
 * 崩落で場の結界（周回）はすべて霧散する。
 */
function applyBossPhases(state: BattleState, log: LogEntry[]): BattleState {
  const phases = state.bossPhases ?? []
  if (phases.length === 0) return state
  const boss = state.enemies.find((e) => e.boss)
  if (!boss || boss.hp <= 0) return state
  const ratio = boss.hp / boss.maxHp
  let target = 0
  for (let i = 0; i < phases.length; i++) if (ratio <= phases[i].hpBelow) target = i + 1
  const current = state.bossPhase ?? 0
  if (target <= current) return state
  const ph = phases[target - 1]
  log.push({ kind: 'info', text: '床にひびが走り、崩れた――三人と守護者ごと、下の階層へ落ちていく。' })
  const enemies = state.enemies.map((e) => {
    if (e.boss) return { ...e, castCount: ph.castCount }
    if (ph.cullMinions && e.hp > 0) {
      log.push({ kind: 'info', text: `${e.name}は崩落に呑まれた。` })
      return { ...e, hp: 0 }
    }
    return e
  })
  return {
    ...state,
    enemies,
    obstacles: ph.obstacles.map((o) => ({ ...o, carves: [...o.carves] })),
    orbits: [], // 崩落で持続結界は霧散
    bossPhase: target,
  }
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

  // 敵の状態異常を減衰し、ひるみ中の敵は発射しない。
  // 発射頻度（06b §2）：fireEvery 間隔の敵（暴発型など）は該当ターンのみ発射する。
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
    const every = Math.max(1, e.fireEvery ?? 1)
    const onCadence = (state.turn + (e.fireOffset ?? 0)) % every === 0
    const canCast = hp > 0 && state.mechanics.enemyFire && !t.impaired && onCadence
    if (canCast) castingEnemyIds.push(e.id)
    // 守護型の交互張り（05b §5.4）：ターンごとに光⇔闇のオーラを張り替える（奇数ターン=光）
    const guardZSign = e.alternatingAura ? ((state.turn % 2 === 1 ? 1 : -1) as 1 | -1) : e.guardZSign
    return { ...e, hp, statuses: t.statuses, guardZSign }
  })

  let next: BattleState = { ...state, allies, enemies, phase: 'compose' }

  // DoT でボスが今倒れた場合も断末魔を予約する（#45）
  next = markFinaleIfBossDown(next, log)

  // 断末魔（#45）：予約された「最後の一手」をこのターンで晒す。
  // ボスを暴発型3連の変異体に置き換え（＝ゴースト予告にもそのまま反映）、HP0 でも特例的に発射させる。
  if (next.finale === 'pending') {
    const boss = next.enemies.find((e) => e.boss)
    if (boss) {
      next = { ...next, enemies: next.enemies.map((e) => (e.boss ? finaleVariant(e) : e)), finale: 'cast' }
      castingEnemyIds.push(boss.id)
      log.push({ kind: 'info', text: '最後の一手――三つの綻びが、三人へ向かって開いていく。' })
    }
  }

  next.log = [...state.log, ...log]
  next.outcome = checkOutcome(next)
  return { state: next, castingEnemyIds, impairedAllyIds }
}

/** 味方の同時発射を適用して解決し、勝敗を判定する。opts は instability（04b）の伝搬。 */
export function resolveAllyCasts(
  state: BattleState,
  casts: AllyCast[],
  castingEnemyIds: string[],
  opts?: { instability?: number; misfireRoll?: number },
): { state: BattleState; resolution: ResolveResult } {
  const resolution = resolveTurn({
    allies: state.allies,
    casts,
    enemies: state.enemies,
    castingEnemyIds,
    obstacles: state.obstacles,
    mechanics: state.mechanics,
    activeOrbits: state.orbits ?? [],
    instability: opts?.instability,
    misfireRoll: opts?.misfireRoll,
  })

  let next: BattleState = {
    ...state,
    allies: resolution.allies,
    enemies: resolution.enemies,
    obstacles: resolution.obstacles,
    orbits: resolution.orbits,
    turn: state.turn + 1,
    phase: 'resolve',
  }

  const extraLog: LogEntry[] = []
  // 断末魔（#45）：発動ターンを解決し切ったら done（次の checkOutcome で勝敗が確定する）
  if (next.finale === 'cast') next = { ...next, finale: 'done' }
  // ボスが今倒れたら断末魔を予約（勝敗判定より先・#45）
  next = markFinaleIfBossDown(next, extraLog)
  // HP フェーズ移行（床崩落・#45）
  next = applyBossPhases(next, extraLog)

  next.log = [...state.log, ...resolution.log, ...extraLog]
  next.outcome = checkOutcome(next)
  if (next.outcome === 'cleared') next.log = [...next.log, { kind: 'info', text: '全ての敵を撃破した！' }]
  if (next.outcome === 'gameover') next.log = [...next.log, { kind: 'info', text: '自陣営は全滅した…' }]
  return { state: next, resolution }
}

/** 戦闘が決着したか */
export function isBattleOver(state: BattleState): boolean {
  return state.outcome !== 'ongoing'
}
