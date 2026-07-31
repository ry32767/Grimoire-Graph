// 一時プローブ（#69）：新レイアウトの実プレイ可能性を測る。恒久化したら削除する。
import { describe, it } from 'vitest'
import { createBattleState, prepareTurn, resolveAllyCasts } from './battle'
import { recommendCast } from './recommend'
import { parseExpression } from './functions'
import { constZField } from './zfields'
import { dist } from './coords'
import { isLethal, shouldFirstCollapse } from './misfireInstability'
import { planEnemyShots } from './enemyAI'
import { STAGES } from '../data/stages'
import { makeParty } from '../data/party'
import { FIELD } from '../data/constants'
import type { Trajectory } from './types'

function autoSpamPlay(stageIdx: number, maxTurns: number, roll: number) {
  let state = createBattleState(STAGES[stageIdx], stageIdx, makeParty())
  let count = 0
  let collapseSeen = false
  let t = 0
  let allyDmg = 0
  for (; t < maxTurns && state.outcome === 'ongoing'; t++) {
    const prep = prepareTurn(state)
    if (prep.state.outcome !== 'ongoing') {
      state = prep.state
      break
    }
    const casts = prep.state.allies
      .filter((al) => al.hp > 0 && !prep.impairedAllyIds.includes(al.id))
      .flatMap((al) => {
        const alive = prep.state.enemies.filter((e) => e.hp > 0)
        if (alive.length === 0) return []
        const tgt = alive.reduce((b, e) => (dist(al.pos, e.pos) < dist(al.pos, b.pos) ? e : b))
        const rec = recommendCast(
          al.pos,
          tgt,
          prep.state.mechanics.obstacles ? prep.state.obstacles : [],
          prep.state.rField ?? FIELD.rField,
        )
        const expr = rec.line ? `${rec.line.a}*x` : rec.freeExpr!
        const g = parseExpression(expr, 'x')!
        const traj: Trajectory = {
          mode: 'rotate', g, angle: rec.angle, origin: al.pos, z: constZField(rec.zConst), fieldR: prep.state.rField,
        }
        return [{ allyId: al.id, trajectory: traj, initialSpeed: FIELD.fixedSpeed }]
      })
    const hpBefore = prep.state.allies.reduce((s, a) => s + a.hp, 0)
    const { state: after, resolution } = resolveAllyCasts(prep.state, casts, prep.castingEnemyIds, {
      instability: count,
      misfireRoll: roll,
    })
    allyDmg += Math.max(0, hpBefore - after.allies.reduce((s, a) => s + a.hp, 0))
    count += resolution.misfires.length
    if (collapseSeen && isLethal(count)) return { outcome: 'collapse' as const, turns: t + 1, count, allyDmg, enemyHp: after.enemies.reduce((s, e) => s + Math.max(0, e.hp), 0) }
    if (shouldFirstCollapse(count, stageIdx + 1, after.turn, collapseSeen)) collapseSeen = true
    state = after
  }
  return {
    outcome: state.outcome === 'ongoing' ? ('ongoing' as const) : state.outcome,
    turns: t,
    count,
    allyDmg,
    enemyHp: state.enemies.reduce((s, e) => s + Math.max(0, e.hp), 0),
  }
}

describe('プローブ：新5面の実プレイ', () => {
  it('全員おまかせ連打ボットで各面を自動プレイ', () => {
    for (let i = 0; i < STAGES.length; i++) {
      const r = autoSpamPlay(i, 25, 0.5)
      console.log(
        `[${i + 1}] ${STAGES[i].name}: ${r.outcome} turns=${r.turns} 残敵HP=${r.enemyHp} 味方被弾計=${r.allyDmg} 暴発=${r.count}`,
      )
    }
  }, 900000)

  it('敵AIが初手で命中見込みのある手を作れるか（ターン1）', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const st = createBattleState(STAGES[i], i, makeParty())
      const lines: string[] = []
      for (const e of st.enemies) {
        const plans = planEnemyShots(e, st.allies, st.obstacles, [], st.enemies, st.rField, 0)
        const best = plans.map((p) => Math.round(p.expectedDamage)).join('/')
        lines.push(`${e.name}[${e.role ?? 'attacker'}]=${best || 'なし'}`)
      }
      console.log(`[${i + 1}] ${lines.join('  ')}`)
    }
  }, 900000)
})
