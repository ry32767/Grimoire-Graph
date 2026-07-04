// ステージ定義（機能14・#6・#15・06b 難易度フレームワーク）。
// LVL（1〜7・原則ステージ番号）で HP 倍率・castMag・使える family/z場/パターンを連動して解放する。
// castInitialSpeed は全敵・全LVLで 8 固定（速度差でなく関数の選び方・z場・タイミングで難度を作る）。
// 障害物は solids（重なった円の和＝連続したブロブ）＋rects（四角い壁・#56）。当たった点を円でえぐり取る。
//
// 【ステージのサイズ（場の広さ）】手描き仕様のスケッチに合わせ、面ごとに「サイズ」を持たせて
// 場の半径 rField をスケールで決める（第1面=小さめ25／最大＝第7面②=60。1面↔7面で約2.4倍）。
// 大アリーナでも弾が対岸へ届くよう、サンプリング上限（rotateXMax）は fieldR に追従する（coords.ts）。
// 描画・入力とも rField を基準に倍率が決まり、盤面はズーム/パンで見やすくできる（BattleCanvas）。
import type { Disc, Enemy, EnemyFamily, Obstacle, ObstacleKind, Rect, Stage, ZField } from '../game/types'
import { GAME } from './constants'

/** サイズ（スケッチの相対値）→ 場の半径 rField（第1面 size1=25 〜 最大 size4=60 の線形）。 */
function rFieldForSize(size: number): number {
  return Math.round(25 + ((size - 1) * 35) / 3)
}
// 参考: size 1→25, 1.5→31, 2→37, 2.5→43, 3→48, 3.5→54, 4→60

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
  /** 弾の初速の明示指定（既定 CAST_SPEED=8）。第6面の崩し手は遅め＝結界1枚で受かる調整（#63） */
  castInitialSpeed?: number
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
  /** 守護型：方向づけられた場（05b §5.4・#47・LVL4〜5） */
  directedAura?: boolean
  /** 種族（05c 図鑑・#46）。描画専用。ボスは未設定でよい */
  species?: Enemy['species']
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
    castInitialSpeed: opts.castInitialSpeed ?? CAST_SPEED,
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
    directedAura: opts.directedAura,
    species: opts.species,
    level, // ティア演出用（05c・描画専用）
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
/** 四角い壁（#56）：solids の代わりに矩形で素材を表す（角がシャープ）。 */
function obRect(element: Obstacle['element'], rects: Rect[], kind?: ObstacleKind): Obstacle {
  const base = { id: `o${oseq++}`, element, solids: [], rects, carves: [] }
  return kind ? { ...base, kind } : base
}
/** 縦の柱：(cx, y0) から上へ n 個の円を積んだブロブ */
function pillar(cx: number, y0: number, n: number, element: Obstacle['element'], kind?: ObstacleKind): Obstacle {
  return ob(
    element,
    Array.from({ length: n }, (_, i) => ({ x: cx, y: y0 + i * STEP, r: R })),
    kind,
  )
}
/** 矩形ブロック：左下 (x0, y0) から cols×rows ぶんを占める四角い壁（#56：角がシャープ）。 */
function block(
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  element: Obstacle['element'],
  kind?: ObstacleKind,
): Obstacle {
  // 旧・円敷き詰め（中心 x0..x0+(cols-1)STEP、半径 R）と同じ範囲を覆う矩形にする
  return obRect(
    element,
    [{ x: x0 - R, y: y0 - R, w: (cols - 1) * STEP + 2 * R, h: (rows - 1) * STEP + 2 * R }],
    kind,
  )
}
/**
 * 渦巻きの腕：(cx, cy) を中心にアルキメデス螺旋へ n 個並べたブロブ（位相 phase でずらす）。
 * r0 は開始半径（#64・第4面：味方の周りに結界を張る余白を空けるため中心から離す）。
 */
function spiralArm(
  cx: number,
  cy: number,
  n: number,
  turns: number,
  phase: number,
  element: Obstacle['element'],
  r0 = 2.5,
): Obstacle {
  return ob(
    element,
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * turns * Math.PI * 2 + phase
      const rad = r0 + 0.9 * t
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
  // 四角い壁（#56）：x0→x1・rows 段ぶんの厚みを持つシャープな矩形
  const step = R * 1.4
  return obRect(element, [{ x: x0 - R, y: y0 - R, w: x1 - x0 + 2 * R, h: (rows - 1) * step + 2 * R }], kind)
}
/**
 * 翼壁（#50・06b §5.6）：壁の帯の端 x0 から境界近くの x1 まで側面を塞ぐ unbreakable の壁。
 * 迂回型AIが帯の外側（境界ぎわ）を回り込んで壁を素通りするのを防ぐ。左右対称に置く。
 */
function wingWall(x0: number, x1: number, y0: number, rows: number): Obstacle {
  return wall(x0, x1, y0, rows, 'neutral', 'unbreakable')
}

/** リング（環状の壁）：中心 (cx,cy)・半径 radius に円ブロブを n 個円環状に並べる（第2面の中央リング）。 */
function ring(
  cx: number,
  cy: number,
  radius: number,
  element: Obstacle['element'],
  kind?: ObstacleKind,
  n = 14,
): Obstacle {
  return ob(
    element,
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2
      return { x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t), r: R }
    }),
    kind,
  )
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

