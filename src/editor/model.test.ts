// ステージエディタの障害物編集ロジック（純粋関数）のテスト（#67・docs/11-stage-editor.md §4）。
import { describe, expect, it } from 'vitest'
import {
  block,
  colonnade,
  pillar,
  resetOseq,
  ring,
  roomWalls,
  roomWallsOpenEnds,
  spiralArm,
  wall,
} from '../data/stageBuilders'
import { compileObstacles, compileObstaclesWithOps, type ObstacleOp } from './model'
import { createDefaultOp, hitTestOp, moveOpBy } from './opEditing'
import { detectOverlaps } from './overlap'

describe('compileObstaclesWithOps', () => {
  it('op ごとに Obstacle[] を対応づける', () => {
    const pillar = createDefaultOp('pillar')
    const ring = createDefaultOp('ring')
    const compiled = compileObstaclesWithOps([pillar, ring], 30)
    expect(compiled).toHaveLength(2)
    expect(compiled[0].opId).toBe(pillar.id)
    expect(compiled[0].obstacles.length).toBeGreaterThan(0)
    expect(compiled[1].opId).toBe(ring.id)
  })

  it('disc は任意半径の円1個、rect は自由サイズの矩形1枚を生成（#68）', () => {
    const d: ObstacleOp = { id: 'd', kind: 'disc', params: { cx: 3, cy: -2, r: 6.5, element: 'neutral' } }
    const [disc] = compileObstacles([d], 30)
    expect(disc.solids).toEqual([{ x: 3, y: -2, r: 6.5 }])
    expect(disc.rects ?? []).toHaveLength(0)
    const rc: ObstacleOp = { id: 'rc', kind: 'rect', params: { x: -4, y: -3, w: 8, h: 5, element: 'light', kind: 'tough' } }
    const [rect] = compileObstacles([rc], 30)
    expect(rect.rects).toEqual([{ x: -4, y: -3, w: 8, h: 5 }])
    expect(rect.kind).toBe('tough')
    // ドラッグ移動：disc は cx/cy、rect は x/y がずれる
    const d2 = moveOpBy(d, { x: 1, y: 2 })
    expect(d2.kind === 'disc' && d2.params.cx).toBe(4)
    expect(d2.kind === 'disc' && d2.params.cy).toBe(0)
    const rc2 = moveOpBy(rc, { x: -1, y: 3 })
    expect(rc2.kind === 'rect' && rc2.params.x).toBe(-5)
    expect(rc2.kind === 'rect' && rc2.params.y).toBe(0)
  })

  it('compileObstacles は op ごとの内訳を合算した件数になる（roomWalls=4枚）', () => {
    const room: ObstacleOp = { id: 'r', kind: 'roomWalls', params: { xL: -5, xR: 5, yB: -5, yT: 5 } }
    const flat = compileObstacles([room], 30)
    expect(flat).toHaveLength(4)
  })
})

