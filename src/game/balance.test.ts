// バランス回帰（#63）：第5面以降は「全員おまかせ」連打だけでは絶対に勝てない。
// App の recommendAll／fireAll と同一挙動のボット（最寄りの敵へ recommendCast・初速 fixedSpeed・
// ひるみ中は撃たない）で自動プレイし、全滅 or 膜の崩壊（04b：致死12回）で必ず敗北することを固定する。
// 敗北の設計（06b §6）：
// - 第5面：鏡像の射手・衛士が開通後に撃ち勝つ（防御なしでは撃ち負ける）。
// - 第6面：封印壁が tough で連打の火力はほぼ通らず、崩し手の暴発が崩壊時計を進める。
// - 第7面：ボスの多重詠唱に防御なしでは耐えられない。
import { describe, it, expect } from 'vitest'
import { createBattleState, prepareTurn, resolveAllyCasts } from './battle'
import { fitRouteToFamilies } from './enemyPlanning/routeFit'
import { recommendCast } from './recommend'
import { parseExpression } from './functions'
import { constZField } from './zfields'
import { dist } from './coords'
import { isLethal, shouldFirstCollapse } from './misfireInstability'
import { STAGES } from '../data/stages'
import { makeParty } from '../data/party'
import { FIELD } from '../data/constants'
import type { AllyCast, Enemy, Trajectory } from './types'

/** App と同じ「全員おまかせ→全員発射」を毎ターン繰り返す。敗北種別つきの結果を返す。 */
function autoSpamPlay(
  stageIdx: number,
  maxTurns: number,
  roll: number,
): { outcome: 'cleared' | 'gameover' | 'collapse' | 'ongoing'; turns: number; count: number } {
  let state = createBattleState(STAGES[stageIdx], stageIdx, makeParty())
  let count = 0 // instability（このステージ開始を 0 とする＝連打に最も有利な条件）
  let collapseSeen = false
  let t = 0
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
    const { state: after, resolution } = resolveAllyCasts(prep.state, casts, prep.castingEnemyIds, {
      instability: count,
      misfireRoll: roll,
    })
    count += resolution.misfires.length
    // App と同じ崩壊判定（04b）：初回崩壊（救済・一度きり）→ 以後 count が上限で破局ゲームオーバー
    if (collapseSeen && isLethal(count)) return { outcome: 'collapse', turns: t + 1, count }
    if (shouldFirstCollapse(count, stageIdx + 1, after.turn, collapseSeen)) collapseSeen = true
    state = after
  }
  return { outcome: state.outcome === 'ongoing' ? 'ongoing' : state.outcome, turns: t, count }
}

describe('第5面以降は「全員おまかせ」連打では勝てない（#63）', () => {
  it('第5面：連打ではクリアできない（守護型を崩せず膠着 or 敗北）', () => {
    // 手描き仕様でステージが拡大（rField=54）したため、防御しない連打は守護型（鏡守のゴーレム）を
    // 崩せず、クリアに至れない（味方の被害も出る）。「連打では勝てない（クリア不能）」を保証する。
    const res = autoSpamPlay(4, 25, 0.5)
    expect(res.outcome).not.toBe('cleared')
  }, 300000)

  it('第6面：連打は膜の崩壊 or 全滅で敗北する（半径ブレの上下でも同じ）', () => {
    for (const roll of [0.1, 0.5, 0.9]) {
      const res = autoSpamPlay(5, 25, roll)
      expect(res.outcome).not.toBe('cleared')
      expect(res.outcome === 'gameover' || res.outcome === 'collapse').toBe(true)
    }
  }, 600000)

  it('第7面：連打は全滅する（クリア不能）', () => {
    const res = autoSpamPlay(6, 25, 0.5)
    expect(res.outcome).not.toBe('cleared')
    expect(res.outcome === 'gameover' || res.outcome === 'collapse').toBe(true)
  }, 300000)
})

/**
 * 第6面の勝ち筋の存在証明（過調整の回帰防止・#63）。対処プレイ：
 * 1. 狙われやすい低HPの味方が「結界役」になり、両極の持続結界（闇r6・光r7）を自分の周囲に維持する。
 *    パリィは威力の引き算で必ず片方が消える＝結界は撃ち合いで消耗するため、消えた極から張り直す。
 * 2. 残る2人は崩し手を光弾（zRef）で撃ってひるみ（光の状態異常）ロックしながら削り切る。
 * 3. 残った番人は、封印核の右脇の回廊を「通過点フィット」（ゲーム内UI相当）の曲線で通して撃つ。
 * この手順で被弾なく・膜をほぼ削らずクリアできることを固定する。
 */
