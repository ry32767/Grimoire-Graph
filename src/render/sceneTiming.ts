// 演出の『いつ・描くか描かないか』を決める唯一の場所（#75）。
// 本編（BattleCanvas）とエンドロール（endroll）は必ずここを通す。時刻はエンジンが返す
// ゲーム秒（ターン開始=0）で、ここでは実時間へ写像しない。過去のバグ（時刻不明を 0 として
// 発射直後に一斉発火する／同じ対象への2発目が1発目の時刻に出る）は、この判断が2箇所に
// 分かれていたことが原因。
import type { DamagePopup } from '../game/types'

/** 時刻が有限でないイベントは描かない＝時刻を捏造しない（#75）。 */
export function timedOnly<T extends { t: number }>(events: readonly T[]): T[] {
  return events.filter((e) => Number.isFinite(e.t))
}

/** 結界を画面に出すか。bornBroken（回り出す前に自壊）＝一度も存在しないので描かない。 */
export function ringVisible(o: { bornBroken?: boolean }): boolean {
  return !o.bornBroken
}

/**
 * 結界の霧散を始めるゲーム秒。null なら霧散を描かない
 * （＝存続中、または「壊れたが時刻不明」。不明なときに 0 を返してはならない）。
 */
export function ringBreakTime(o: {
  broken?: boolean
  breakTime?: number | null
  bornBroken?: boolean
}): number | null {
  if (o.bornBroken) return null
  if (!o.broken) return null
  const bt = o.breakTime
  return bt !== null && bt !== undefined && Number.isFinite(bt) ? bt : null
}

/**
 * 撃破演出を始めるゲーム秒＝その対象への最後の被ダメージ時刻。
 * 該当が無ければ null（呼び出し側がフォールバックを決める）。
 */
export function deathTime(popups: readonly DamagePopup[], targetId: string): number | null {
  let last: number | null = null
  for (const p of popups) {
    if (p.targetId !== targetId || p.kind === 'heal' || !Number.isFinite(p.t)) continue
    if (last === null || p.t > last) last = p.t
  }
  return last
}

/** 撃破演出が始まった敵だけを盤面の生存スプライトから隠す。 */
export function activeDeathIds(starts: Readonly<Record<string, number>>, elapsedMs: number): Set<string> {
  return new Set(
    Object.entries(starts)
      .filter(([, start]) => Number.isFinite(start) && elapsedMs >= start)
      .map(([id]) => id),
  )
}

/** 飛行・数値ポップ・撃破演出のすべてが完了する実時間を返す。 */
export function animationEndTime(o: {
  flightMs: number
  baseTailMs: number
  popupStartMs: readonly number[]
  popupDurationMs: number
  popupPaddingMs: number
  deathEndMs: readonly number[]
}): number {
  const popupEnds = o.popupStartMs
    .filter(Number.isFinite)
    .map((start) => start + o.popupDurationMs + o.popupPaddingMs)
  return Math.max(o.flightMs + o.baseTailMs, ...popupEnds, ...o.deathEndMs.filter(Number.isFinite))
}

/** 全イベントの最終ゲーム秒（再生尺の決定に使う）。イベントが無ければ 0。 */
export function lastEventTime(...groups: readonly (readonly { t: number }[])[]): number {
  let last = 0
  for (const g of groups) {
    for (const e of g) {
      if (Number.isFinite(e.t) && e.t > last) last = e.t
    }
  }
  return last
}
