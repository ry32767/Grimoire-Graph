// 味方位置編集のヒットテスト（#67・docs/11-stage-editor.md §6.4）。敵・障害物と対になる純粋関数。
import type { Vec2 } from '../game/types'
import { dist } from '../game/coords'
import { GAME } from '../data/constants'

/** 点 p が味方の当たり判定内にあるか。ヒットボックスは全味方共通（GAME.allyHitbox・#15）。 */
export function hitTestAlly(positions: Vec2[], p: Vec2): number | null {
  for (let i = positions.length - 1; i >= 0; i--) {
    if (dist(p, positions[i]) <= GAME.allyHitbox + 0.6) return i
  }
  return null
}
