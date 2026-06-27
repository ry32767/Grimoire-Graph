// ステージ定義（機能14・#15）。敵チームは上方、味方パーティは下方に配置。
// 段階的導入：ステージが進むほど登場メカニクスが増える。Phase F で5+ボスに拡張。
import type { Enemy, Obstacle, Stage } from '../game/types'
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
  // 敵弾の属性（castZ）は防御属性と同極：光の敵は正・闇の敵は負
  const castZ = element === 'light' ? castMag : element === 'dark' ? -castMag : 0
  return {
    id: `e${seq++}`,
    name,
    pos,
    hp,
    maxHp: hp,
    element,
    hitboxRadius: GAME.enemyHitbox,
    statuses: [],
    castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
    castInitialSpeed,
    castZ,
  }
}

function obstacle(
  id: string,
  pos: { x: number; y: number },
  radius: number,
  element: Obstacle['element'],
  durability: number,
): Obstacle {
  return { id, pos, hitboxRadius: radius, element, durability, maxDurability: durability, maxRadius: radius }
}

// ステージ1：遺跡の入口 ― 命中だけ（障害物・敵弾なし）
const stage1: Stage = {
  id: 'stage-1',
  name: '第一の間 ― 遺跡の入口',
  enemies: [enemy('石像の番人', { x: 0, y: 9 }, 'dark', 60, 5)],
  obstacles: [],
  introText: [
    '苔むした石の間。壁面に古代式が薄く光っている。',
    '番人の石像がこちらを向いた。3人の術者で関数を「描いて」当ててみよう。',
    'ヒント：当てる瞬間に関数値を大きくすると強く光/闇を帯び、大ダメージ。',
  ],
  clearText: ['石像は砕け、奥への扉が軋みながら開いた。', '古代式の手応えを掴んできた。'],
  mechanics: { obstacles: false, enemyFire: false },
}

// ステージ2：地下回廊 ― 障害物・敵弾が登場
const stage2: Stage = {
  id: 'stage-2',
  name: '第二の間 ― 地下回廊',
  enemies: [
    enemy('回廊の衛士', { x: -6, y: 8 }, 'dark', 70, 5),
    enemy('影の射手', { x: 6, y: 9 }, 'dark', 65, 5),
  ],
  obstacles: [obstacle('o-2a', { x: 0, y: 2 }, 1.4, 'light', 55)],
  introText: [
    '長い回廊。石柱（障害物）が弾道を遮り、衛士たちが術式を放ってくる。',
    '柱は避けるか削って壊す。円（ループ）を描けば周回結界となり敵弾を弾く（防御）。',
    'ヒント：敵は闇の弾。光を強く帯びた術式で迎え撃て。',
  ],
  clearText: ['衛士たちは霧と消え、回廊の奥に階段が現れた。', '障害物と周回結界の扱いに慣れてきた。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// ステージ3：最奥の守護者 ― 全メカニクス
const stage3: Stage = {
  id: 'stage-3',
  name: '第三の間 ― 最奥の守護者',
  enemies: [
    enemy('封印の守護者', { x: 0, y: 11 }, 'light', 130, 6, 4),
    enemy('守護者の眷属', { x: 8, y: 6 }, 'dark', 60, 5, 3),
    enemy('守護者の眷属', { x: -8, y: 6 }, 'dark', 60, 5, 3),
  ],
  obstacles: [obstacle('o-3a', { x: 0, y: 5 }, 1.5, 'light', 60)],
  introText: [
    '魔導書の核心を守る、巨大な守護者。眷属を従え、強力な術式を放つ。',
    '敵弾の理を読み、反対の理（光⇔闇）をぶつけて相殺（パリィ）せよ。',
    'ヒント：守護者は光の弾、眷属は闇の弾。関数値の符号を使い分けて撃破せよ。',
  ],
  clearText: ['守護者は崩れ落ち、封印が解けていく。', '魔導書の核心まで、あと一歩。'],
  mechanics: { obstacles: true, enemyFire: true },
}

export const STAGES: Stage[] = [stage1, stage2, stage3]
