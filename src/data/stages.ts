// ステージ定義（機能14・#6・#15・06b 難易度フレームワーク）。スケール1.5倍（場 r=30）。
// LVL（1〜7・原則ステージ番号）で HP 倍率・castMag・使える family/z場/パターンを連動して解放する。
// castInitialSpeed は全敵・全LVLで 8 固定（速度差でなく関数の選び方・z場・タイミングで難度を作る）。
// 障害物は solids（重なった円の和＝連続したブロブ）。当たった点を円でえぐり取り滑らかな穴が開く。
import type { Disc, Enemy, EnemyFamily, Obstacle, ObstacleKind, Stage, ZField } from '../game/types'
import { GAME } from './constants'

/** LVL → 数値スケール（06b §2）。HP倍率は基礎100を1.0とした目安、castMag は z 強度。 */
const LVL_SCALE: Record<number, { hp: number; mag: number }> = {
  1: { hp: 1.0, mag: 3 },
  2: { hp: 1.15, mag: 3 },
  3: { hp: 1.3, mag: 3.5 },
  4: { hp: 1.5, mag: 3.5 },
  5: { hp: 1.65, mag: 4 },
  6: { hp: 1.85, mag: 4.5 },
  7: { hp: 2.0, mag: 5 },
}

/** 全敵共通の初速（06b §2：LVLで変化させない） */
const CAST_SPEED = 8

/** 敵の追加設定（#28/#42/#44/05b） */
interface EnemyOpts {
  /** 得意関数を複数持つ（family と合わせて・中盤以降） */
  families?: EnemyFamily[]
  /** 戦い方（attacker=迂回型/breaker=火力型/guardian=守護型/ruptor=暴発型）。未指定は attacker */
  role?: Enemy['role']
  /** HP の明示指定（LVL 倍率より優先。ボス等） */
  hp?: number
  castMag?: number
  hitboxRadius?: number
  /** 敵弾の z 場（sin/cos 等・05b §3）。(mag) を受けて ZField を返す */
  castZField?: (mag: number) => ZField
  /** 崩し手の狙い先（'obstacles'＝第4面デモ用） */
  ruptorTarget?: Enemy['ruptorTarget']
  /** 発射頻度（暴発型=2 が既定の使い方）と位相 */
  fireEvery?: number
  fireOffset?: number
  /** 多重詠唱（#44・ボス用） */
  castCount?: number
  patternPool?: Enemy['patternPool']
  boss?: boolean
  /** 迂回型高難度：同極すり抜け（05b §5.2） */
  slipThrough?: boolean
  /** 守護型高難度：交互張り（05b §5.4） */
  alternatingAura?: boolean
}

let seq = 0
/** 敵ファクトリ：LVL から HP・castMag を決める（06b §2）。基礎 HP=100 × LVL倍率。 */
function enemy(
  name: string,
  pos: { x: number; y: number },
  element: Enemy['element'],
  level: number,
  family: EnemyFamily = 'line',
  opts: EnemyOpts = {},
): Enemy {
  const scale = LVL_SCALE[level] ?? LVL_SCALE[7]
  const castMag = opts.castMag ?? scale.mag
  const castZ = element === 'light' ? castMag : element === 'dark' ? -castMag : 0
  return {
    id: `e${seq++}`,
    name,
    pos,
    hp: opts.hp ?? Math.round(100 * scale.hp),
    maxHp: opts.hp ?? Math.round(100 * scale.hp),
    element,
    hitboxRadius: opts.hitboxRadius ?? GAME.enemyHitbox,
    statuses: [],
    family,
    families: opts.families,
    role: opts.role,
    castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
    castInitialSpeed: CAST_SPEED,
    castZ,
    castZField: opts.castZField?.(castMag),
    ruptorTarget: opts.ruptorTarget,
    fireEvery: opts.fireEvery,
    fireOffset: opts.fireOffset,
    castCount: opts.castCount,
    patternPool: opts.patternPool,
    boss: opts.boss,
    slipThrough: opts.slipThrough,
    alternatingAura: opts.alternatingAura,
  }
}

/** sin/cos の z 場（05b §3：場所によって強弱・時に属性まで反転する）。sign=基調の極性 */
const sinCosZ =
  (sign: 1 | -1) =>
  (mag: number): ZField =>
  (x: number, y: number) =>
    sign * mag * Math.sin(0.28 * x + 0.22 * y + 1.2)

// 障害物は solids（重なった円の和＝連続したブロブ）で構成し、ステージのテーマに合わせて配置する。
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
/** 横一列に連続する壁（円を overlap させて x0→x1 を切れ目なく覆う）。rows 段重ね。 */
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
/** 列柱：x0→x1 を step 間隔で、各柱は縦 n 段のブロブ。elems を順に割り当てて光闇を交互にできる。 */
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

