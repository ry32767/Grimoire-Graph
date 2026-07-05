// 敵編集の制約ロジック（#67・docs/11-stage-editor.md §6.2/§6.3）。
// 05b-enemy-archetypes.md §2/§3・06b-difficulty-framework.md §2〜§4 の解放表を純粋関数として実装する。
// UI（EnemyForm）はここで求めた許可集合の中から選ばせるだけにし、判定ロジック自体はテストしやすく分離する。
import type { EnemyFamily, EnemyRole, ZField } from '../game/types'
import { sinCosZ } from '../data/stageBuilders'
import { parseZExpression } from '../game/functions'

/** 迂回型・暴発型が使える family（05b §2：LVLに関わらず常に有効な制約）。 */
export const AVOIDER_FAMILIES: EnemyFamily[] = ['abs', 'arc', 'poly34']

/** family の LVL 解放順（06b §3）。 */
const FAMILY_UNLOCK: { level: number; family: EnemyFamily }[] = [
  { level: 1, family: 'line' },
  { level: 2, family: 'arc' },
  { level: 2, family: 'abs' },
  { level: 3, family: 'wave' },
  { level: 4, family: 'spiral' },
  { level: 4, family: 'exp' },
  { level: 5, family: 'poly34' },
]

/** LVL までに解放済みの family 一覧（role による絞り込みは allowedFamilies 側で行う）。 */
export function familiesUnlockedAtLevel(level: number): EnemyFamily[] {
  return FAMILY_UNLOCK.filter((u) => u.level <= level).map((u) => u.family)
}

/**
 * role・LVL に応じて選べる family（06b §3・05b §2）。
 * - LVL1のattacker（単純直進・パターン分化なし）は `line` のみ。
 * - 迂回型（LVL2以降のattacker）・暴発型（ruptor）は `abs`/`arc`/`poly34` のみ（全LVLで常時）。
 * - 守護型（guardian）は結界の外形用に `wave`/`spiral` のみ（攻撃しないため他は使わない）。
 * - 火力型（breaker）は制約なし（LVL解放のみに従う）。
 */
export function allowedFamilies(role: EnemyRole | undefined, level: number): EnemyFamily[] {
  const unlocked = familiesUnlockedAtLevel(level)
  if (role === undefined || (role === 'attacker' && level < 2)) {
    return unlocked.filter((f) => f === 'line')
  }
  if (role === 'attacker' || role === 'ruptor') {
    return unlocked.filter((f) => AVOIDER_FAMILIES.includes(f))
  }
  if (role === 'guardian') {
    return unlocked.filter((f) => f === 'wave' || f === 'spiral')
  }
  return unlocked // breaker
}

/** LVL で解放される攻撃パターン（06b §4）。 */
export function allowedRoles(level: number): EnemyRole[] {
  const roles: EnemyRole[] = ['attacker']
  if (level >= 3) roles.push('breaker')
  if (level >= 4) roles.push('guardian')
  if (level >= 5) roles.push('ruptor')
  return roles
}

/**
 * z場プリセット（データとして enemy() の castZField に渡せるもの）。
 * 暴発型の「極（1/x型）」は AI が対象へ向けて動的に計画する（`buildRuptorZField`）ため、
 * 静的なデータとしては持たせない＝選択肢に出さない（allowedZFields が role==='ruptor' で空を返す）。
 */
export type ZFieldPreset = 'constant' | 'sinCos' | 'exp' | 'custom'
export const Z_FIELD_PRESET_LABELS: Record<ZFieldPreset, string> = {
  constant: '一定',
  sinCos: 'sin/cos',
  exp: '指数（距離減衰）',
  custom: '自由入力式',
}

/** LVL に応じて選べる z場プリセット（06b §3）。暴発型は選択肢を持たない（上記コメント参照）。 */
export function allowedZFields(role: EnemyRole | undefined, level: number): ZFieldPreset[] {
  if (role === 'ruptor') return []
  const presets: ZFieldPreset[] = ['constant']
  if (level >= 3) presets.push('sinCos')
  if (level >= 5) presets.push('exp')
  if (level >= 6) presets.push('custom')
  return presets
}

/** 守護型の高難度オーラ（方向づけ・交互張り）がLVLで解禁されているか（05b §5.4・06b §3）。 */
export function guardianAuraOptions(level: number): { directedAura: boolean; alternatingAura: boolean } {
  return { directedAura: level >= 4, alternatingAura: level >= 6 }
}

/**
 * z場プリセット＋パラメータから castZField を組み立てる（enemy() の opts.castZField と同じ形）。
 * 'constant' は undefined を返す（castZ 定数のまま＝一定場）。自由入力式は mathjs のみで評価する
 * （src/game/functions.ts の parseZExpression を再利用。eval/new Function は使わない）。
 */
export function buildCastZField(
  preset: ZFieldPreset,
  sign: 1 | -1,
  customExpr: string | undefined,
): ((mag: number) => ZField) | undefined {
  switch (preset) {
    case 'constant':
      return undefined
    case 'sinCos':
      return sinCosZ(sign)
    case 'exp':
      return (mag: number): ZField =>
        (x: number, y: number) =>
          sign * mag * Math.exp(0.05 * Math.hypot(x, y) - 1)
    case 'custom': {
      if (!customExpr) return undefined
      const parsed = parseZExpression(customExpr)
      if (!parsed) return undefined
      return () => parsed
    }
  }
}

/** 自由入力の z場式が mathjs で正当に評価できるか（フォームのバリデーション表示用）。 */
export function isValidZExpression(expr: string): boolean {
  return parseZExpression(expr) !== null
}
