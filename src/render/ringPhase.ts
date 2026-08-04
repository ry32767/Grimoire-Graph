// 結界リング（周回）の「流れる粒」の位相を、**経過時刻の関数**として決める（#69）。
//
// なぜ要るか：`board.ts` の `drawOrbitRing` は粒の位置を store に持ち越し、呼ばれるたびに
// 固定 dt ぶん進める（＝フレーム数で進む）。そのため
//   - 見返しで時刻を巻き戻しても粒だけ流れ続け、同じ位置へ戻しても絵が一致しない
//   - 一時停止中も進み続ける／再生速度を変えても流れの速さが変わらない
// という「時計と絵がずれる」状態になる。描画の直前にここで位相を組み立てて store へ書き戻すと、
// **同じ時刻なら必ず同じ絵**になる（巻き戻し・スロー再生が正しく効く）。
//
// ※ 進め方は `board.ts` の `drawOrbitRing` と同じ式に揃えてある（片方だけ変えないこと）。
import type { RingPhaseStore } from './board'
import type { ZPoint } from '../game/types'

/** drawOrbitRing が 1 回の描画で進める時間（秒）。 */
const STEP_SEC = 0.033
/** 上を ms にしたもの（経過時刻→ステップ数の換算に使う）。 */
export const RING_STEP_MS = STEP_SEC * 1000

/** store のキー（drawOrbitRing と同じ作り方）。 */
export function ringPhaseKey(ring: ZPoint[], role: 'ally' | 'enemy'): string {
  return `${role}:${ring.length}:${Math.round(ring[0].pos.x * 10)},${Math.round(ring[0].pos.y * 10)}`
}

/** 粒の数（drawOrbitRing と同じ決め方）。 */
function particleCount(n: number): number {
  return Math.min(16, Math.max(6, Math.round(n / 9)))
}

/**
 * 経過時刻 elapsedMs 時点の粒の位相を組み立てて store に入れる。
 * 粒は**その場の速度**で進むので、遅い区間で詰まり速い区間で伸びる（見た目の要）。
 * 初期配置から steps 回まわすだけの単純な積分（steps は最大でも 100 程度・毎フレームでも軽い）。
 */
export function seedRingPhases(
  store: RingPhaseStore,
  ring: ZPoint[],
  role: 'ally' | 'enemy',
  elapsedMs: number,
): void {
  const n = ring.length
  if (n < 3) return
  let seg = 0
  for (let i = 0; i < n; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % n]
    seg += Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y)
  }
  const segLen = Math.max(1e-4, seg / n)
  const cnt = particleCount(n)
  const ps: number[] = []
  for (let k = 0; k < cnt; k++) ps.push((k * n) / cnt)
  const steps = Math.max(0, Math.round(elapsedMs / RING_STEP_MS))
  for (let s = 0; s < steps; s++) {
    for (let k = 0; k < cnt; k++) {
      const sp = ring[Math.floor(ps[k]) % n].speed ?? 0
      ps[k] = (ps[k] + (sp * STEP_SEC) / segLen) % n
    }
  }
  store[ringPhaseKey(ring, role)] = ps
}
