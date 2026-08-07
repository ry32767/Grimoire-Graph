// 敵AIの「読み」（#75）：一つ前のターンに味方が撃った魔法を、**次のターンも同じ手で撃ってくる**
// と仮定して、自分の弾が相殺されない経路を選ぶための予測。敵の LVL には依存しない（全個体が使う）。
// 純粋関数：予測は必ず引数で渡す（モジュール状態を持たない）。履歴が無ければ空＝従来どおりの計画。
import type { Ally, AllyCast, Flight, FlightSample, Obstacle, Vec2 } from '../types'
import { simulateFlight, sampleAtLength } from '../physics'
import { classifyTrajectory } from '../loop'
import { attributeOf, strengthOf, zfieldAt } from '../attribute'
import { bulletCollision, resolveParry, type RadiusAt } from '../parry'
import { bulletRadius } from '../collision'
import { ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'

/** 敵が「次も飛んでくる」と読んだ味方弾（サンプル列＋位置ごとの z）。 */
export interface PredictedShot {
  samples: FlightSample[]
  zAt: (pos: Vec2) => number
}

/**
 * 一つ前のターンの味方の発射から、今ターンの飛来を予測する（#75）。
 * - 倒れた味方の手は予測しない（撃ってこない）
 * - 周回結界（orbit）は除外する：張られた結界は activeOrbits＝standingRings として
 *   既に敵の計画へ入っているため、ここで再詠唱を足すと同じ結界を二重に数えてしまう
 * - 予測は自由飛行で建てる。実際には削り・結界で減速しうるが、敵はそこまでは読まない
 *   （読み＝相手の「手」の再現であって、盤面の完全な先読みではない）
 */
export function predictAllyShots(
  lastCasts: readonly AllyCast[] | undefined,
  allies: readonly Ally[],
): PredictedShot[] {
  if (!lastCasts || lastCasts.length === 0) return []
  const out: PredictedShot[] = []
  for (const cast of lastCasts) {
    const ally = allies.find((a) => a.id === cast.allyId)
    if (!ally || ally.hp <= 0) continue
    if (classifyTrajectory(cast.trajectory) === 'orbit') continue
    const flight = simulateFlight(cast.trajectory, cast.initialSpeed)
    if (flight.samples.length < 2) continue
    out.push({ samples: flight.samples, zAt: (pos) => zfieldAt(cast.trajectory, pos) })
  }
  return out
}

/**
 * 予測弾が走る**回廊**を、経路探索だけが見る仮想の障害物にする（#76）。
 * 前ターンと同じ弾が来ると読んだうえで「その道は通らない」経路候補を作るための当てで、
 * 本番の障害物リストには決して混ぜない（削れない・当たり判定にも使わない）。
 * 幾何だけの近似（すれ違う時刻は見ない）なので、採否は必ず本番物理の採点
 * （foreseeInterception＝同一ゲーム時刻の bulletCollision＋resolveParry）が決める。
 */
export function threatCorridorObstacle(
  predicted: readonly PredictedShot[],
  clearAround: readonly Vec2[] = [],
): Obstacle | null {
  if (predicted.length === 0) return null
  const skip = RP.threatCorridorMuzzleSkip
  const solids: { x: number; y: number; r: number }[] = []
  for (const p of predicted) {
    let lastArc = -Infinity
    for (const s of p.samples) {
      if (s.speed <= 0) break
      if (s.arcLen < skip) continue // 相手の銃口のすぐ前は塞がない（上記の理由）
      if (s.arcLen - lastArc < RP.threatCorridorStep) continue
      // 自分の銃口のすぐ前も同様に塞がない（自分の弾は t≈0 にそこを出る＝すれ違わない）。
      // ここを塞ぐと経路探索の始点が回廊の内側になり、経路そのものが見つからなくなる
      if (clearAround.some((c) => Math.hypot(s.pos.x - c.x, s.pos.y - c.y) < skip)) continue
      lastArc = s.arcLen
      solids.push({ x: s.pos.x, y: s.pos.y, r: bulletRadius(s.speed, p.zAt(s.pos)) + RP.threatCorridorPad })
      if (solids.length >= RP.threatCorridorMaxDiscs) break
    }
    if (solids.length >= RP.threatCorridorMaxDiscs) break
  }
  if (solids.length === 0) return null
  return { id: '__threat-corridor', element: 'neutral', solids, carves: [], kind: 'normal' }
}

/** 読みの結果：敵弾が相殺される点と、そこで引き継げる速度の比（0=撃ち落とされる）。 */
export interface Interception {
  /** 相殺が起きる敵弾側の弧長 */
  arcLen: number
  /** 相殺後に敵弾へ残る速度の比（0=消滅／1=無傷）。威力＝速度×強度なので期待ダメージ倍率でもある */
  speedRatio: number
}

/**
 * 予測した味方弾に敵弾が撃ち落とされるかを、**本番と同じ実装**で読む（#75）。
 * 接触は幾何交差ではなく `bulletCollision`（同じゲーム時刻に互いの半径まで近づく点・AGENTS.md
 * の設計原則）で取り、相殺は `resolveParry`（反対極のみ・同極/中立は透過）で解く。
 * 複数の予測弾に当たる場合は最も手前の1回だけを見る（連続被弾までは読まない）。
 */
export function foreseeInterception(
  enemySamples: readonly FlightSample[],
  enemyZAt: (pos: Vec2) => number,
  predicted: readonly PredictedShot[],
): Interception | null {
  if (predicted.length === 0 || enemySamples.length < 2) return null
  const es = enemySamples as FlightSample[]
  const enemyRadius: RadiusAt = (pos, speed) => bulletRadius(speed, enemyZAt(pos))
  let best: Interception | null = null
  for (const p of predicted) {
    const allyRadius: RadiusAt = (pos, speed) => bulletRadius(speed, p.zAt(pos))
    const col = bulletCollision(es, p.samples, enemyRadius, allyRadius)
    if (!col) continue
    if (best && col.arcA >= best.arcLen) continue
    const se = sampleAtLength({ samples: es } as Flight, col.arcA) ?? es[es.length - 1]
    const sp = sampleAtLength({ samples: p.samples } as Flight, col.arcB) ?? p.samples[p.samples.length - 1]
    if (!se || !sp || se.speed <= 0 || sp.speed <= 0) continue
    const ze = enemyZAt(se.pos)
    const zp = p.zAt(sp.pos)
    const parry = resolveParry(
      attributeOf(ze), se.speed, se.speed * strengthOf(ze),
      attributeOf(zp), sp.speed, sp.speed * strengthOf(zp),
    )
    if (parry.passthrough) continue // 同極・中立はすり抜け＝読む必要がない
    best = { arcLen: col.arcA, speedRatio: Math.max(0, parry.speedA / se.speed) }
  }
  return best
}