// ===== 第1面 ― 門（LVL 1・サイズ1＝最小の場）：命中だけを学ぶ =====
const stage1: Stage = {
  id: 'stage-1',
  name: '第一の間 ― 門',
  rField: rFieldForSize(1), // 25：最小。縦長の門（狭い正対の間）
  allyPositions: [
    { x: -7, y: -14 }, // ミラ
    { x: 0, y: -16 }, // レン
    { x: 7, y: -14 }, // ソウ
  ],
  enemies: [enemy('石像の番人', { x: 0, y: 14 }, 'dark', 1, 'line', { hp: 90, species: 'proto' })],
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
  rField: rFieldForSize(1.5), // 31：サイズ1.5。矩形の部屋＋中央リング
  enemies: [
    // 亡霊魔術師 I（迂回型・05c §2）。family は abs/arc のみ（#46）
    enemy('回廊の衛士', { x: -11, y: 20 }, 'dark', 2, 'arc', { hp: 110, species: 'wraith' }),
    enemy('影の射手', { x: 11, y: 21 }, 'dark', 2, 'abs', { hp: 105, species: 'wraith' }),
  ],
  // 列柱（属性混在・射線を塞ぐ中央帯）＋中央にもろいリング（一撃で崩せる体験・06b §6）＋翼壁（#50）
  obstacles: [
    ...colonnade(-18, 18, 3.6, 2, 4, ['dark', 'light']),
    ring(0, -6, 3.5, 'neutral', 'fragile'), // もろい瓦礫のリング（fragile：一撃で大きく崩れる）
    wingWall(18, 29, 2, 4), // 翼壁・右（列柱の端から境界(rField=31)近くまで・#50）
    wingWall(-29, -18, 2, 4), // 翼壁・左
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
  rField: rFieldForSize(2), // 37：サイズ2。正方形の踊り場＋全幅の仕切り壁（戦闘は中央・広がりは余白）
  enemies: [
    // 鋼鬼 I（火力型・05c §1）。family は line/arc
    enemy('白の祭司', { x: -13, y: 19 }, 'light', 3, 'line', { families: ['arc'], role: 'breaker', hp: 130, species: 'oni' }),
    enemy('黒の祭司', { x: 13, y: 19 }, 'dark', 3, 'line', { families: ['arc'], role: 'breaker', hp: 130, species: 'oni' }),
    // 亡霊魔術師 II（迂回型・護衛）。family=abs（#46）
    enemy('祭壇の影', { x: 0, y: 23 }, 'dark', 2, 'abs', { hp: 110, species: 'wraith' }),
  ],
  // 全幅の normal 壁（2段に厚み増）＋左右の塔＋砕けぬ芯柱（迂回強制）＋もろい囲い＋翼壁（06b §6・#50）
  obstacles: [
    wall(-18, 18, 5, 2, 'light'), // 全幅の光の仕切り壁（2段：上下の回り込みも防ぐ）
    pillar(-13, -3, 5, 'dark'), // 左の塔
    pillar(13, -3, 5, 'dark'), // 右の塔
    pillar(-7, 9, 2, 'neutral', 'unbreakable'), // 砕けぬ芯柱・左（迂回強制）
    pillar(7, 9, 2, 'neutral', 'unbreakable'), // 砕けぬ芯柱・右
    wall(-9, -3, -17, 1, 'neutral', 'fragile'), // もろい祭具の囲い
    wingWall(20, 35, -14, 8), // 翼壁・右（障害物帯のy範囲を覆い、外縁を境界(rField=37)まで塞ぐ・#50）
    wingWall(-35, -20, -14, 8), // 翼壁・左
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
  rField: rFieldForSize(3), // 48：サイズ3。外周壁のない開けた円＋湾曲バリア＋包囲配置
  // 味方は中央寄せ（#64）：3人が1枚の結界（半径7前後）で囲える密集陣形。
  // このステージの学習テーマ「円を描いて結界を張り、仲間を守る」を実際に試せる配置にする。
  // 場が広くなっても密集度は保つ（半径7の結界に3人が収まる条件を維持）。
  allyPositions: [
    { x: -4.5, y: -11 }, // ミラ
    { x: 0, y: -14.5 }, // レン（ここから半径7の結界で3人を囲える）
    { x: 4.5, y: -11 }, // ソウ
  ],
  // 包囲構成（#49）：味方重心≈(0,-12) を軸に、敵を正面（上方）・左斜め後方・右斜め後方に配置
  enemies: [
    // ゴーレム I（守護型・基礎・闇オーラのみ）＝正面（上方）
    enemy('渦の番兵', { x: 0, y: 26 }, 'dark', 4, 'spiral', { role: 'guardian', hp: 140, species: 'golem' }),
    // 亡霊魔術師 II（迂回型）＝左斜め後方。family=abs/arc（#46）
    enemy('坑道の弓手', { x: -18, y: -22 }, 'light', 3, 'abs', { families: ['arc'], hp: 125, species: 'wraith' }),
    // 紅亡霊 I（暴発デモ・06b/04b）＝右斜め後方。低頻度・岩壁を狙って暴発を「見せる」個体。z 場は極（1/x型）
    // 前方の全幅壁が正面上方（y≈6）にあり、そこを狙って暴発を見せる（壁が届く距離に置く）。
    enemy('崩し手', { x: 18, y: -22 }, 'dark', 5, 'arc', {
      role: 'ruptor',
      ruptorTarget: 'obstacles',
      fireEvery: 2,
      fireOffset: 1, // 1ターン目から撃つ＝最低1回は必ず暴発を見せる
      species: 'redWraith',
    }),
  ],
  // 前方の全幅壁（番兵との間仕切り・維持）＋味方重心を軸にした光と闇の渦（湾曲バリア・06b §6）。
  // 渦は開始半径 16（#64）：味方から離し、半径7の結界を張っても素材に触れない余白を確保する
  // （結界は壁に触れると霧散するため、囲える空間が学習テーマの成立条件になる）。
  obstacles: [
    wall(-24, 24, 6, 1, 'dark'), // 崩落した瓦礫の壁（全幅・光で安く削れる）
    spiralArm(0, -13, 10, 1.3, 0, 'light', 16), // 渦（光）：味方重心 (0,-13) を軸に・外周へ
    spiralArm(0, -13, 10, 1.3, Math.PI, 'dark', 16), // 渦（闇）
  ],
  introText: [
    '螺旋を成す坑道。壁には光と闇の渦が逆向きに回っている。渦の番兵が防御の輪を張り、坑道の弓手が背後から射かけてくる。',
    '奥には、様子のおかしい番人が一体――崩し手。ひび割れた記号と赤い✕は、式をわざと破る「暴発」の予兆だ。',
    'ヒント：三人は渦の中心に固まっている。円を描いて結界を張れば、回り続けて弾を受け流し、三人まとめて守れる。',
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
  rField: rFieldForSize(3.5), // 54：サイズ3.5。深層の広間（戦闘は中央・広がりは余白／鏡像・中央核）
  enemies: [
    // 鋼鬼 II（火力型）。family=line/exp
    enemy('鏡像の衛士（光）', { x: -15, y: 18 }, 'light', 4, 'line', { families: ['exp'], role: 'breaker', hp: 125, species: 'oni' }),
    enemy('鏡像の衛士（闇）', { x: 15, y: 18 }, 'dark', 4, 'line', { families: ['exp'], role: 'breaker', hp: 125, species: 'oni' }),
    // 亡霊魔術師 III（迂回型・高難度：同極すり抜け）。family=abs/poly34（#46）
    enemy('鏡像の射手（闇）', { x: -7, y: 23 }, 'dark', 5, 'abs', {
      families: ['poly34'],
      slipThrough: true, // 高難度：結界と同極に合わせてすり抜ける
      castZField: sinCosZ(-1),
      hp: 120,
      species: 'wraith',
    }),
    enemy('鏡像の射手（光）', { x: 7, y: 23 }, 'light', 5, 'abs', {
      families: ['poly34'],
      slipThrough: true,
      castZField: sinCosZ(1),
      hp: 120,
      species: 'wraith',
    }),
    // ゴーレム II（守護型・中難度：方向づけられた場を初導入・単色）。LVL5 相当 HP
    enemy('鏡守のゴーレム', { x: 0, y: 26 }, 'light', 5, 'spiral', {
      role: 'guardian',
      directedAura: true, // 脅威方向に強度を偏らせる（#47・全周 |z|≤zRef）
      hp: 160,
      species: 'golem',
    }),
  ],
  // 鏡像の列柱（左＝光/右＝闇）＋中央の砕けぬ核＋割れない鏡枠＋翼壁（06b §6・#50）
  obstacles: [
    ...colonnade(-18, 0, 3.6, -1, 4, ['light']),
    ...colonnade(3.6, 18, 3.6, -1, 4, ['dark']),
    block(-3, 1, 3, 2, 'neutral', 'unbreakable'), // 中央の砕けぬ核（スケッチの中央円）
    pillar(-18, 8, 3, 'neutral', 'unbreakable'), // 割れない鏡枠・左
    pillar(18, 8, 3, 'neutral', 'unbreakable'), // 割れない鏡枠・右
    wingWall(21, 52, -1, 4), // 翼壁・右（鏡枠の外側から境界(rField=54)まで・#50）
    wingWall(-52, -21, -1, 4), // 翼壁・左
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
  rField: rFieldForSize(3), // 48：サイズ3。角丸の封印室（十字ではない）
  enemies: [
    // ゴーレム III（守護型・最上位：交互張り＋方向づけ併用）。HP180。
    // 前衛 (0,16) に置く（#63）：崩し手たちの盾。単純な連打（最寄り狙い）はまず番人を
    // 殴り続けることになり、その間に崩し手の暴発が膜の崩壊へ積み上がる。
    // 結界で暴発を止めてから番人を崩す（防御→攻撃）の手順が必要になる。
    enemy('封印の番人', { x: 0, y: 16 }, 'light', 6, 'spiral', {
      role: 'guardian',
      alternatingAura: true, // ターンごとに光⇔闇のオーラを張り替える
      directedAura: true, // 脅威方向に強度偏重（併用・#47）
      hp: 180,
      species: 'golem',
    }),
    // 紅亡霊 II（崩し手3体・誘発）。family を個体ごとに abs/arc/poly34 と変える（#46）。
    // 連打対策（#63）：封印帯の「前」＝開けた場所に放たれており、暴発弾は初手から味方の目前へ
    // 届く。予告✕を見て反対極の結界で受け止めれば暴発しない（学習テーマ）が、防御しない
    // 「全員おまかせ」連打は毎波の暴発 AoE（最大威力180）で全滅する。
    // - 属性は光2＋闇1：おまかせの反対極弾は「ひるみ」でなく DoT になり、ひるみロックで
    //   詠唱を止め続けることはできない（弾色を見極めて両極の結界で防ぐ動機づけ）。
    // - HP175：結界で受けながらであれば十分倒し切れる（時間制限はない）。
    // 位相（fireOffset）は「同じ極性の弾が同一ターンに2本重ならない」よう振り、
    // 初速は遅め（6.5）：反対極の結界1枚（迎撃減速 6.25＋極手前の自然減速）で1本ずつ確実に
    // 受け切れる＝正しい色の結界を張れば完封できる波状攻撃にする（#63）。
    enemy('崩し手・弧', { x: -16, y: -3 }, 'light', 6, 'arc', { role: 'ruptor', fireEvery: 2, fireOffset: 1, hp: 175, castInitialSpeed: 6.5, species: 'redWraith' }),
    enemy('崩し手・折れ', { x: 16, y: -3 }, 'dark', 6, 'abs', { role: 'ruptor', fireEvery: 2, fireOffset: 0, hp: 175, castInitialSpeed: 6.5, species: 'redWraith' }),
    enemy('崩し手・捻れ', { x: 0, y: -7 }, 'light', 6, 'poly34', { role: 'ruptor', fireEvery: 2, fireOffset: 0, hp: 175, castInitialSpeed: 6.5, species: 'redWraith' }),
  ],
  // 角丸の封印室：左右の封印壁＋中央回廊＋砕けぬ封印核＋取っ掛かりの光柱＋翼壁（06b §6・#50・#63）
  obstacles: [
    // 硬い封印壁（3段・tough・#63）：左右2枚に割り、中央に回廊を開ける。
    // 崩し手の暴発弾は回廊を曲線で通って味方の目前まで届く＝予告✕を見て反対極の結界で
    // 受け止める（このステージの学習テーマ）が機能する。防御しない連打は暴発 AoE で全滅する。
    // tough なので術の削りでは容易に広がらない（回廊での攻防が主軸になる）。
    wall(-24, -13, 1, 3, 'neutral', 'tough'),
    wall(15, 24, 1, 3, 'neutral', 'tough'),
    block(-4, 1, 4, 2, 'neutral', 'unbreakable'), // 砕けぬ封印核（正面突破不可・番人の盾）
    pillar(-23, -4, 2, 'light'), // 左の光柱
    pillar(23, -4, 2, 'light'), // 右の光柱
    // 翼壁は封印壁の端と重なるまで寄せる（#63：横抜けを封じ、突破手段を tough 壁の掘削 or 暴発に一本化）
    wingWall(25, 46, -8, 6), // 翼壁・右（境界(rField=48)近くまで・#50）
    wingWall(-46, -25, -8, 6), // 翼壁・左
  ],
  introText: [
    '左右に聳える封印壁と、中央の砕けぬ封印核。その奥に封印の番人が控え、封印帯の前へ――様子のおかしい崩し手が、三体放たれている。',
    '崩し手の弾は光か闇をまとい、狙う相手の目前で暴発する。着弾する前に、反対の理の結界で受け止めれば暴発しない。予兆の✕印と弾の色をよく見ること。',
    'ヒント：結界は暴発の予兆（✕）まで覆う大きさで張れ。同じ極の結界は素通りされる。封印壁は硬く術では削りにくい――番人へは核の脇の回廊を曲線で通すか、切り札（暴発）で壁ごと吹き飛ばせ。',
  ],
  clearText: [
    '崩れかけた封印帯を抜け、その奥に大広間への扉が開く。冷たい風が、三人の頬を撫でた。',
    '封印は、閉じ込めるためでも守るためでもなく――もう二度と、あれを起こさないためだったのかもしれない。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第7面 ― 大広間（LVL 7・ボス戦・HPフェーズ制／#45） =====
// ①矩形の間（サイズ2.5＝42）→ 床崩落 → ②開けた大円（サイズ4＝60・最大の場）。
// スケッチの「①→②→③（②のまま）→④（HP0でボスだけ）」に対応：場は縮小ではなく拡大する。
// ②の大円は開けていて隠れ場所が少ない（短い壁のみ）。最下層/断末魔でボス単独になる。
const openArena = () => [wall(-16, -4, -3, 1, 'dark'), wall(4, 16, -3, 1, 'light')]
const stage7: Stage = {
  id: 'stage-7',
  name: '第七の間 ― 大広間',
  boss: true,
  rField: rFieldForSize(2.5), // 43：①矩形の間。フェーズで拡大（②③④＝60）
  enemies: [
    // 多重詠唱（#44）：火力型枠 line/arc/exp・迂回型枠 abs/arc/poly34 を弾ごとに独立選択（#46）。families に集約
    enemy('魔導書の守護者', { x: 0, y: 26 }, 'light', 7, 'abs', {
      hp: 380,
      hitboxRadius: 3.6,
      families: ['line', 'arc', 'exp', 'poly34'],
      boss: true,
      castCount: 2,
      patternPool: ['breaker', 'attacker'],
    }),
    // 亡霊魔術師 IV（眷属・迂回型・高難度）。family=abs/poly34（#46）
    enemy('守護者の眷属（迂回）', { x: -18, y: 20 }, 'dark', 6, 'abs', {
      hp: 130,
      families: ['poly34'],
      slipThrough: true,
      castZField: sinCosZ(-1),
      species: 'wraith',
    }),
    // 鋼鬼 III（眷属・火力型）。family=line/arc
    enemy('守護者の眷属（火力）', { x: 18, y: 20 }, 'light', 6, 'line', {
      hp: 130,
      families: ['arc'],
      role: 'breaker',
      species: 'oni',
    }),
  ],
  // ①上層（矩形の間）：列柱＋守護者の盾＋翼壁（隠れる場所が多い・#50）
  obstacles: [
    ...colonnade(-22, 22, 4, -2, 5, ['light', 'dark']),
    block(-5, -4, 4, 3, 'light'), // 守護者の盾（normal）
    wingWall(22, 41, -5, 7), // 翼壁・右（列柱のy範囲を覆い、外縁を境界(rField=43)まで塞ぐ・#50）
    wingWall(-41, -22, -5, 7), // 翼壁・左
  ],
  // HPフェーズ（#45）：66%/33% で床が崩れ、②開けた大円へ。rField は 42→60 と拡大する（#49・スケッチ）。
  // ②③は同じ大円（開けた短い壁のみ）。最下層（33%以下・断末魔前）はボス単独＝眷属を間引き・3同時発射。
  bossPhases: [
    { hpBelow: 0.66, castCount: 2, obstacles: openArena(), rField: 60 },
    { hpBelow: 0.33, castCount: 3, obstacles: [], cullMinions: true, rField: 60 },
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
