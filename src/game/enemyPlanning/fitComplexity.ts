// 敵の「最適化できる式の複雑さ」（#70・05b §2.1）。純粋関数。
// 迂回型は経路を1本の式へフィットして壁を回り込むが、その式の自由度は敵の LVL で決まる。
// routeFit.ts（経路フィット）と trajectories.ts（直接候補の展開）が共有する。
import { ENEMY_FIT_COMPLEXITY, ENEMY_ROUTE_PLANNING as RP } from '../../data/constants'

/** 多重サインに掛ける包絡（積の因子）。expA=指数の伸び・cosB=余弦の周期（どちらも 0 なら積なし）。 */
export interface WaveFactor {
  expA: number
  cosB: number
}

/** 敵1体が扱える式の自由度。 */
export interface FitComplexity {
  /** 多項式フィットで試す次数（1=直線・2=放物線・…） */
  polyDegrees: readonly number[]
  /** |x−h| を重ねられる枚数（折れ点の数）。1 なら従来どおり単一のV字 */
  absFolds: number
  /** 多重サイン（フーリエ正弦級数）の項数上限 */
  harmonicTerms: number
  /** 多重サインに掛け合わせる包絡の候補（強い敵ほど多くの積を試せる） */
  waveFactors: readonly WaveFactor[]
  /**
   * **係数の可動域**（#76）：正則化（リッジ）係数に掛ける倍率の候補。
   * 小さいほど「係数を 0 へ引き戻す罰則」が弱まり、より大きな係数まで使える＝通過点へ密着できる。
   * 複数並べると、なめらかな解と振り切った解の両方が候補に載る（採否は本番物理の採点が決める）。
   */
  ridgeScales: readonly number[]
}

/**
 * LVL を指定しないときの既定（従来動作＝上級相当の一式）。
 * 味方の「おすすめ術式」（recommend.ts）はこれを使う＝プレイヤー向けの式は複雑化させない。
 */
export const DEFAULT_FIT_COMPLEXITY: FitComplexity = {
  polyDegrees: [3, 5],
  absFolds: 1,
  harmonicTerms: RP.harmonicMaxTerms,
  waveFactors: [{ expA: 0, cosB: 0 }],
  ridgeScales: [1],
}

/** 段階表の1段（複雑さ＋しきい LVL・表示名）。 */
export interface FitTier extends FitComplexity {
  minLevel: number
  label: string
}

const TIERS: readonly FitTier[] = ENEMY_FIT_COMPLEXITY.tiers

/**
 * 敵 LVL → 扱える式の複雑さ（ENEMY_FIT_COMPLEXITY.tiers の段階表を引く）。
 * level 未設定の個体は既定（従来動作）を返す。
 */
export function fitComplexityFor(level?: number): FitTier {
  if (level === undefined) return { ...DEFAULT_FIT_COMPLEXITY, minLevel: -1, label: '既定' }
  let picked = TIERS[0]
  for (const t of TIERS) if (level >= t.minLevel) picked = t
  return picked
}

/**
 * 直接候補（familyTrajectories）で展開してよい poly34 の最大次数。
 * 決め打ちの形状パレットは3次を最低保証とする（低 LVL でも poly34 個体が撃てなくならないように）。
 */
export function maxEnumPolyDegree(cx: FitComplexity): number {
  return Math.max(3, ...cx.polyDegrees)
}
