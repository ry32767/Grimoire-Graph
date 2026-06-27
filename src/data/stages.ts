// ステージ定義（機能14・#6・#15）。チュートリアル＋5ステージ＋ボス。敵は上方、味方は下方。
// 段階的導入：進むほど敵数・属性の混在・障害物が増える。
import type { Enemy, EnemyFamily, Obstacle, Stage } from '../game/types'
import { GAME } from './constants'

let seq = 0
function enemy(
  name: string,
  pos: { x: number; y: number },
  element: Enemy['element'],
  hp: number,
  castInitialSpeed: number,
  family: EnemyFamily = 'line',
  castMag = 3,
  hitboxRadius: number = GAME.enemyHitbox,
): Enemy {
  const castZ = element === 'light' ? castMag : element === 'dark' ? -castMag : 0
  return {
    id: `e${seq++}`,
    name,
    pos,
    hp,
    maxHp: hp,
    element,
    hitboxRadius,
    statuses: [],
    family,
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

// 1：遺跡の入口（チュートリアル）― 命中だけ
const stage1: Stage = {
  id: 'stage-1',
  name: '第一の間 ― 遺跡の入口',
  enemies: [enemy('石像の番人', { x: 0, y: 9 }, 'dark', 60, 5, 'line')],
  obstacles: [],
  introText: [
    '苔むした石の間。壁面に古代式が薄く光っている。',
    '番人の石像がこちらを向いた。3人の術者で関数を「描いて」当ててみよう。',
    'ヒント：当てる瞬間に関数値を大きくすると強く光/闇を帯び、大ダメージ。',
  ],
  clearText: ['石像は砕け、奥への扉が軋みながら開いた。', '古代式の手応えを掴んできた。'],
  mechanics: { obstacles: false, enemyFire: false },
}

// 2：地下回廊 ― 障害物・敵弾が登場
const stage2: Stage = {
  id: 'stage-2',
  name: '第二の間 ― 地下回廊',
  enemies: [
    enemy('回廊の衛士', { x: -6, y: 8 }, 'dark', 70, 5, 'arc'),
    enemy('影の射手', { x: 6, y: 9 }, 'dark', 70, 5, 'wave'),
  ],
  obstacles: [obstacle('o-2a', { x: -3, y: 2 }, 1.4, 'light', 55), obstacle('o-2b', { x: 4, y: 3 }, 1.2, 'dark', 45)],
  introText: [
    '長い回廊。石柱（障害物）が弾道を遮り、衛士たちが術式を放ってくる。',
    '柱は避けるか削って壊す。円（ループ）を描けば周回結界となり敵弾を弾く（防御）。',
    'ヒント：敵弾は曲がって来る。敵の記号〔弧/波〕で軌道を読もう。',
  ],
  clearText: ['衛士たちは霧と消え、回廊の奥に階段が現れた。', '障害物と周回結界の扱いに慣れてきた。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 3：双子の祭壇 ― 光と闇が混在
const stage3: Stage = {
  id: 'stage-3',
  name: '第三の間 ― 双子の祭壇',
  enemies: [
    enemy('白の祭司', { x: -7, y: 9 }, 'light', 85, 5, 'arc'),
    enemy('黒の祭司', { x: 7, y: 9 }, 'dark', 85, 5, 'arc'),
    enemy('祭壇の影', { x: 0, y: 12 }, 'dark', 70, 5, 'wave'),
  ],
  obstacles: [obstacle('o-3a', { x: 0, y: 4 }, 1.5, 'light', 60)],
  introText: [
    '左右に光と闇、双子の祭司。属性を見極めて反対の理をぶつけよう。',
    '光の敵には闇（関数値を負に）、闇の敵には光（正に）が有効（×1.5）。',
    'ヒント：味方ごとに違う関数を割り当て、3人で弱点を突け。',
  ],
  clearText: ['双子の祭司は均衡を崩し、砕け散った。', '光と闇の使い分けが板についてきた。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 4：螺旋の坑道 ― 渦の敵と柱
const stage4: Stage = {
  id: 'stage-4',
  name: '第四の間 ― 螺旋の坑道',
  enemies: [
    enemy('渦の番兵', { x: -8, y: 8 }, 'dark', 90, 5, 'spiral'),
    enemy('渦の番兵', { x: 8, y: 8 }, 'dark', 90, 5, 'spiral'),
    enemy('坑道の弓手', { x: 0, y: 11 }, 'light', 80, 6, 'wave'),
  ],
  obstacles: [
    obstacle('o-4a', { x: -4, y: 3 }, 1.3, 'dark', 55),
    obstacle('o-4b', { x: 4, y: 3 }, 1.3, 'dark', 55),
    obstacle('o-4c', { x: 0, y: 6 }, 1.2, 'light', 50),
  ],
  introText: [
    '渦巻く術式が四方から迫る坑道。柱が多く弾道が遮られる。',
    '放物線で柱を山越えし、円の周回結界で渦を受け流そう。',
    'ヒント：障害物は当てるほど半径が縮む。削って道を開け。',
  ],
  clearText: ['渦は鎮まり、坑道の奥に微かな光が差した。', '入り組んだ地形にも対応できるようになった。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 5：鏡の広間 ― 数で攻める
const stage5: Stage = {
  id: 'stage-5',
  name: '第五の間 ― 鏡の広間',
  enemies: [
    enemy('鏡像の衛士', { x: -9, y: 8 }, 'light', 85, 5, 'line'),
    enemy('鏡像の衛士', { x: 9, y: 8 }, 'dark', 85, 5, 'line'),
    enemy('鏡像の射手', { x: -4, y: 12 }, 'dark', 80, 6, 'wave'),
    enemy('鏡像の射手', { x: 4, y: 12 }, 'light', 80, 6, 'wave'),
  ],
  obstacles: [obstacle('o-5a', { x: 0, y: 5 }, 1.6, 'light', 70)],
  introText: [
    '無数の鏡像。4体が一斉に術式を放ってくる。',
    '狙われた味方は周回結界で守り、他の2人で集中砲火を。',
    'ヒント：敵AIは手負い・とどめを狙う。HP配分に注意。',
  ],
  clearText: ['鏡像は一斉に砕け、乱れた反射が消えた。', '多対多の捌きを覚えた。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 6：封印の回廊 ― ボス前の精鋭
const stage6: Stage = {
  id: 'stage-6',
  name: '第六の間 ― 封印の回廊',
  enemies: [
    enemy('封印の番人', { x: 0, y: 12 }, 'light', 120, 6, 'wave', 4),
    enemy('回廊の番兵', { x: -8, y: 8 }, 'dark', 90, 5, 'spiral'),
    enemy('回廊の番兵', { x: 8, y: 8 }, 'dark', 90, 5, 'arc'),
  ],
  obstacles: [
    obstacle('o-6a', { x: -5, y: 4 }, 1.4, 'dark', 60),
    obstacle('o-6b', { x: 5, y: 4 }, 1.4, 'dark', 60),
  ],
  introText: [
    '核心を守る精鋭たち。強い光の番人が眷属を率いる。',
    'ここを抜ければ守護者の間。総力戦の覚悟を。',
    'ヒント：暴発（関数エラー）は最大の光闇AoE。狙って当てる手もある。',
  ],
  clearText: ['精鋭は崩れ落ち、最奥への扉が開いた。', '守護者の気配が濃くなる。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 7：守護者ボス戦
const stage7: Stage = {
  id: 'stage-7',
  name: '第七の間 ― 守護者ボス戦',
  boss: true,
  enemies: [
    enemy('魔導書の守護者', { x: 0, y: 12 }, 'light', 260, 6, 'wave', 5, 2.4),
    enemy('守護者の眷属', { x: -9, y: 7 }, 'dark', 80, 5, 'spiral'),
    enemy('守護者の眷属', { x: 9, y: 7 }, 'dark', 80, 5, 'arc'),
  ],
  obstacles: [
    obstacle('o-7a', { x: 0, y: 6 }, 1.7, 'light', 90),
    obstacle('o-7b', { x: -5, y: 3 }, 1.1, 'dark', 45),
    obstacle('o-7c', { x: 5, y: 3 }, 1.1, 'dark', 45),
  ],
  introText: [
    '魔導書の核心を守る巨大な守護者。眷属を従え、強力な波状術式を放つ。',
    '3人の術者の総力で、光と闇を操り守護者を打ち倒せ。',
    'ヒント：眷属を先に処理し、結界で凌ぎつつ守護者へ反対の理を集中。',
  ],
  clearText: ['守護者は崩れ落ち、封印が完全に解けた。', '魔導書の核心が、静かに開かれていく。'],
  mechanics: { obstacles: true, enemyFire: true },
}

export const STAGES: Stage[] = [stage1, stage2, stage3, stage4, stage5, stage6, stage7]
