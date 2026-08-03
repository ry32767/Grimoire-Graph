// 「試しの間」（DC プロトタイプ v3 の _testStage）。4 種類の壁と、直線で撃ち返してくる敵 2 体だけの
// 練習部屋。壁の削れ方とパリィ（相殺）を安全に試すための UI 側の使い捨てステージで、
// 本編のステージ定義（src/data/stages.ts）には手を触れない。
import type { Enemy, Obstacle, ObstacleKind, Stage } from '../game/types'
import { STAGES } from '../data/stages'

const wall = (id: string, x: number, y: number, r: number, kind: ObstacleKind, element: 'light' | 'dark' | 'neutral' = 'neutral'): Obstacle => ({
  id,
  element,
  kind,
  solids: [{ x, y, r }],
  carves: [],
})

/** 練習用の直射敵。得意関数は直進のみ・毎ターン撃つ。 */
function straightFoe(base: Enemy, id: string, name: string, x: number, y: number, castZ: number): Enemy {
  return {
    ...base,
    id,
    name,
    pos: { x, y },
    hp: 240,
    maxHp: 240,
    statuses: [],
    family: 'line',
    families: ['line'],
    role: 'attacker',
    castZ,
    castZField: undefined,
    castCount: 1,
    patternPool: undefined,
    fireEvery: 1,
    fireOffset: 0,
    boss: false,
    ruptorTarget: undefined,
  }
}

/** 試しの間の Stage を組み立てる。 */
export function buildTestStage(): Stage {
  const base = STAGES[0]
  const proto = base.enemies[0]
  return {
    id: 'test-room',
    name: '試しの間 ― 壁とパリィ',
    rField: base.rField,
    allyPositions: base.allyPositions,
    enemies: [
      straightFoe(proto, 'tst1', '直射の番人', -7, 16, 2.2),
      straightFoe(proto, 'tst2', '直射の番人・弐', 8, 17, -2.2),
    ],
    obstacles: [
      wall('tw1', -8, 4, 2.6, 'normal', 'dark'),
      wall('tw2', 8, 5, 2.2, 'tough'),
      wall('tw3', 0, 9, 1.8, 'fragile'),
      wall('tw4', -1, -3, 1.4, 'unbreakable'),
    ],
    introText: [
      '練習用の間。壁は左から もろい／頑丈／不壊 の順に並び、番人は毎ターンまっすぐ撃ち返してくる。',
      '削り方と相殺（パリィ）を、負けを気にせず試せる。',
    ],
    clearText: ['試しは終わり。本編の間へ戻ろう。'],
    mechanics: { obstacles: true, enemyFire: true },
  }
}
