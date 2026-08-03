// 守護型（guardian）が「結界の最適化にどれだけ複雑な式を使えるか」の LVL 段階（#71・05b §5.4）。
// 迂回型の fitComplexity（#70）と同じ思想：弱い個体は真円＋一様な場しか組めず、
// 強い個体ほど外形（フーリエ項数）・z 場（多重余弦・exp の積・過励起）・重ね張り枚数が増える。
import { ENEMY_GUARD_PLANNING as GP } from '../../data/constants'

/** 守護型1体が扱える結界の自由度。 */
export interface GuardTier {
  minLevel: number
  label: string
  /** 外形フーリエ級数の項数（0＝真円のみ） */
  shapeTerms: number
  /** z 場の多重余弦の項数（1＝単一の余弦まで） */
  zHarmonics: number
  /** z 場の exp 包絡の鋭さ κ（0＝exp の積なし） */
  zSharp: number
  /** |z| の上限倍率（zRef 基準。1＝過励起なし） */
  zOverdrive: number
  /** 同時に保持できる自前の結界の枚数 */
  maxLayers: number
}

const TIERS: readonly GuardTier[] = GP.tiers

/** 敵 LVL → 扱える結界の複雑さ。level 未設定の個体は最下段（真円・一様＝従来動作）。 */
export function guardTierFor(level?: number): GuardTier {
  if (level === undefined) return TIERS[0]
  let picked = TIERS[0]
  for (const t of TIERS) if (level >= t.minLevel) picked = t
  return picked
}
