// ステージ定義（機能14・#6・#15）。スケール1.5倍（場 r=30）。敵は上方、味方は下方。
// 障害物は solids（重なった円の和＝連続したブロブ）で、ステージのテーマに合わせて配置（列柱・
// 祭壇・螺旋・鏡・封印壁・巨壁）。当たった点を円でえぐり取り滑らかな穴が開く（Graph War 風）。
import type { Disc, Enemy, EnemyFamily, EnemyRole, Obstacle, ObstacleKind, Stage } from '../game/types'
import { GAME } from './constants'

/** 敵の追加設定（#28：複数得意関数・戦い方ロール） */
interface EnemyOpts {
  /** 得意関数を複数持つ（family と合わせて1～2個・中盤以降） */
  families?: EnemyFamily[]
  /** 戦い方（attacker/breaker/guardian）。未指定は attacker */
  role?: EnemyRole
  castMag?: number
  hitboxRadius?: number
}

let seq = 0
function enemy(
  name: string,
  pos: { x: number; y: number },
  element: Enemy['element'],
  hp: number,
  castInitialSpeed: number,
  family: EnemyFamily = 'line',
  opts: EnemyOpts = {},
): Enemy {
  const castMag = opts.castMag ?? 3
  const castZ = element === 'light' ? castMag : element === 'dark' ? -castMag : 0
  return {
    id: `e${seq++}`,
    name,
    pos,
    hp,
    maxHp: hp,
    element,
    hitboxRadius: opts.hitboxRadius ?? GAME.enemyHitbox,
    statuses: [],
    family,
    families: opts.families,
    role: opts.role,
    castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
    castInitialSpeed,
    castZ,
  }
}

// 障害物は solids（重なった円の和＝連続したブロブ）で構成し、ステージのテーマに合わせて配置する。
// 魔法が当たった点を中心に円でえぐり取られ、滑らかな穴が開く（Graph War 風・耐久値なし）。
const R = 2.4 // 円の半径
const STEP = 2.4 // 円の間隔（半径と同じ＝隣と重なって連続したブロブになる）
let oseq = 0
function ob(element: Obstacle['element'], solids: Disc[], kind?: ObstacleKind): Obstacle {
  return kind ? { id: `o${oseq++}`, element, solids, carves: [], kind } : { id: `o${oseq++}`, element, solids, carves: [] }
}
/** 縦の柱：(cx, y0) から上へ n 個の円を積んだブロブ */
function pillar(cx: number, y0: number, n: number, element: Obstacle['element'], kind?: ObstacleKind): Obstacle {
  return ob(
    element,
    Array.from({ length: n }, (_, i) => ({ x: cx, y: y0 + i * STEP, r: R })),
    kind,
  )
}
/** 矩形ブロック：左下 (x0, y0) から cols×rows の円を敷き詰めたブロブ */
function block(
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  element: Obstacle['element'],
  kind?: ObstacleKind,
): Obstacle {
  const solids: Disc[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) solids.push({ x: x0 + c * STEP, y: y0 + r * STEP, r: R })
  return ob(element, solids, kind)
}
/** 渦巻きの腕：(cx, cy) を中心にアルキメデス螺旋へ n 個並べたブロブ（位相 phase でずらす） */
function spiralArm(
  cx: number,
  cy: number,
  n: number,
  turns: number,
  phase: number,
  element: Obstacle['element'],
): Obstacle {
  return ob(
    element,
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * turns * Math.PI * 2 + phase
      const rad = 2.5 + 0.9 * t
      return { x: cx + rad * Math.cos(t), y: cy + rad * Math.sin(t), r: R }
    }),
  )
}
/** x0→x1 を step 刻みで並べた x 座標列 */
function spanX(x0: number, x1: number, step: number): number[] {
  const xs: number[] = []
  for (let x = x0; x <= x1 + 1e-6; x += step) xs.push(x)
  return xs
}
/**
 * 横一列に連続する壁（円を overlap させて x0→x1 を切れ目なく覆う・建物の壁）。rows 段重ね。
 * 開始時に味方→敵の直線を遮る「壁」の本体に使う。
 */
