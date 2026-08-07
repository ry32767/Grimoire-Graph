// 守護型が「前ターンと同じ味方の魔法が飛んでくる」と読んで結界を組むための読み（#76）。純粋関数。
// 攻撃側の読み（foresight.ts）と同じ PredictedShot を材料にするが、守護型は経路でなく
//   ① どの方角から来るか（φ_threat＝防御の指向性）
//   ② どの属性で来るか（結界は**反対極**でしか迎撃できない・同極は透過する）
//   ③ その結界で本当に止まるか（本番と同じ ringContact＋resolveParry で採点する）
// を見る。
import type { Attribute, Vec2 } from '../types'
import { attributeOf, strengthOf } from '../attribute'
import { ringContact, scaleRingSpeeds, type RingPoint } from '../orbit'
import { resolveParry, type RadiusAt } from '../parry'
import { bulletRadius } from '../collision'
import type { PredictedShot } from './foresight'

/** 読んだ飛来弾の総体（方角・属性・威力）。 */
export interface IncomingThreat {
  /** 結界を横切ってくる方角[rad]（威力で重みづけした合成方向） */
  phi: number
  /** 最も威力の大きい極性（結界はこの**反対極**でなければ迎撃できない） */
  attr: Attribute
  /** 合計威力（速度×強度） */
  power: number
}

/**
 * 予測弾のうち、半径 reach の結界に届くものだけを集めて脅威の方角・属性を出す。
 * 方角は「結界へ入ってくる点」（reach 以内へ入った最初のサンプル）の方位を威力で重みづけした合成。
 * どの弾も届かなければ null＝読みからは方向が決まらない（従来どおり味方の方角を使う）。
 */
export function incomingThreat(
  predicted: readonly PredictedShot[],
  origin: Vec2,
  reach: number,
): IncomingThreat | null {
  let vx = 0
  let vy = 0
  let power = 0
  const byAttr: Record<string, number> = { light: 0, dark: 0 }
  for (const p of predicted) {
    let entry: { pos: Vec2; speed: number } | null = null
    for (const s of p.samples) {
      if (s.speed <= 0) break
      if (Math.hypot(s.pos.x - origin.x, s.pos.y - origin.y) <= reach) {
        entry = { pos: s.pos, speed: s.speed }
        break
      }
    }
    if (!entry) continue
    const z = p.zAt(entry.pos)
    const w = entry.speed * strengthOf(z)
    if (w <= 0) continue
    const phi = Math.atan2(entry.pos.y - origin.y, entry.pos.x - origin.x)
    vx += Math.cos(phi) * w
    vy += Math.sin(phi) * w
    power += w
    const a = attributeOf(z)
    if (a !== 'neutral') byAttr[a] += w
  }
  if (power <= 0 || (vx === 0 && vy === 0)) return null
  const attr: Attribute =
    byAttr.light === byAttr.dark ? 'neutral' : byAttr.light > byAttr.dark ? 'light' : 'dark'
  return { phi: Math.atan2(vy, vx), attr, power }
}

/**
 * 飛来弾の属性に対して結界が取るべき極性（#76）。
 * 相殺は**反対極のみ**（同極・中立は透過＝04-magic §4.6）なので、光で来るなら闇の結界を張る。
 * 属性が拮抗（neutral）なら決められない＝null（呼び出し側の既定に従う）。
 */
export function counterSign(attr: Attribute): 1 | -1 | null {
  if (attr === 'light') return -1
  if (attr === 'dark') return 1
  return null
}

/** 結界が予測弾をどれだけ止められるか（本番と同じ判定で採点した結果）。 */
export interface BlockScore {
  /** 完全に消滅させられる予測弾の本数 */
  stopped: number
  /** 削り取れる威力の合計（消滅まで至らなくても弱められるぶん） */
  power: number
}

/**
 * 結界（点ごとの速度つきリング）が予測弾を止められるかを、**本番と同じ実装**で採点する。
 * 接触は ringContact（同一ゲーム時刻・弾の半径＋帯の半厚み）、相殺は resolveParry。
 * 同極・中立はすり抜けるので 0 点＝「属性を合わせないと守れない」が採点に自然に出る。
 */
export function predictedBlock(ring: RingPoint[], predicted: readonly PredictedShot[]): BlockScore {
  const out: BlockScore = { stopped: 0, power: 0 }
  if (ring.length < 3) return out
  const remaining = predicted.map((p, index) => ({ p, index }))
  let currentRing = ring
  for (;;) {
    // 本番と同様、結界の状態が変わるたびに未処理ペアの接触を再計算する。
    let best: {
      remainingIndex: number
      index: number
      p: PredictedShot
      c: NonNullable<ReturnType<typeof ringContact>>
    } | null = null
    for (let remainingIndex = 0; remainingIndex < remaining.length; remainingIndex++) {
      const { p, index } = remaining[remainingIndex]
      const radiusAt: RadiusAt = (pos, speed) => bulletRadius(speed, p.zAt(pos))
      const c = ringContact(currentRing, p.samples, radiusAt)
      if (!c) continue
      if (!best || c.time < best.c.time || (c.time === best.c.time && index < best.index)) {
        best = { remainingIndex, index, p, c }
      }
    }
    if (!best) break
    remaining.splice(best.remainingIndex, 1)
    const { p, c } = best
    if (c.speed <= 0 || c.ringSpeed <= 0) continue
    const zb = p.zAt(c.pos)
    const parry = resolveParry(
      attributeOf(c.ringZ),
      c.ringSpeed,
      c.ringSpeed * strengthOf(c.ringZ),
      attributeOf(zb),
      c.speed,
      c.speed * strengthOf(zb),
    )
    if (parry.passthrough) continue
    if (parry.speedB <= 0) out.stopped++
    out.power += (c.speed - parry.speedB) * strengthOf(zb)
    if (parry.vanishA) break
    currentRing = scaleRingSpeeds(currentRing, parry.speedA / c.ringSpeed)
  }
  return out
}