describe('第6面は対処プレイで勝てる（#63・勝ち筋の回帰防止）', () => {
  it('弾色結界→ひるみロック→回廊フィットで無被弾クリアできる', () => {
    let state = createBattleState(STAGES[5], 5, makeParty())
    let count = 0
    let collapseSeen = false
    for (let t = 0; t < 40 && state.outcome === 'ongoing'; t++) {
      const prep = prepareTurn(state)
      if (prep.state.outcome !== 'ongoing') {
        state = prep.state
        break
      }
      const alive = prep.state.enemies.filter((e) => e.hp > 0)
      const pick = (al: { pos: { x: number; y: number } }): Enemy =>
        alive
          .slice()
          .sort((a, b) => {
            const pa = (a.role === 'ruptor' ? 0 : 1) * 1000 + dist(al.pos, a.pos)
            const pb = (b.role === 'ruptor' ? 0 : 1) * 1000 + dist(al.pos, b.pos)
            return pa - pb
          })[0]
      const myRings = (allyId: string) =>
        (prep.state.orbits ?? [])
          .filter((o) => o.owner === 'player' && o.ownerId === allyId)
          .map((o) => (o.ring.reduce((s, p) => s + p.z, 0) >= 0 ? 'light' : 'dark'))
      const casts: AllyCast[] = prep.state.allies
        .filter((al) => al.hp > 0 && !prep.impairedAllyIds.includes(al.id))
        .flatMap((al): AllyCast[] => {
          if (alive.length === 0) return []
          const rings = myRings(al.id)
          // 結界役（先頭の味方＝低HPで狙われやすい）：両極の結界を自分の周囲に維持する。
          // 弾色に合わせた反対極だけが迎撃できる（同極・中立は透過）ので闇r6・光r7の2枚構え。
          // 消耗して消えた極から張り直す（半径違い＝重ね張り可）。
          const darkCount = rings.filter((r) => r === 'dark').length
          const lightCount = rings.filter((r) => r === 'light').length
          const ruptorAlive = alive.some((e) => e.role === 'ruptor')
          if (al.id === prep.state.allies[0].id && ruptorAlive) {
            if (darkCount === 0) {
              const traj: Trajectory = { mode: 'polar', f: () => 6, origin: al.pos, z: constZField(-FIELD.zRef), fieldR: prep.state.rField }
              return [{ allyId: al.id, trajectory: traj, initialSpeed: FIELD.fixedSpeed }]
            }
            if (lightCount === 0) {
              const traj: Trajectory = { mode: 'polar', f: () => 7, origin: al.pos, z: constZField(FIELD.zRef), fieldR: prep.state.rField }
              return [{ allyId: al.id, trajectory: traj, initialSpeed: FIELD.fixedSpeed }]
            }
          }
          const tgt = pick(al)
          if (tgt.role === 'guardian') {
            // 番人攻め：封印核（x5.2）と右壁（x8.6）の間の回廊を通過点フィットで通す
            const route = [al.pos, { x: 6.9, y: -6 }, { x: 6.9, y: 11 }, tgt.pos]
            const fits = fitRouteToFamilies(route, al.pos, ['abs', 'arc', 'poly34'])
            if (fits.length > 0) {
              const fit = fits[t % fits.length] // 形を変えながら撃つ（交互オーラ対策）
              const traj: Trajectory = { mode: 'rotate', g: fit.g, angle: fit.angle, origin: al.pos, z: constZField(-FIELD.zRef), fieldR: prep.state.rField }
              return [{ allyId: al.id, trajectory: traj, initialSpeed: FIELD.fixedSpeed }]
            }
          }
          const rec = recommendCast(al.pos, tgt, prep.state.obstacles, prep.state.rField ?? FIELD.rField)
          const expr = rec.line ? `${rec.line.a}*x` : rec.freeExpr!
          const g = parseExpression(expr, 'x')!
          // 光 zRef＝命中すればひるみで崩し手の詠唱を止める
          const traj: Trajectory = { mode: 'rotate', g, angle: rec.angle, origin: al.pos, z: constZField(FIELD.zRef), fieldR: prep.state.rField }
          return [{ allyId: al.id, trajectory: traj, initialSpeed: FIELD.fixedSpeed }]
        })
      const { state: after, resolution } = resolveAllyCasts(prep.state, casts, prep.castingEnemyIds, {
        instability: count,
        misfireRoll: 0.5,
      })
      count += resolution.misfires.length
      expect(collapseSeen && isLethal(count)).toBe(false) // 崩壊しない
      if (shouldFirstCollapse(count, 6, after.turn, collapseSeen)) collapseSeen = true
      state = after
    }
    expect(state.outcome).toBe('cleared')
    expect(count).toBeLessThanOrEqual(2) // 膜（instability）をほぼ削らずに勝てる
    expect(state.allies.every((a) => a.hp > 0)).toBe(true) // 無被弾（全員生存）
  }, 600000)
})
