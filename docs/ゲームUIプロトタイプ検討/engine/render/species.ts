// 種族ビジュアル（05c §0/§6）の純粋関数群。draw.ts から使う。
// species×level（ティア）→ パレット・装飾パラメータへの写像を副作用なしで決める（テスト可能）。
import type { Enemy, EnemyRole, EnemySpecies } from '../game/types'

/** 結界の属性色（05c §4：光=金／闇=紫）。ゴーレムの目の発光色に使う。 */
export const GUARD_LIGHT = '#f4c430'
export const GUARD_DARK = '#7b5cc4'

/**
 * species 未設定時に role から種族を導出するフォールバック（描画専用）。
 * breaker→oni／ruptor→redWraith／guardian→golem／attacker→wraith／boss→boss扱い／その他→proto。
 * boss は専用描画へ回すため、ここでは種族列挙に含めず呼び出し側が boss フラグで分岐する。
 */
export function speciesOf(e: Pick<Enemy, 'species' | 'role' | 'boss'>): EnemySpecies {
  if (e.species) return e.species
  const role: EnemyRole | undefined = e.role
  if (role === 'breaker') return 'oni'
  if (role === 'ruptor') return 'redWraith'
  if (role === 'guardian') return 'golem'
  if (role === 'attacker') return 'wraith'
  return 'proto'
}

/** ティア（1〜3程度）。level(1〜7) を 3段階へ丸める（05c §6：一重/二重/三重・簡素/中/完成形）。 */
export function tierOf(level?: number): 1 | 2 | 3 {
  const l = level ?? 1
  if (l >= 6) return 3
  if (l >= 4) return 2
  return 1
}

/** 種族スプライトのパレット・装飾パラメータ（純粋・テスト対象）。 */
export interface SpeciesStyle {
  /** 主色（本体・鎧・ローブ） */
  base: string
  /** 副色（装飾・紋様・刃） */
  accent: string
  /** 縁取り・輪郭色 */
  edge: string
  /** 本体の透明度（0..1）。亡霊系は低め（半透明の幽体）、実体系は 1 */
  alpha: number
  /** 装飾の段数（鋼鬼=角/刃の数、ゴーレム=同心円の輪の数、亡霊=紋様の複雑さ、紅亡霊=亀裂の本数） */
  ornaments: number
  /** 紅亡霊の亀裂の明滅の速さ（0=なし）。ティアで上がる */
  crackPulse: number
}

/** 光/闇の基調色（属性）。中立は淡い石色。 */
function elementBase(element: Enemy['element'], light: string, dark: string, neutral: string): string {
  return element === 'light' ? light : element === 'dark' ? dark : neutral
}

/**
 * species×tier×element から描画スタイルを決める（05c §0/§6）。
 * ロジックには一切影響しない、見た目のパラメータのみ。
 */
export function speciesStyle(
  species: EnemySpecies,
  tier: 1 | 2 | 3,
  element: Enemy['element'],
): SpeciesStyle {
  switch (species) {
    case 'oni': {
      // 鋼鬼：武骨な鎧。ティアで装甲・角が増える。属性色で鎧を染める
      const base = elementBase(element, '#c9a24b', '#6b5aa8', '#8a8496')
      return {
        base,
        accent: '#e8e0c8', // 刃・鋲のハイライト
        edge: '#2a2438',
        alpha: 1,
        ornaments: tier, // 1→2→3 で角・刃が増える
        crackPulse: 0,
      }
    }
    case 'wraith': {
      // 亡霊魔術師：半透明ローブ。ティアで輪郭が濃く・紋様が複雑に
      const base = elementBase(element, '#d8c47a', '#6c5bb0', '#8f8aa6')
      return {
        base,
        accent: '#efe9ff', // 紋様
        edge: element === 'light' ? '#a98a2e' : '#3a2f66',
        alpha: 0.4 + tier * 0.16, // 0.56→0.72→0.88：ティアで実体に近づく
        ornaments: tier,
        crackPulse: 0,
      }
    }
    case 'redWraith': {
      // 紅亡霊：亡霊と同形だが赤い亀裂が明滅。一目で危険とわかる配色
      const base = elementBase(element, '#b07a6a', '#7a5a86', '#8a6a72')
      return {
        base,
        accent: '#ff3b3b', // 亀裂の紅
        edge: '#5a1f24',
        alpha: 0.5 + tier * 0.12,
        ornaments: tier, // 亀裂の本数
        crackPulse: 1 + tier, // ティアで明滅頻度が上がる
      }
    }
    case 'golem': {
      // ゴーレム：石塊＋同心円紋様。目は結界属性色（描画側で上書き）
      const base = elementBase(element, '#8a7c5e', '#5a5470', '#6e6a78')
      return {
        base,
        accent: '#b8b0c8', // 紋様の溝
        edge: '#2c2836',
        alpha: 1,
        ornaments: tier, // 一重→二重→三重
        crackPulse: 0,
      }
    }
    case 'proto':
    default: {
      // 原型：無装飾の石像（既存の石像表現の基準色）
      const base = elementBase(element, '#f4c430', '#7b5cc4', '#6a6678')
      return {
        base,
        accent: element === 'light' ? '#fff8e1' : '#1e2a6b',
        edge: '#3a2342',
        alpha: 1,
        ornaments: 0,
        crackPulse: 0,
      }
    }
  }
}
