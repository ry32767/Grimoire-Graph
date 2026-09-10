import { describe, expect, it } from 'vitest'
import { recommendBatch, type RecommendBatchInput } from './recommendBatch'
import { recommendCast } from './recommend'

const input: RecommendBatchInput = {
  allies: [{ id: 'a', pos: { x: 0, y: 0 } }],
  enemies: [
    { id: 'dead', hp: 0, pos: { x: 0, y: 1 }, element: 'light', hitboxRadius: 2 },
    { id: 'far', hp: 100, pos: { x: 0, y: 20 }, element: 'light', hitboxRadius: 2 },
    { id: 'near', hp: 100, pos: { x: 0, y: 10 }, element: 'dark', hitboxRadius: 2 },
  ],
  obstacles: [],
  rField: 25,
}

describe('一括おまかせのWorker用計算', () => {
  it('最寄りの生存敵への従来の探索結果と一致し、入力を書き換えない', () => {
    const before = structuredClone(input)
    const results = recommendBatch(input)
    expect(results).toEqual([{
      allyId: 'a', recommendation: recommendCast(input.allies[0].pos, input.enemies[2], [], 25),
    }])
    expect(input).toEqual(before)
    expect(structuredClone(results)).toEqual(results)
  })

  it('敵が全滅しているときや対象術者がいないときは空の結果を返す', () => {
    expect(recommendBatch({ ...input, enemies: [input.enemies[0]] })).toEqual([])
    expect(recommendBatch({ ...input, allies: [] })).toEqual([])
  })
})
