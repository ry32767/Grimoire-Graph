// 敵のキャンバス上ヒットテスト（#67・docs/11-stage-editor.md §6.2「位置(x,y ドラッグ＆数値)」）。
// 障害物のヒットテスト（opEditing.ts）と対になる純粋関数。ドラッグ移動そのものは useEditorPointer が
// delta を計算して enemy.pos に足し込むだけなので、専用の moveBy は不要（obstacleのop基準座標と違い、
// 敵は pos 1点だけを持つため直接更新できる）。
import type { Enemy, Vec2 } from '../game/types'
import { dist } from '../game/coords'

/** 点 p にヒットする最も手前（配列末尾優先）の敵の id。ヒットボックスに一定の余裕を持たせ、拾いやすくする。 */
export function hitTestEnemy(enemies: Enemy[], p: Vec2): string | null {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]
    if (dist(p, e.pos) <= Math.max(e.hitboxRadius, 1.5) + 0.6) return e.id
  }
  return null
}
