// 敵AIの「読み」（#75）：一つ前のターンに味方が撃った魔法を、**次のターンも同じ手で撃ってくる**
// と仮定して、自分の弾が相殺されない経路を選ぶための予測。敵の LVL には依存しない（全個体が使う）。
// 純粋関数：予測は必ず引数で渡す（モジュール状態を持たない）。履歴が無ければ空＝従来どおりの計画。
import type { Ally, AllyCast, Flight, FlightSample, Vec2 } from '../types'
import { simulateFlight, sampleAtLength } from '../physics'
import { classifyTrajectory } from '../loop'
import { attributeOf, strengthOf, zfieldAt } from '../attribute'
import { bulletCollision, resolveParry, type RadiusAt } from '../parry'
import { bulletRadius } from '../collision'

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