function wall(
  x0: number,
  x1: number,
  y0: number,
  rows: number,
  element: Obstacle['element'],
  kind?: ObstacleKind,
): Obstacle {
  const solids: Disc[] = []
  const step = R * 1.4 // overlap させて連続させる
  for (let r = 0; r < rows; r++) for (const x of spanX(x0, x1, step)) solids.push({ x, y: y0 + r * step, r: R })
  return ob(element, solids, kind)
}
/**
 * 列柱（建物内の柱がたくさん並ぶ）。x0→x1 を step 間隔で、各柱は縦 n 段のブロブ。
 * step を 3.6 程度にすると隣の柱と少し重なり、柱の隙間から直線で抜けられない（連続した列柱）。
 * elems を順に割り当てて光闇を交互にできる。
 */
function colonnade(
  x0: number,
  x1: number,
  step: number,
  y0: number,
  n: number,
  elems: Obstacle['element'][],
): Obstacle[] {
  return spanX(x0, x1, step).map((x, i) => pillar(x, y0, n, elems[i % elems.length]))
}

// 1：遺跡の入口（チュートリアル）― 命中だけ
const stage1: Stage = {
  id: 'stage-1',
  name: '第一の間 ― 遺跡の入口',
  enemies: [enemy('石像の番人', { x: 0, y: 19 }, 'dark', 90, 8, 'line')],
  obstacles: [],
  introText: [
    '苔むした石の間。壁面に古代式が薄く光っている。',
    '番人の石像がこちらを向いた。3人の術者で関数を「描いて」当ててみよう。',
    'ヒント：当てる瞬間に関数値を大きくすると強く光/闇を帯び、大ダメージ。',
  ],
  clearText: ['石像は砕け、奥への扉が軋みながら開いた。', '古代式の手応えを掴んできた。'],
  mechanics: { obstacles: false, enemyFire: false },
}