describe('compileObstacles は stageBuilders の直接呼び出しと一致する', () => {
  it('pillar', () => {
    const op: ObstacleOp = { id: 'a', kind: 'pillar', params: { cx: 2, y0: 3, n: 4, element: 'dark', kind: 'fragile' } }
    resetOseq(0)
    const compiled = compileObstacles([op], 30)
    resetOseq(0)
    expect(compiled).toEqual([pillar(2, 3, 4, 'dark', 'fragile')])
  })

  it('block', () => {
    const op: ObstacleOp = { id: 'a', kind: 'block', params: { x0: -3, y0: -3, cols: 3, rows: 3, element: 'light' } }
    resetOseq(0)
    const compiled = compileObstacles([op], 30)
    resetOseq(0)
    expect(compiled).toEqual([block(-3, -3, 3, 3, 'light')])
  })

  it('wall', () => {
    const op: ObstacleOp = {
      id: 'a',
      kind: 'wall',
      params: { x0: -6, x1: 6, y0: 0, rows: 2, element: 'neutral', kind: 'unbreakable' },
    }
    resetOseq(0)
    const compiled = compileObstacles([op], 30)
    resetOseq(0)
    expect(compiled).toEqual([wall(-6, 6, 0, 2, 'neutral', 'unbreakable')])
  })

  it('colonnade（配列を返す op は展開されて一致する）', () => {
    const op: ObstacleOp = {
      id: 'a',
      kind: 'colonnade',
      params: { x0: -10, x1: 10, step: 5, y0: 0, n: 3, elems: ['light', 'dark'] },
    }
    resetOseq(0)
    const compiled = compileObstacles([op], 30)
    resetOseq(0)
    expect(compiled).toEqual(colonnade(-10, 10, 5, 0, 3, ['light', 'dark']))
  })

  it('spiralArm（r0 の明示指定を含む）', () => {
    const op: ObstacleOp = {
      id: 'a',
      kind: 'spiralArm',
      params: { cx: 1, cy: 2, n: 10, turns: 1.5, phase: 0.3, element: 'dark', r0: 3 },
    }
    resetOseq(0)
    const compiled = compileObstacles([op], 30)
    resetOseq(0)
    expect(compiled).toEqual([spiralArm(1, 2, 10, 1.5, 0.3, 'dark', 3)])
  })

  it('ring（kind と n を両方指定）', () => {
    const op: ObstacleOp = {
      id: 'a',
      kind: 'ring',
      params: { cx: 0, cy: 0, radius: 8, element: 'neutral', kind: 'fragile', n: 10 },
    }
    resetOseq(0)
    const compiled = compileObstacles([op], 30)
    resetOseq(0)
    expect(compiled).toEqual([ring(0, 0, 8, 'neutral', 'fragile', 10)])
  })

  it('roomWalls（rField・element・kind を渡す＝4枚の壁がすべて一致）', () => {
    const op: ObstacleOp = {
      id: 'a',
      kind: 'roomWalls',
      params: { xL: -10, xR: 10, yB: -8, yT: 8, element: 'dark', kind: 'fragile' },
    }
    resetOseq(0)
    const compiled = compileObstacles([op], 30)
    resetOseq(0)
    expect(compiled).toEqual(roomWalls(-10, 10, -8, 8, 30, 'dark', 'fragile'))
  })

  it('roomWallsOpenEnds（rField を渡す＝左右2枚が一致）', () => {
    const op: ObstacleOp = { id: 'a', kind: 'roomWallsOpenEnds', params: { xL: -8, xR: 8 } }
    resetOseq(0)
    const compiled = compileObstacles([op], 25)
    resetOseq(0)
    expect(compiled).toEqual(roomWallsOpenEnds(-8, 8, 25))
  })
})

describe('hitTestOp', () => {
  it('op の素材内の点をヒットさせる', () => {
    const block = createDefaultOp('block') // x0=-3,y0=-3,cols=3,rows=3 → 中心付近を覆う矩形
    const compiled = compileObstaclesWithOps([block], 30)
    expect(hitTestOp(compiled, { x: 0, y: 0 })).toBe(block.id)
  })

  it('どの素材にも当たらない点は null', () => {
    const block = createDefaultOp('block')
    const compiled = compileObstaclesWithOps([block], 30)
    expect(hitTestOp(compiled, { x: 100, y: 100 })).toBeNull()
  })

  it('複数 op が重なる場合は最後に追加された op を優先する', () => {
    const a = createDefaultOp('pillar') // cx=0,y0=0
    const b = createDefaultOp('pillar') // 同じ既定位置＝重なる
    const compiled = compileObstaclesWithOps([a, b], 30)
    expect(hitTestOp(compiled, { x: 0, y: 0 })).toBe(b.id)
  })
})

