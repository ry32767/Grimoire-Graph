import { describe, expect, it } from 'vitest'
import { firstInvalidCaster } from './castValidation'
import { yTextPatch, zTextPatch } from './composer'

const allies = [{ id: 'mira', hp: 100 }, { id: 'ren', hp: 100 }]
const valid = { freeError: null, zFreeError: null }

describe('発射前の入力検証', () => {
  it('非選択の術者でも構文エラーがあればそのIDを返す', () => {
    const invalid = { ...valid, ...yTextPatch('sin(') }
    expect(firstInvalidCaster(allies, [], { mira: valid, ren: invalid })).toBe('ren')
  })

  it('属性式の構文エラーも発射を止める', () => {
    const invalid = { ...valid, ...zTextPatch('sqrt(') }
    expect(firstInvalidCaster(allies, [], { mira: invalid })).toBe('mira')
  })

  it('倒れた術者とひるんだ術者の入力エラーは発射を妨げない', () => {
    const invalid = { ...valid, ...yTextPatch('sin(') }
    expect(firstInvalidCaster(
      [{ id: 'mira', hp: 0 }, allies[1]], ['ren'], { mira: invalid, ren: invalid },
    )).toBeNull()
  })

  it('構文が有効な発散式は暴発用の術式として発射できる', () => {
    const divergent = { ...valid, ...yTextPatch('1/(x-10)'), ...zTextPatch('1/(t-10)') }
    expect(divergent.freeError).toBeNull()
    expect(divergent.zFreeError).toBeNull()
    expect(firstInvalidCaster(allies, [], { mira: divergent, ren: valid })).toBeNull()
  })
})
