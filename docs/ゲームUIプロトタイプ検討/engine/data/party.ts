// 自陣営パーティ（#15：3人）。配置＝発射元（#14）。HP は各ステージ開始時に全快。
import type { Ally } from '../game/types'

/** 開始パーティ（3人）。属性は被弾相性に使う防御属性。 */
export const PARTY: Ally[] = [
  {
    id: 'a-mira',
    name: '灯火のミラ',
    pos: { x: -14, y: -20 },
    hp: 135,
    maxHp: 135,
    element: 'light',
    statuses: [],
  },
  {
    id: 'a-ren',
    name: '宵闇のレン',
    pos: { x: 0, y: -23 },
    hp: 135,
    maxHp: 135,
    element: 'dark',
    statuses: [],
  },
  {
    id: 'a-sou',
    name: '均衡のソウ',
    pos: { x: 14, y: -20 },
    hp: 150,
    maxHp: 150,
    element: 'neutral',
    statuses: [],
  },
]

/** パーティの複製（state 初期化用）。 */
export function makeParty(): Ally[] {
  return PARTY.map((a) => ({ ...a, statuses: [] }))
}
