// 解決演出の「いつ始まるか」を、経過時刻から引ける純粋関数にする（#70）。
//
// なぜ要るか：被弾フラッシュ・壁を削った破片・パリィの火花などは、もともと
// 「弾がその弧長を越えたフレームで現在時刻をラッチする」方式だった。順再生なら正しいが、
// 見返し（プレイバック）で時刻を飛ばすと
//   - 飛ばした先で一斉に発火してしまう（＝当時は preExpire で握りつぶしていた）
//   - 握りつぶした結果、**その時刻に進行中だったはずのエフェクトが何も出ない**
// という二択になっていた。イベントの発生時刻そのものを先に求めておけば、
// どの再生位置でも「経過時刻 − 発生時刻」で正しい進行度が出る（巻き戻しても同じ絵）。
import type { Vec2 } from '../game/types'

/** 時刻を引くのに必要な最小限のサンプル（弾の飛行サンプル）。 */
export interface ArcSample {
  pos: Vec2
  arcLen: number
}

/**
 * 弧長 arcLen に到達する**ゲーム時刻**（tCum と同じ単位）。
 * tCum は各サンプルまでの到達時間（Σ ds/v）。サンプル間は線形に補間する。
 */
export function gameTimeAtArcLen(samples: ArcSample[], tCum: number[], arcLen: number): number {
  const n = Math.min(samples.length, tCum.length)
  if (n === 0) return 0
  if (arcLen <= samples[0].arcLen) return tCum[0]
  for (let i = 1; i < n; i++) {
    if (samples[i].arcLen >= arcLen) {
      const span = samples[i].arcLen - samples[i - 1].arcLen
      const f = span > 0 ? (arcLen - samples[i - 1].arcLen) / span : 0
      return tCum[i - 1] + (tCum[i] - tCum[i - 1]) * f
    }
  }
  return tCum[n - 1]
}

/**
 * 点 pos に dist 以内まで近づく最初の**ゲーム時刻**。届かなければ null。
 * エンジンが時刻を返さない演出（旧データのパリィ・結界の霧散）を、
 * 幾何から決める最後の手段として使う。
 */
export function firstApproachTime(
  samples: ArcSample[],
  tCum: number[],
  pos: Vec2,
  dist: number,
): number | null {
  const n = Math.min(samples.length, tCum.length)
  for (let i = 0; i < n; i++) {
    const s = samples[i]
    if (Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y) <= dist) return tCum[i]
  }
  return null
}
