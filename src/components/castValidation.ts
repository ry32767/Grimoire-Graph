import type { Ally } from '../game/types'
import type { ComposerState } from './composer'

/** 行動可能な術者の入力エラーを探す。編集中の直前の有効式では発射しない。 */
export function firstInvalidCaster(
  allies: Pick<Ally, 'id' | 'hp'>[],
  impairedIds: string[],
  composers: Record<string, Pick<ComposerState, 'freeError' | 'zFreeError'> | undefined>,
): string | null {
  return allies.find((ally) => {
    if (ally.hp <= 0 || impairedIds.includes(ally.id)) return false
    const composer = composers[ally.id]
    return !!(composer?.freeError || composer?.zFreeError)
  })?.id ?? null
}
