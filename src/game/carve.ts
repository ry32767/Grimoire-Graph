// 障害物を「えぐり取りながら」進む解決の中核（#1/#16・Graph War 風）。純粋関数。
// turn.ts（本番解決）と enemyPlanning/（敵AIの事前評価）が**同じ実装**を共有する。
// AI 側が判定だけ簡略化すると本番とズレて「壁に埋まる」バグの温床になるため、ここに一元化する。
import type { CarveBurst, Flight, FlightSample, Obstacle, Vec2 } from './types'
import type { LossEvent } from './physics'
import { sampleAtLength } from './physics'
import { attributeOf, strengthOf } from './attribute'
import { isSolidAt, carveSpeedLoss, carveRadius } from './obstacle'
import { COMBAT, OBSTACLE_STEP } from '../data/constants'

export { OBSTACLE_STEP }

/** 障害物判定用に飛行サンプルを密にする（長いセグメントを maxStep 以下へ補間分割）。壁すり抜け防止。 */
export function densifyGeom(geom: FlightSample[], maxStep: number): FlightSample[] {
  if (geom.length < 2) return geom
  const out: FlightSample[] = [geom[0]]
  for (let i = 1; i < geom.length; i++) {
    const a = geom[i - 1]
    const b = geom[i]
    const d = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)
    const n = Math.floor(d / maxStep)
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1)
      out.push({
        pos: { x: a.pos.x + (b.pos.x - a.pos.x) * t, y: a.pos.y + (b.pos.y - a.pos.y) * t },
        speed: a.speed + (b.speed - a.speed) * t,
        arcLen: a.arcLen + (b.arcLen - a.arcLen) * t,
        param: a.param + (b.param - a.param) * t,
      })
    }
    out.push(b)
  }
  return out
}

/**
 * 弾が障害物を「えぐり取りながら」進む解決の中核（#1/#16）。
 * パスが素材（solids にあり carves に無い点）に触れた点を衝突とみなし、その点を中心に
 * 威力分の半径の円を carves に足して滑らかにえぐる。えぐった穴の先は素通りなので、次に
 * 素材へ再突入した点で再びえぐる。えぐるたびに弾は減速し、速度が 0 になればその場で消滅し
 * 貫通しない。威力が高いほど一撃で広くえぐれる＝少ない回数で抜けられる＝貫通しやすい。
 * losses は呼び出し側と共有し、resim は「元の初速＋全減衰」で飛行を作り直す。
 * obstacles の carves は in place で更新（呼び出し側が複製済み）。
 */
export function carveAlong(
  geom: FlightSample[],
  obstacles: Obstacle[],
  zAt: (pos: Vec2) => number,
  losses: LossEvent[],
  resim: (losses: LossEvent[]) => Flight,
  current: Flight,
): { flight: Flight; bursts: CarveBurst[]; vanished: boolean } {
  let flight = current
  const bursts: CarveBurst[] = []
  if (geom.length <= 1) return { flight, bursts, vanished: false }
  let vanished = false
  // 頂点間が開いた急な軌道でも壁を取りこぼさないよう、判定用パスを密にする（すり抜け防止）
  const dense = densifyGeom(geom, OBSTACLE_STEP)
  // パスを原点側から辿り、素材へ触れた点でえぐる。えぐった穴の中は素通り。
  for (let s = 0; s < dense.length; s++) {
    let hit: Obstacle | null = null
    for (const ob of obstacles) {
      if (isSolidAt(ob, dense[s].pos)) {
        hit = ob
        break
      }
    }
    if (!hit) continue // 素材に触れていない（空間 or 穴の中）
    const cur = sampleAtLength(flight, dense[s].arcLen)
    if (!cur || cur.speed <= 0) {
      vanished = true
      break
    }
    const z = zAt(dense[s].pos)
    const attr = attributeOf(z)
    const kind = hit.kind ?? 'normal'
    // 壊れない壁（#40）：素材は削れない。当たった魔法はここで全速度を失って止まる
    if (kind === 'unbreakable') {
      bursts.push({ pos: dense[s].pos, r: COMBAT.orbitWallCarveRadius, arcLen: dense[s].arcLen, attr, obstacleId: hit.id })
      losses.push({ arcLen: dense[s].arcLen, deltaV: cur.speed })
      flight = resim(losses)
      vanished = true
      break
    }
    const power = cur.speed * (strengthOf(z) + 1) // 中立弾でも運動量で少しえぐれる
    const r = carveRadius(power, kind)
    // 当たった点を中心に円を引き算して滑らかにえぐる
    hit.carves.push({ x: dense[s].pos.x, y: dense[s].pos.y, r })
    bursts.push({ pos: dense[s].pos, r, arcLen: dense[s].arcLen, attr, obstacleId: hit.id })
    losses.push({ arcLen: dense[s].arcLen, deltaV: carveSpeedLoss(attr, hit.element, kind) })
    flight = resim(losses)
    if (flight.end === 'vanished') {
      vanished = true
      break
    }
  }
  return { flight, bursts, vanished }
}