// 2：地下回廊 ― 大きな石柱が登場
const stage2: Stage = {
  id: 'stage-2',
  name: '第二の間 ― 地下回廊',
  enemies: [
    enemy('回廊の衛士', { x: -12, y: 19 }, 'dark', 110, 8, 'arc'),
    enemy('影の射手', { x: 12, y: 20 }, 'dark', 105, 8, 'wave'),
  ],
  // 地下回廊：石柱がずらりと並ぶ列柱の回廊。柱が密に連なり、直線では敵に届かない。
  // 中央に補強された頑丈な隔壁（無属性・tough）が据えられ、削るより山越えが早い。
  obstacles: [
    ...colonnade(-18, 18, 3.6, -1, 4, ['dark', 'light']),
    block(-2, 7, 3, 2, 'neutral', 'tough'), // 補強された頑丈な無属性の隔壁（#40：最大火力でも何発もかかる）
  ],
  introText: [
    '長い地下回廊。太い石柱がずらりと並び、まっすぐの射線をことごとく塞ぐ。',
    '直線では柱に阻まれる。放物線で柱の上を山越えするか、魔法で削ってトンネルを開こう。',
    'ヒント：魔法は当たった点を中心に円形に削れる。反対の理ほど安く削れて貫通しやすい。',
    'ヒント：頑丈な無属性の隔壁（鋲打ちの石）は削れにくい。無理に削らず迂回・山越えも手だ。',
  ],
  clearText: ['衛士たちは霧と消え、回廊の奥に階段が現れた。', '障害物の崩し方が分かってきた。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 3：双子の祭壇 ― 光と闇が混在＋中央の大柱
const stage3: Stage = {
  id: 'stage-3',
  name: '第三の間 ― 双子の祭壇',
  enemies: [
    enemy('白の祭司', { x: -13, y: 19 }, 'light', 130, 8, 'arc', { families: ['wave'] }),
    enemy('黒の祭司', { x: 13, y: 19 }, 'dark', 130, 8, 'arc', { families: ['wave'] }),
    enemy('祭壇の影', { x: 0, y: 23 }, 'dark', 110, 8, 'wave', { role: 'guardian' }),
  ],
  // 双子の祭壇：左右対称の祭壇の間。光の仕切り壁が全幅を塞ぎ、双子の塔と中央祭壇が立つ。
  // 砕けぬ祭壇の芯柱（unbreakable）が左右に立ち、もろい祭具の囲い（fragile）が手前を彩る。
  obstacles: [
    wall(-18, 18, 5, 1, 'light'), // 聖なる仕切り壁（全幅を遮る）
    pillar(-13, -3, 5, 'dark'), // 左の塔（白の祭司側）
    pillar(13, -3, 5, 'dark'), // 右の塔（黒の祭司側）
    block(-2, -3, 3, 2, 'light'), // 中央の祭壇
    pillar(-7, 9, 2, 'neutral', 'unbreakable'), // 砕けぬ芯柱・左（#40：壊れない＝迂回するしかない）
    pillar(7, 9, 2, 'neutral', 'unbreakable'), // 砕けぬ芯柱・右
    wall(-9, -3, -17, 1, 'neutral', 'fragile'), // もろい祭具の囲い（#40：壊れやすい・味方の間を仕切る装飾）
  ],
  introText: [
    '左右対称の祭壇の間。光の仕切り壁が射線を全て遮り、双子の塔がそびえる。',
    '光の敵には闇（関数値を負に）、闇の敵には光（正に）が有効（×1.5）。壁は反対の理で速く削れる。',
    'ヒント：壁を削るか山越えで祭司へ届かせ、3人で弱点を突け。',
    'ヒント：黒く鈍く光る芯柱は砕けない（迂回せよ）。手前のもろい囲いは一撃で崩せる。',
  ],
  clearText: ['双子の祭司は均衡を崩し、砕け散った。', '光と闇の使い分けが板についてきた。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 4：螺旋の坑道 ― 柱だらけ
const stage4: Stage = {
  id: 'stage-4',
  name: '第四の間 ― 螺旋の坑道',
  enemies: [
    enemy('渦の番兵', { x: -14, y: 18 }, 'dark', 140, 8, 'spiral', { role: 'guardian' }),
    enemy('渦の番兵', { x: 14, y: 18 }, 'dark', 140, 8, 'spiral', { families: ['wave'] }),
    enemy('坑道の弓手', { x: 0, y: 23 }, 'light', 125, 9, 'wave', { families: ['arc'] }),
  ],
  // 螺旋の坑道：崩れた坑道。瓦礫の壁が全幅を塞ぎ、その上に光と闇の渦が巻く。
  obstacles: [
    wall(-18, 18, 1, 1, 'dark'), // 崩落した瓦礫の壁（全幅を遮る）
    spiralArm(0, 7, 8, 1.2, 0, 'light'), // 渦（光）
    spiralArm(0, 7, 8, 1.2, Math.PI, 'dark'), // 渦（闇）
  ],
  introText: [
    '崩れた坑道。瓦礫の壁が射線を塞ぎ、頭上では術式の渦が巻いている。',
    '放物線で山越えし、円の周回結界で渦を受け流そう。狙えば瓦礫を削り抜ける。',
    'ヒント：通った所は円形に削れて穴になる。削りながら速度が尽きると弾は止まる。',
  ],
  clearText: ['渦は鎮まり、坑道の奥に微かな光が差した。', '入り組んだ地形にも対応できるようになった。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 5：鏡の広間 ― 数で攻める＋大柱
const stage5: Stage = {
  id: 'stage-5',
  name: '第五の間 ― 鏡の広間',
  enemies: [
    enemy('鏡像の衛士', { x: -15, y: 18 }, 'light', 125, 8, 'line', { role: 'breaker' }),
    enemy('鏡像の衛士', { x: 15, y: 18 }, 'dark', 125, 8, 'line', { role: 'breaker' }),
    enemy('鏡像の射手', { x: -7, y: 23 }, 'dark', 120, 9, 'wave', { families: ['arc'] }),
    enemy('鏡像の射手', { x: 7, y: 23 }, 'light', 120, 9, 'wave', { families: ['arc'] }),
  ],
  // 鏡の広間：左右対称の列柱。左が光・右が闇の鏡像の柱が広間いっぱいに並ぶ。
  // 両端に割れない鏡枠（unbreakable）が立ち、広間の縁を縁取る（装飾兼遮蔽・#40）。
  obstacles: [
    ...colonnade(-18, 0, 3.6, -1, 4, ['light']), // 左半分（光）＝中央柱含む
    ...colonnade(3.6, 18, 3.6, -1, 4, ['dark']), // 右半分（闇・鏡像）
    pillar(-18, 8, 3, 'neutral', 'unbreakable'), // 割れない鏡枠・左
    pillar(18, 8, 3, 'neutral', 'unbreakable'), // 割れない鏡枠・右
  ],
  introText: [
    '左右対称の鏡の広間。光と闇の柱が鏡像のように並び、直線の射線を塞ぐ。',
    '無数の鏡像が一斉に術式を放つ。狙われた味方は周回結界で守り、他の2人で集中砲火を。',
    'ヒント：左の柱は闇で、右の柱は光で削ると速い。山越えも有効。',
  ],
  clearText: ['鏡像は一斉に砕け、乱れた反射が消えた。', '多対多の捌きを覚えた。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 6：封印の回廊 ― ボス前の精鋭＋分厚い壁
const stage6: Stage = {
  id: 'stage-6',
  name: '第六の間 ― 封印の回廊',
  enemies: [
    enemy('封印の番人', { x: 0, y: 23 }, 'light', 180, 9, 'wave', { castMag: 4, families: ['spiral'] }),
    enemy('回廊の番兵', { x: -14, y: 18 }, 'dark', 140, 8, 'spiral', { role: 'guardian' }),
    enemy('回廊の番兵', { x: 14, y: 18 }, 'dark', 140, 8, 'arc', { role: 'breaker' }),
  ],
  // 封印の回廊：回廊を完全に塞ぐ分厚い闇の封印壁（3段重ね・全幅）。光なら安く削り抜ける。
  // 中央に砕けぬ封印核（unbreakable）が埋め込まれ、正面は通れない＝両脇を削るか山越えで挑む。
  obstacles: [
    wall(-18, 18, 1, 3, 'dark'), // 分厚い封印壁
    block(-2, 1, 3, 2, 'neutral', 'unbreakable'), // 砕けぬ封印核（#40：壊れない＝正面突破不可）
    pillar(-17, -3, 2, 'light'), // 左の光の柱（取っ掛かり）
    pillar(17, -3, 2, 'light'), // 右の光の柱
  ],
  introText: [
    '核心を守る精鋭たち。強い光の番人が眷属を率い、分厚い闇の封印壁が回廊を完全に塞ぐ。',
    '直線では届かない。闇の壁は光（反対の理）で削れば安く貫ける。山越えで越えてもよい。',
    '壁の中央には砕けぬ封印核が埋まる。正面は通れない＝両脇を崩すか弧で越えよ。',
    'ヒント：暴発（関数エラー）は最大の光闇AoE。狙って当てる手もある。',
  ],
  clearText: ['精鋭は崩れ落ち、最奥への扉が開いた。', '守護者の気配が濃くなる。'],
  mechanics: { obstacles: true, enemyFire: true },
}

// 7：守護者ボス戦 ― 巨大な壁の奥のボス
const stage7: Stage = {
  id: 'stage-7',
  name: '第七の間 ― 守護者ボス戦',
  boss: true,
  enemies: [
    enemy('魔導書の守護者', { x: 0, y: 23 }, 'light', 380, 9, 'wave', {
      castMag: 5,
      hitboxRadius: 3.6,
      families: ['spiral'],
    }),
    enemy('守護者の眷属', { x: -15, y: 17 }, 'dark', 130, 8, 'spiral', { role: 'guardian' }),
    enemy('守護者の眷属', { x: 15, y: 17 }, 'dark', 130, 8, 'arc', { role: 'breaker' }),
  ],
  // 守護者の間：荘厳な大広間。列柱が全幅に並び、中央に守護者の巨大な盾（祭壇）がそびえる。
  obstacles: [
    ...colonnade(-18, 18, 3.6, -2, 5, ['light', 'dark']), // 大広間の列柱
    block(-4, -3, 4, 3, 'light'), // 中央＝守護者の盾（巨壁）
  ],
  introText: [
    '魔導書の核心を守る荘厳な大広間。列柱が射線を塞ぎ、中央に守護者の巨大な盾がそびえる。',
    '3人の術者の総力で、光と闇を操り壁を崩し守護者を打ち倒せ。直線では届かない。',
    'ヒント：眷属を先に処理し、結界で凌ぎつつ守護者へ反対の理を集中。',
  ],
  clearText: ['守護者は崩れ落ち、封印が完全に解けた。', '魔導書の核心が、静かに開かれていく。'],
  mechanics: { obstacles: true, enemyFire: true },
}

export const STAGES: Stage[] = [stage1, stage2, stage3, stage4, stage5, stage6, stage7]
