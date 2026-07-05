// exportToTS / exportToJSON（純粋関数）のテスト（#67・docs/11-stage-editor.md §9）。
import { describe, expect, it } from 'vitest'
import type { Enemy } from '../game/types'
import { exportToJSON, exportToTS } from './exportStage'
import { fromStage, type EditorStage } from './model'

/** テスト用の最小 EditorStage（obstacleOps に各ヘルパーを1つずつ含む）。 */
function makeStage(overrides: Partial<EditorStage> = {}): EditorStage {
  const base: EditorStage = {
    rField: 30,
    mechanics: { obstacles: true, enemyFire: true },
    level: 3,
    enemies: [],
    obstacleOps: [],
    meta: { stageId: 'stage-test', name: 'テスト面', introText: ['導入'], clearText: ['クリア'] },
  }
  return { ...base, ...overrides }
}

function testEnemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    id: 'e1',
    name: '試作の敵',
    pos: { x: 1, y: 2 },
    hp: 130,
    maxHp: 130,
    element: 'light',
    hitboxRadius: 1.8,
    statuses: [],
    family: 'line',
    castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
    castInitialSpeed: 8,
    castZ: 3.5,
    level: 3,
    ...overrides,
  }
}

describe('exportToTS', () => {
  it('pillar/wall/ring/roomWalls/roomWallsOpenEnds/colonnade の呼び出しを生成する', () => {
    const stage = makeStage({
      obstacleOps: [
        { id: 'a', kind: 'pillar', params: { cx: 1, y0: 2, n: 4, element: 'dark' } },
        { id: 'b', kind: 'wall', params: { x0: -5, x1: 5, y0: 0, rows: 2, element: 'light', kind: 'fragile' } },
        { id: 'c', kind: 'ring', params: { cx: 0, cy: 0, radius: 6, element: 'neutral' } },
        { id: 'd', kind: 'roomWalls', params: { xL: -10, xR: 10, yB: -10, yT: 10 } },
        { id: 'e', kind: 'roomWallsOpenEnds', params: { xL: -8, xR: 8 } },
        { id: 'f', kind: 'colonnade', params: { x0: -6, x1: 6, step: 3, y0: 0, n: 2, elems: ['light', 'dark'] } },
      ],
    })
    const ts = exportToTS(stage)
    expect(ts).toContain('pillar(1, 2, 4, \'dark\'),')
    expect(ts).toContain('wall(-5, 5, 0, 2, \'light\', \'fragile\'),')
    expect(ts).toContain('ring(0, 0, 6, \'neutral\'),')
    expect(ts).toContain('...roomWalls(-10, 10, -10, 10, 30),')
    expect(ts).toContain('...roomWallsOpenEnds(-8, 8, 30),')
    expect(ts).toContain("...colonnade(-6, 6, 3, 0, 2, ['light', 'dark']),")
    expect(ts).toContain('const editedStage: Stage = {')
    expect(ts).toContain("id: 'stage-test',")
  })

  it('敵の非既定パラメータだけを opts に出力する（既定値は省略）', () => {
    const stage = makeStage({ enemies: [testEnemy({ hp: 999, role: 'breaker', species: 'oni' })] })
    const ts = exportToTS(stage)
    expect(ts).toContain("enemy('試作の敵', { x: 1, y: 2 }, 'light', 3, 'line', { hp: 999, role: 'breaker', species: 'oni' }),")
  })

  it('LVLどおりの既定HPなら opts は空になる', () => {
    // LVL3 の既定HP = round(100*1.3) = 130（stageBuilders.LVL_SCALE）
    const stage = makeStage({ enemies: [testEnemy({ hp: 130 })] })
    const ts = exportToTS(stage)
    expect(ts).toContain("enemy('試作の敵', { x: 1, y: 2 }, 'light', 3, 'line'),")
  })

  it('castZField を持つ敵には手動設定を促す TODO コメントを添える', () => {
    const stage = makeStage({ enemies: [testEnemy({ castZField: () => 1, castZ: -4 })] })
    const ts = exportToTS(stage)
    expect(ts).toContain('// TODO: z場（プリセット式）は自動復元できません')
    expect(ts).toContain('castZ=-4')
  })

  it('raw op（既存ステージ取り込み分）は素材を埋め込み TODO コメントを添える', () => {
    const stage = makeStage({
      obstacleOps: [
        { id: 'r', kind: 'raw', params: { obstacles: [{ id: 'o1', element: 'neutral', solids: [{ x: 0, y: 0, r: 2 }], carves: [] }] } },
      ],
    })
    const ts = exportToTS(stage)
    expect(ts).toContain('// TODO: 既存ステージ取り込み分')
    expect(ts).toContain('"id":"o1"')
  })

  it('bossPhases があれば出力に含む', () => {
    const stage = makeStage({ bossPhases: [{ hpBelow: 0.5, castCount: 2, obstacles: [], cullMinions: true }] })
    const ts = exportToTS(stage)
    expect(ts).toContain('bossPhases: [')
    expect(ts).toContain('hpBelow: 0.5')
    expect(ts).toContain('cullMinions: true')
  })
})

describe('exportToJSON', () => {
  it('本編 Stage 形にコンパイルされた JSON を返す（obstacleOps はコンパイル済み obstacles になる）', () => {
    const stage = makeStage({
      obstacleOps: [{ id: 'a', kind: 'pillar', params: { cx: 0, y0: 0, n: 3, element: 'neutral' } }],
      enemies: [testEnemy()],
    })
    const json = exportToJSON(stage)
    const parsed = JSON.parse(json) as { id: string; enemies: unknown[]; obstacles: unknown[] }
    expect(parsed.id).toBe('stage-test')
    expect(parsed.enemies).toHaveLength(1)
    expect(parsed.obstacles).toHaveLength(1)
  })

  it('既存ステージ(fromStage)から書き出しても壊れずJSONとして読める', () => {
    const stage = fromStage(0)
    const json = exportToJSON(stage)
    const parsed = JSON.parse(json) as { id: string }
    expect(parsed.id).toBe('stage-1')
  })

  it('既存ステージ(fromStage)からTS書き出しもエラーにならない', () => {
    const stage = fromStage(0)
    const ts = exportToTS(stage)
    expect(ts).toContain('const editedStage: Stage = {')
  })
})
