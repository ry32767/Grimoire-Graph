// ステージ定義（機能14）。敵・障害物・テキスト・解禁メカニクスをデータとして分離。
// 段階的導入（機能17）：ステージが進むほど登場メカニクスが増える。
// ※ 属性は弾の関数値 z で決まる（ステージ固定の場は廃止）。敵弾は castZ で属性を持つ。
import type { Enemy, Stage } from '../game/types'
import { GAME } from './constants'

let seq = 0
function enemy(
  name: string,
  pos: { x: number; y: number },
  element: Enemy['element'],
  hp: number,
  castInitialSpeed: number,
  castMag = 3,
): Enemy {
  const angle = Math.atan2(-pos.y, -pos.x)
  // 敵弾の属性（castZ）は防御属性と同極：光の敵は正・闇の敵は負
  const castZ = element === 'light' ? castMag : -castMag
  return {
    id: `e${seq++}`,
    name,
    pos,
    hp,
    maxHp: hp,
    element,
    hitboxRadius: GAME.enemyHitbox,
    statuses: [],
    castTrajectory: { mode: 'rotate', g: () => 0, angle },
    castInitialSpeed,
    castZ,
  }
}

// ステージ1：遺跡の入口 ― 命中だけ（障害物・結界・敵弾なし）
const stage1: Stage = {
  id: 'stage-1',
  name: '第一の間 ― 遺跡の入口',
  enemies: [enemy('石像の番人', { x: 7, y: 1 }, 'dark', 50, 4)],
  obstacles: [],
  introText: [
    '苔むした石の間。壁面に古代式が薄く光っている。',
    '番人の石像がこちらを向いた。まずは関数を「描いて」当ててみよう。',
    'ヒント：術式は関数の値が大きいほど強く光/闇を帯びる。原点近くは中立で加速、当てる瞬間に強く帯びさせると大ダメージ。',
  ],
  clearText: ['石像は砕け、奥への扉が軋みながら開いた。', '古代式の手応えを掴んできた。'],
  mechanics: { obstacles: false, shield: false, enemyFire: false, parry: false },
  recommendedPresetId: 'line',
  recommendedSpeed: 8,
}

// ステージ2：地下回廊 ― 障害物・結界・敵弾が登場
const stage2: Stage = {
  id: 'stage-2',
  name: '第二の間 ― 地下回廊',
  enemies: [
    enemy('回廊の衛士', { x: 7, y: 3 }, 'dark', 70, 4),
    enemy('影の射手', { x: -6, y: 4 }, 'dark', 65, 4),
  ],
  obstacles: [
    { id: 'o-2a', pos: { x: 4, y: 1.5 }, hitboxRadius: 1.2, element: 'light', durability: 45, maxDurability: 45 },
  ],
  introText: [
    '長い回廊。石柱（障害物）が弾道を遮り、衛士たちが術式を放ってくる。',
    '柱は避けるか壊す。危なければ結界（円・楕円）を張って敵弾を止めよう。',
    'ヒント：敵は闇を帯びた弾を放つ。光を強く帯びた術式（関数値が正で大きい）で迎え撃て。',
  ],
  clearText: ['衛士たちは霧と消え、回廊の奥に階段が現れた。', '結界と障害物の扱いに慣れてきた。'],
  mechanics: { obstacles: true, shield: true, enemyFire: true, parry: false },
  recommendedPresetId: 'line',
  recommendedSpeed: 9,
}

// ステージ3：最奥の守護者 ― 全メカニクス＋パリィ
const stage3: Stage = {
  id: 'stage-3',
  name: '第三の間 ― 最奥の守護者',
  enemies: [
    enemy('封印の守護者', { x: 0, y: 8 }, 'light', 120, 5, 4),
    enemy('守護者の眷属', { x: 8, y: 0 }, 'dark', 55, 4, 3),
  ],
  obstacles: [
    { id: 'o-3a', pos: { x: 0, y: 4 }, hitboxRadius: 1.3, element: 'light', durability: 50, maxDurability: 50 },
  ],
  introText: [
    '魔導書の核心を守る、巨大な守護者。眷属を従え、強力な術式を放つ。',
    '敵弾の理を読み、反対の理（光⇔闇）をぶつけて相殺（パリィ）せよ。',
    'ヒント：守護者は光を帯びた弾、眷属は闇を帯びた弾。自弾の関数値の符号を使い分けて相殺・撃破せよ。',
  ],
  clearText: ['守護者は崩れ落ち、封印が解けていく。', '魔導書の核心まで、あと一歩。'],
  mechanics: { obstacles: true, shield: true, enemyFire: true, parry: true },
  recommendedPresetId: 'line',
  recommendedSpeed: 10,
}

export const STAGES: Stage[] = [stage1, stage2, stage3]
