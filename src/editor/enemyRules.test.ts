// 敵編集の制約ロジックのテスト（#67・docs/11-stage-editor.md §6.2/§6.3・05b §2/06b §3）。
import { describe, expect, it } from 'vitest'
import {
  allowedFamilies,
  allowedRoles,
  allowedZFields,
  buildCastZField,
  familiesUnlockedAtLevel,
  guardianAuraOptions,
  isValidZExpression,
} from './enemyRules'

describe('familiesUnlockedAtLevel', () => {
  it('LVL1はlineのみ', () => {
    expect(familiesUnlockedAtLevel(1)).toEqual(['line'])
  })
  it('LVL5でpoly34まで全て解放', () => {
    expect(familiesUnlockedAtLevel(5).sort()).toEqual(['abs', 'arc', 'exp', 'line', 'poly34', 'spiral', 'wave'].sort())
  })
})

describe('allowedFamilies', () => {
  it('LVL1のattacker（単純直進）はlineのみ', () => {
    expect(allowedFamilies('attacker', 1)).toEqual(['line'])
  })
  it('roleが未指定でも単純attacker扱い＝lineのみ', () => {
    expect(allowedFamilies(undefined, 4)).toEqual(['line'])
  })
  it('迂回型（LVL2以降のattacker）はabs/arc/poly34のみ（line/wave/exp/spiralを含まない）', () => {
    const fam = allowedFamilies('attacker', 7)
    expect(fam.sort()).toEqual(['abs', 'arc', 'poly34'].sort())
    expect(fam).not.toContain('line')
    expect(fam).not.toContain('wave')
    expect(fam).not.toContain('exp')
    expect(fam).not.toContain('spiral')
  })
  it('暴発型もabs/arc/poly34のみに制限される', () => {
    const fam = allowedFamilies('ruptor', 7)
    expect(fam.sort()).toEqual(['abs', 'arc', 'poly34'].sort())
  })
  it('迂回型・暴発型はLVLが低いうちはpoly34を含まない（LVL5未満）', () => {
    expect(allowedFamilies('attacker', 4)).toEqual(['arc', 'abs'])
  })
  it('守護型はwave/spiralのみ（LVLで段階解放）', () => {
    expect(allowedFamilies('guardian', 3)).toEqual(['wave'])
    expect(allowedFamilies('guardian', 4).sort()).toEqual(['wave', 'spiral'].sort())
  })
  it('火力型（breaker）はLVL解放以外の制約を受けない', () => {
    expect(allowedFamilies('breaker', 7).sort()).toEqual(
      ['line', 'arc', 'abs', 'wave', 'spiral', 'exp', 'poly34'].sort(),
    )
  })
})

describe('allowedRoles', () => {
  it('LVL1はattackerのみ', () => {
    expect(allowedRoles(1)).toEqual(['attacker'])
  })
  it('LVL7で全パターン解放', () => {
    expect(allowedRoles(7).sort()).toEqual(['attacker', 'breaker', 'guardian', 'ruptor'].sort())
  })
  it('暴発型はLVL5から', () => {
    expect(allowedRoles(4)).not.toContain('ruptor')
    expect(allowedRoles(5)).toContain('ruptor')
  })
})

describe('allowedZFields', () => {
  it('暴発型は選択肢を持たない（極はAIが動的に計画するため）', () => {
    expect(allowedZFields('ruptor', 7)).toEqual([])
  })
  it('LVL1〜2は一定のみ', () => {
    expect(allowedZFields('attacker', 2)).toEqual(['constant'])
  })
  it('LVL3でsin/cosが追加', () => {
    expect(allowedZFields('attacker', 3)).toEqual(['constant', 'sinCos'])
  })
  it('LVL5で指数、LVL6で自由入力式が追加', () => {
    expect(allowedZFields('attacker', 5)).toEqual(['constant', 'sinCos', 'exp'])
    expect(allowedZFields('attacker', 6)).toEqual(['constant', 'sinCos', 'exp', 'custom'])
  })
})

describe('guardianAuraOptions', () => {
  it('方向づけはLVL4から、交互張りはLVL6から', () => {
    expect(guardianAuraOptions(3)).toEqual({ directedAura: false, alternatingAura: false })
    expect(guardianAuraOptions(4)).toEqual({ directedAura: true, alternatingAura: false })
    expect(guardianAuraOptions(6)).toEqual({ directedAura: true, alternatingAura: true })
  })
})

describe('buildCastZField', () => {
  it('一定プリセットはundefined（castZ定数のまま）', () => {
    expect(buildCastZField('constant', 1, undefined)).toBeUndefined()
  })
  it('sinCosプリセットは(mag)=>ZFieldを返す', () => {
    const build = buildCastZField('sinCos', 1, undefined)
    expect(build).toBeDefined()
    const z = build?.(3)
    expect(typeof z?.(0, 0)).toBe('number')
  })
  it('自由入力式はmathjsで評価される（eval/new Functionを使わない）', () => {
    const build = buildCastZField('custom', 1, 'sin(x)+cos(y)')
    const z = build?.(3)
    expect(z?.(0, 0)).toBeCloseTo(1)
  })
  it('不正な自由入力式（代入など許可外ノード）はundefinedを返す（直前の状態を維持する方針）', () => {
    expect(buildCastZField('custom', 1, 'x = 1')).toBeUndefined()
  })
})

describe('isValidZExpression', () => {
  it('mathjsで評価できる式はtrue', () => {
    expect(isValidZExpression('2*sin(x)+y')).toBe(true)
  })
  it('evalやnew Functionに繋がりうる構文はfalse', () => {
    expect(isValidZExpression('x=1')).toBe(false)
  })
})