describe('moveOpBy', () => {
  it('pillar は cx/y0 を移動量ぶんずらす', () => {
    const op = createDefaultOp('pillar')
    const moved = moveOpBy(op, { x: 5, y: -2 })
    expect(moved.kind).toBe('pillar')
    if (moved.kind === 'pillar') {
      expect(moved.params.cx).toBeCloseTo(5)
      expect(moved.params.y0).toBeCloseTo(-2)
    }
  })

  it('roomWalls は xL/xR/yB/yT をまとめてずらす', () => {
    const op: ObstacleOp = { id: 'x', kind: 'roomWalls', params: { xL: -10, xR: 10, yB: -10, yT: 10 } }
    const moved = moveOpBy(op, { x: 3, y: 4 })
    if (moved.kind === 'roomWalls') {
      expect(moved.params).toEqual({ xL: -7, xR: 13, yB: -6, yT: 14 })
    }
  })

  it('raw は素材の全点を直接ずらす', () => {
    const op: ObstacleOp = {
      id: 'x',
      kind: 'raw',
      params: { obstacles: [{ id: 'o1', element: 'neutral', solids: [{ x: 1, y: 1, r: 2 }], carves: [] }] },
    }
    const moved = moveOpBy(op, { x: 1, y: 1 })
    if (moved.kind === 'raw') {
      expect(moved.params.obstacles[0].solids[0]).toEqual({ x: 2, y: 2, r: 2 })
    }
  })
})

describe('detectOverlaps', () => {
  it('別々の障害物の円が重なれば検出する', () => {
    const obstacles = compileObstacles(
      [
        { id: 'a', kind: 'pillar', params: { cx: 0, y0: 0, n: 1, element: 'neutral' } },
        { id: 'b', kind: 'pillar', params: { cx: 1, y0: 0, n: 1, element: 'neutral' } },
      ],
      30,
    )
    expect(detectOverlaps(obstacles).length).toBeGreaterThan(0)
  })

  it('離れた障害物は重ならない', () => {
    const obstacles = compileObstacles(
      [
        { id: 'a', kind: 'pillar', params: { cx: 0, y0: 0, n: 1, element: 'neutral' } },
        { id: 'b', kind: 'pillar', params: { cx: 50, y0: 0, n: 1, element: 'neutral' } },
      ],
      60,
    )
    expect(detectOverlaps(obstacles)).toEqual([])
  })

  it('roomWalls の四方の壁どうしは接するだけで重なり扱いにしない', () => {
    const obstacles = compileObstacles(
      [{ id: 'a', kind: 'roomWalls', params: { xL: -10, xR: 10, yB: -10, yT: 10 } }],
      30,
    )
    expect(detectOverlaps(obstacles)).toEqual([])
  })

  it('矩形（block）どうしが重なれば検出する（rect-rect）', () => {
    const obstacles = compileObstacles(
      [
        { id: 'a', kind: 'block', params: { x0: 0, y0: 0, cols: 3, rows: 3, element: 'neutral' } },
        { id: 'b', kind: 'block', params: { x0: 1, y0: 1, cols: 3, rows: 3, element: 'neutral' } },
      ],
      30,
    )
    expect(detectOverlaps(obstacles).length).toBeGreaterThan(0)
  })

  it('円（pillar）と矩形（block）が重なれば検出する（circle-rect）', () => {
    const obstacles = compileObstacles(
      [
        { id: 'a', kind: 'block', params: { x0: -3, y0: -3, cols: 3, rows: 3, element: 'neutral' } },
        { id: 'b', kind: 'pillar', params: { cx: 0, y0: 0, n: 1, element: 'neutral' } },
      ],
      30,
    )
    expect(detectOverlaps(obstacles).length).toBeGreaterThan(0)
  })

  it('離れた矩形どうしは重ならない（rect-rect）', () => {
    const obstacles = compileObstacles(
      [
        { id: 'a', kind: 'block', params: { x0: 0, y0: 0, cols: 2, rows: 2, element: 'neutral' } },
        { id: 'b', kind: 'block', params: { x0: 50, y0: 50, cols: 2, rows: 2, element: 'neutral' } },
      ],
      60,
    )
    expect(detectOverlaps(obstacles)).toEqual([])
  })
})
