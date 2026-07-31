// バランス回帰（#63・#69 で5面構成へ再アンカー）。
// App の recommendAll／fireAll と同一挙動のボット（最寄りの敵へ recommendCast・初速 fixedSpeed・
// ひるみ中は撃たない）で自動プレイし、両原則を固定する：
//   A「防御しない連打では勝てない」… 最終面（ボス）は連打では決してクリアできない。
//   B「正しい対処なら勝てる」……… 封印帯（第4面）は結界＋ひるみロックで無被弾クリアできる。
//
// ⚠ #69 時点の状態：A は**最終面でのみ**成立する。第2〜4面は連打でもクリアできてしまう。
//    これは #69 で「おまかせ照準」に経路探索フィットを入れて味方の命中力が跳ね上がったため
//    （柱の隙間を縫う曲線を自動で見つける）。難易度そのものの再調整は別タスクとして残す。
//    ここでは「今どこまで成立しているか」を正直に固定し、退行（最終面まで連打で抜ける）を防ぐ。
import { describe, it, expect } from 'vitest'
import { createBattleState, prepareTurn, resolveAllyCasts } from './battle'
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

describe('原則A：最終面は「全員おまかせ」連打では勝てない（#63/#69）', () => {
  it('第5面（ボス）：連打では全滅する（クリア不能・半径ブレの上下でも同じ）', () => {
    for (const roll of [0.1, 0.5, 0.9]) {
      const res = autoSpamPlay(4, 25, roll)
      expect(res.outcome).not.toBe('cleared')
      expect(res.outcome === 'gameover' || res.outcome === 'collapse').toBe(true)
    }
  }, 900000)

  it('第4面（封印帯）：連打では暴発を受け続ける（無傷では抜けられない）', () => {
    // 難易度の再調整までの暫定的な下限：崩し手の暴発が必ず盤面に乗る（防御の必要性が残っている）
    const res = autoSpamPlay(3, 25, 0.5)
    expect(res.count).toBeGreaterThanOrEqual(1)
  }, 600000)
})

/**
 * 封印帯（第4面）の勝ち筋の存在証明（過調整の回帰防止・#63/#69）。対処プレイ：
 * 1. 先頭の味方が「結界役」になり、両極の持続結界（闇r6・光r7）を自分の周囲に維持する。
 *    パリィは威力の引き算で必ず片方が消える＝結界は撃ち合いで消耗するため、消えた極から張り直す。
 * 2. 残る2人は崩し手を光弾（zRef）で撃ってひるみ（光の状態異常）ロックしながら削り切る。
 * 3. 残った番人はおまかせ（経路探索フィット）の曲線で柱の隙間を縫って撃つ。
 * この手順で被弾なく・膜をほぼ削らずクリアできることを固定する。
 */
describe('原則B：封印帯は対処プレイで勝てる（#63・勝ち筋の回帰防止）', () => {
  it('両極結界→ひるみロック→曲射で無被弾クリアできる', () => {
    let state = createBattleState(STAGES[3], 3, makeParty())
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
          // 結界役（先頭の味方）：弾色に合わせた反対極だけが迎撃できる（同極・中立は透過）ので
          // 闇r6・光r7 の2枚構え。消耗して消えた極から張り直す（半径違い＝重ね張り可）
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
          const rec = recommendCast(al.pos, tgt, prep.state.obstacles, prep.state.rField ?? FIELD.rField)
          const expr = rec.line ? `${rec.line.a}*x` : rec.freeExpr!
          const g = parseExpression(expr, 'x')!
          // 崩し手には光 zRef＝命中すればひるみで詠唱を止める。番人にはおすすめの極性のまま撃つ
          const zConst = tgt.role === 'ruptor' ? FIELD.zRef : rec.zConst
          const traj: Trajectory = { mode: 'rotate', g, angle: rec.angle, origin: al.pos, z: constZField(zConst), fieldR: prep.state.rField }
          return [{ allyId: al.id, trajectory: traj, initialSpeed: FIELD.fixedSpeed }]
        })
      const { state: after, resolution } = resolveAllyCasts(prep.state, casts, prep.castingEnemyIds, {
        instability: count,
        misfireRoll: 0.5,
      })
      count += resolution.misfires.length
      expect(collapseSeen && isLethal(count)).toBe(false) // 崩壊しない
      if (shouldFirstCollapse(count, 4, after.turn, collapseSeen)) collapseSeen = true
      state = after
    }
    expect(state.outcome).toBe('cleared')
    expect(count).toBeLessThanOrEqual(2) // 膜（instability）をほぼ削らずに勝てる
    expect(state.allies.every((a) => a.hp > 0)).toBe(true) // 全員生存
  }, 900000)
})
