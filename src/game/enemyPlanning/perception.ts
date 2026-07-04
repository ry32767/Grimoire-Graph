// 敵AIの「見え方」と標的優先度（#35/#39・05-enemies §5.4b）。純粋関数。
// enemyAI.ts（攻撃計画）と ruptorPlanner.ts（暴発計画）が共有する。
import type { Ally, Enemy, EnemyFamily, Vec2 } from '../types'
import { AVOIDER_FAMILIES } from './trajectories'

/** 闇の周回1重あたり、敵が見誤る距離（ユニット・#35）。ヒットボックスより大きく外す。 */
const CONCEAL_JITTER = 3.5

/** 文字列IDから安定した方向ベクトルを作る（隠れた味方の見かけ位置をずらす・#35）。 */
function idDir(id: string): Vec2 {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997
  const ang = (h / 997) * Math.PI * 2
  return { x: Math.cos(ang), y: Math.sin(ang) }
}

/**
 * 敵が認識する味方位置（#35/#39）。闇の周回で隠れているほど真の位置から離れて見える。
 * ブレ幅は囲む円の半径に連動した RMSE（concealRmse・1重=半径/2、2重=半径）。
 * 方向は id 由来で安定（純粋関数を保つ＝同ターンの再評価で揺らがない）。RMSE 未設定の旧データは重数×既定幅。
 */
export function perceivedPos(ally: Ally): Vec2 {
  const conceal = ally.concealed ?? 0
  if (conceal <= 0) return ally.pos
  const mag = ally.concealRmse && ally.concealRmse > 0 ? ally.concealRmse : conceal * CONCEAL_JITTER
  const d = idDir(ally.id)
  return { x: ally.pos.x + d.x * mag, y: ally.pos.y + d.y * mag }
}

/** 敵が狙う味方の優先度（woundFocus/lowHpBias・05-enemies §5.4b）。 */
export function threatScore(a: Ally): number {
  const woundFocus = 1 + (1 - a.hp / a.maxHp) * 0.5
  const lowHpBias = 1 + Math.max(0, (60 - a.hp) / 60) * 0.25
  return woundFocus * lowHpBias
}

/** 敵が実際に使う得意関数の系統一覧（#28：family＋families を重複なくまとめる）。 */
export function enemyFamilies(enemy: Enemy): EnemyFamily[] {
  if (!enemy.families || enemy.families.length === 0) return [enemy.family]
  return Array.from(new Set([enemy.family, ...enemy.families]))
}

/**
 * 迂回型・暴発型が使う family を AVOIDER_FAMILIES（abs/arc/poly34）に制限する（#46・05b §2）。
 * wave/exp/spiral/line は決して選ばれない。フィルタ結果が空（第1面の line 素 attacker 等）なら
 * 後方互換として元の family をそのまま返す（＝素の直進 attacker）。
 */
export function avoiderFamiliesOf(enemy: Enemy): EnemyFamily[] {
  const fams = enemyFamilies(enemy).filter((f) => AVOIDER_FAMILIES.includes(f))
  return fams.length > 0 ? fams : enemyFamilies(enemy)
}