// ===== 第1面 ― 門（LVL 1）：命中だけを学ぶ =====
const stage1: Stage = {
  id: 'stage-1',
  name: '第一の間 ― 門',
  enemies: [enemy('石像の番人', { x: 0, y: 19 }, 'dark', 1, 'line', { hp: 90 })],
  obstacles: [],
  introText: [
    '苔むした門をくぐると、円形の広間。中央で、古びた石像の番人がゆっくりと目を開ける。',
    'まずは狙いを定めて当てるだけでいい。当てる瞬間に式を強く帯びさせるほど、一撃は深く斬り込む。',
    'ヒント：z 場の |z| が 5 に近いほど強い。ただし |z| が 2.5 を超えると弾は減速する。',
  ],
  clearText: [
    '石像は静かにひび割れ、光の粒となって崩れた。奥に、下りの通路が口を開けている。',
    'ここから先は、釣り合いが崩れている。',
  ],
  mechanics: { obstacles: false, enemyFire: false },
}

// ===== 第2面 ― 通路（LVL 2）：障害物と反撃。fragile で「壊せる」を学ぶ =====
const stage2: Stage = {
  id: 'stage-2',
  name: '第二の間 ― 通路',
  enemies: [
    enemy('回廊の衛士', { x: -12, y: 19 }, 'dark', 2, 'arc'),
    enemy('影の射手', { x: 12, y: 20 }, 'dark', 2, 'wave'),
  ],
  // 列柱（属性混在）＋中央にもろい瓦礫（一撃で崩せる体験・06b §6）
  obstacles: [
    ...colonnade(-18, 18, 3.6, -1, 4, ['dark', 'light']),
    wall(-6, 6, -1, 1, 'neutral', 'fragile'), // もろい瓦礫（fragile：一撃で大きく崩れる）
  ],
  introText: [
    'ゆるやかに下る回廊。柱が密に連なって、まっすぐな道を塞ぐ。回廊の衛士と影の射手が、闇の弾を撃ってくる。',
    '直線は柱に阻まれる。山なりに越えるか、撃って穴を開けるか――道筋は曲げられる。壁は対立する理に弱く、狙えば崩せる。',
    'ヒント：中央の白っぽい瓦礫はもろく、一撃で大きく崩せる。',
  ],
  clearText: [
    '削れた柱の隙間を抜け、最後の一撃が衛士を貫いた。通路はさらに下へと続く。',
    '刻印の言う“深さ”が、まだ意味を結ばない。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第3面 ― 踊り場（LVL 3）：相性と normal 壁。火力型の初登場 =====
const stage3: Stage = {
  id: 'stage-3',
  name: '第三の間 ― 踊り場',
  enemies: [
    enemy('白の祭司', { x: -13, y: 19 }, 'light', 3, 'line', { families: ['arc'], role: 'breaker' }),
    enemy('黒の祭司', { x: 13, y: 19 }, 'dark', 3, 'line', { families: ['arc'], role: 'breaker' }),
    enemy('祭壇の影', { x: 0, y: 23 }, 'dark', 2, 'wave'),
  ],
  // 全幅の normal 壁＋左右の塔＋砕けぬ芯柱（迂回強制）＋もろい囲い（06b §6）
  obstacles: [
    wall(-18, 18, 5, 1, 'light'), // 全幅の光の仕切り壁（闇で安く削れる）
    pillar(-13, -3, 5, 'dark'), // 左の塔
    pillar(13, -3, 5, 'dark'), // 右の塔
    pillar(-7, 9, 2, 'neutral', 'unbreakable'), // 砕けぬ芯柱・左（迂回強制）
    pillar(7, 9, 2, 'neutral', 'unbreakable'), // 砕けぬ芯柱・右
    wall(-9, -3, -17, 1, 'neutral', 'fragile'), // もろい祭具の囲い
  ],
  introText: [
    '階段の途中、広い踊り場に、白と黒の双子の祭壇。白の祭司は光を、黒の祭司は闇をまとい、その奥に祭壇の影が控える。',
    '光の相手には闇を、闇の相手には光を――反対の理が有効だ（×1.5）。壁も反対の理で速く削れる。',
    '祭司は壁を破ってでも押し通ってくる（火力型）。中央に立つ砕けぬ芯柱は、避けて通るしかない。',
  ],
  clearText: [
    '双子の祭司が同時に膝をつく。釣り合いが、わずかに戻った気がした。',
    '刻印の“深く触れると引かれる”という言葉が、術の失速と重なって、ふと胸に残る。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第4面 ― 螺旋（LVL 4）：守護型（基礎）の初登場＋暴発の提示（デモ1体） =====
const stage4: Stage = {
  id: 'stage-4',
  name: '第四の間 ― 螺旋',
  enemies: [
    enemy('渦の番兵', { x: -14, y: 18 }, 'dark', 4, 'spiral', { role: 'guardian' }), // 基礎：闇オーラのみ
    enemy('坑道の弓手', { x: 0, y: 23 }, 'light', 3, 'spiral', { families: ['arc'] }),
    // 暴発デモ（06b/04b）：低頻度・岩壁を狙って暴発を「見せる」個体。z 場は極（1/x型）
    enemy('崩し手', { x: 14, y: 18 }, 'dark', 5, 'wave', {
      role: 'ruptor',
      ruptorTarget: 'obstacles',
      fireEvery: 2,
      fireOffset: 1, // 1ターン目から撃つ＝最低1回は必ず暴発を見せる
    }),
  ],
  // 全幅の瓦礫壁＋光と闇の渦（06b §6）
  obstacles: [
    wall(-18, 18, 1, 1, 'dark'), // 崩落した瓦礫の壁（全幅・光で安く削れる）
    spiralArm(0, 7, 8, 1.2, 0, 'light'), // 渦（光）
    spiralArm(0, 7, 8, 1.2, Math.PI, 'dark'), // 渦（闇）
  ],
  introText: [
    '螺旋を成す坑道。壁には光と闇の渦が逆向きに回っている。渦の番兵が防御の輪を張り、坑道の弓手が頭上から射かけてくる。',
    '奥には、様子のおかしい番人が一体――崩し手。ひび割れた記号と赤い✕は、式をわざと破る「暴発」の予兆だ。',
    'ヒント：円を描いて結界を張れば、回り続けて弾を受け流し、内側の仲間を守れる。',
  ],
  clearText: [
    '渦がほどけ、番兵の輪が霧散する。螺旋はなおも下へ。崩し手の暴発の残響が、まだ床を震わせている。',
    '降りるほどに、上でも下でもないどこかからの視線が、近くなっていく。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第5面 ― 深層の広間（LVL 5）：数で攻める。鏡像＋同極すり抜けの初登場 =====
const stage5: Stage = {
  id: 'stage-5',
  name: '第五の間 ― 深層の広間',
  enemies: [
    enemy('鏡像の衛士（光）', { x: -15, y: 18 }, 'light', 4, 'line', { families: ['exp'], role: 'breaker' }),
    enemy('鏡像の衛士（闇）', { x: 15, y: 18 }, 'dark', 4, 'line', { families: ['exp'], role: 'breaker' }),
    enemy('鏡像の射手（闇）', { x: -7, y: 23 }, 'dark', 5, 'wave', {
      families: ['poly34'],
      slipThrough: true, // 高難度：結界と同極に合わせてすり抜ける
      castZField: sinCosZ(-1),
    }),
    enemy('鏡像の射手（光）', { x: 7, y: 23 }, 'light', 5, 'wave', {
      families: ['poly34'],
      slipThrough: true,
      castZField: sinCosZ(1),
    }),
  ],
  // 鏡像の列柱（左＝光/右＝闇）＋割れない鏡枠（06b §6）
  obstacles: [
    ...colonnade(-18, 0, 3.6, -1, 4, ['light']),
    ...colonnade(3.6, 18, 3.6, -1, 4, ['dark']),
    pillar(-18, 8, 3, 'neutral', 'unbreakable'), // 割れない鏡枠・左
    pillar(18, 8, 3, 'neutral', 'unbreakable'), // 割れない鏡枠・右
  ],
  introText: [
    '磨かれた深層の広間。左半分は光、右半分は闇――自分たちを映したような鏡像の衛士と射手が、四方から迫る。',
    '狙われた者は結界で守り、残る二人で一体ずつ落とす。散らばれば、数に呑まれる。',
    '注意：鏡像の射手は結界の理を読み、同じ極に合わせてすり抜けてくる。',
  ],
  clearText: [
    '最後の鏡像が砕け、広間が静まり返る。鏡の中の自分は、もういない。',
    '封印の回廊が近い。守護者は、すぐそこだ。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第6面 ― 封印帯（LVL 6・初回崩壊）：暴発の誘発。崩し手3体＋交互張りの守護型 =====
const stage6: Stage = {
  id: 'stage-6',
  name: '第六の間 ― 封印帯',
  enemies: [
    // 高難度守護型：交互張り（ターンごとに光⇔闇のオーラを張り替える）
    enemy('封印の番人', { x: 0, y: 23 }, 'light', 6, 'wave', { role: 'guardian', alternatingAura: true }),
    // 崩し手3体（04b §4b.4b：結界で防がなければ instability が確実に積む）。family と位相を変えて撃たせる
    enemy('崩し手・弧', { x: -13, y: 19 }, 'dark', 6, 'arc', { role: 'ruptor', fireEvery: 2, fireOffset: 1 }),
    enemy('崩し手・波', { x: 13, y: 19 }, 'light', 6, 'wave', { role: 'ruptor', fireEvery: 2, fireOffset: 0 }),
    enemy('崩し手・捻れ', { x: 0, y: 16 }, 'dark', 6, 'poly34', { role: 'ruptor', fireEvery: 2, fireOffset: 1 }),
  ],
  // 3段重ねの封印壁＋砕けぬ封印核＋取っ掛かりの光柱（06b §6）
  obstacles: [
    wall(-18, 18, 1, 3, 'dark'), // 分厚い封印壁（3段・光で崩せる）
    block(-2, 1, 3, 2, 'neutral', 'unbreakable'), // 砕けぬ封印核（正面突破不可）
    pillar(-17, -3, 2, 'light'), // 左の光柱
    pillar(17, -3, 2, 'light'), // 右の光柱
  ],
  introText: [
    '三段重ねの封印壁が回廊を塞ぎ、中央には決して砕けぬ封印核。封印の番人と、様子のおかしい崩し手が三体。',
    '頭上に、いくつもの綻びの予兆が揺れている。崩し手の弾は光か闇をまとう――着弾する前に、反対の理の結界で受け止めれば暴発しない。',
    'ヒント：弾の色を見極めて結界で防げ。同じ極の結界は素通りされる。闇の封印壁は光で崩せる。',
  ],
  clearText: [
    '崩れかけた封印帯を抜け、その奥に大広間への扉が開く。冷たい風が、三人の頬を撫でた。',
    '封印は、閉じ込めるためでも守るためでもなく――もう二度と、あれを起こさないためだったのかもしれない。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第7面 ― 大広間（LVL 7・ボス戦・HPフェーズ制／#45） =====
// 中層アリーナ：柱は崩れて減り、短い normal 壁のみ（開けていて被弾しやすいが軌道は自由）
const midArena = () => [wall(-10, 10, -1, 1, 'dark')]
const stage7: Stage = {
  id: 'stage-7',
  name: '第七の間 ― 大広間',
  boss: true,
  enemies: [
    // 多重詠唱（#44）：火力型/迂回型のプールから2本（フェーズ3で3本）を独立に計画して同時発射
    enemy('魔導書の守護者', { x: 0, y: 23 }, 'light', 7, 'wave', {
      hp: 380,
      hitboxRadius: 3.6,
      families: ['line', 'arc', 'exp', 'poly34'],
      boss: true,
      castCount: 2,
      patternPool: ['breaker', 'attacker'],
    }),
    enemy('守護者の眷属（迂回）', { x: -15, y: 17 }, 'dark', 6, 'spiral', {
      hp: 130,
      families: ['poly34'],
      slipThrough: true,
      castZField: sinCosZ(-1),
    }),
    enemy('守護者の眷属（火力）', { x: 15, y: 17 }, 'light', 6, 'line', {
      hp: 130,
      families: ['arc'],
      role: 'breaker',
    }),
  ],
  // 上層：列柱＋守護者の盾（広く、隠れる場所が多い）
  obstacles: [
    ...colonnade(-18, 18, 3.6, -2, 5, ['light', 'dark']),
    block(-4, -3, 4, 3, 'light'), // 守護者の盾（normal）
  ],
  // HPフェーズ（#45）：66%/33% で床が崩れ、下の階層へ。最下層は障害物なし・ボス単独・3同時発射
  bossPhases: [
    { hpBelow: 0.66, castCount: 2, obstacles: midArena() },
    { hpBelow: 0.33, castCount: 3, obstacles: [], cullMinions: true },
  ],
  introText: [
    '遺跡の最も深い大広間。列柱と巨大な盾。その中心に――古代式の魔導書を守る、守護者が浮かんでいた。両脇に二体の眷属を従えて。',
    '守護者は一度に幾つもの式を同時に放つ。傷が深まるほど床が崩れ、三人と守護者ごと下の階層へ落ちていく。',
    '光に傾く者か、闇に堕ちる者か。三人はどちらでもないと応じ、対詠が始まる。',
  ],
  clearText: [
    '守護者の盾が砕け、巨体が静かに崩れていく。傾き続けた天秤が、ぴたりと水平で止まった。',
    '三つの理が、一つの均衡をなす。守護者は静かに軸をほどきながら、最後に一つだけ、言葉のように残した。開くとは、傾きうるということだ、と。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

export const STAGES: Stage[] = [stage1, stage2, stage3, stage4, stage5, stage6, stage7]
