// ステージ定義（機能14・#6・#15・06b 難易度フレームワーク・#69 で5面構成へ再設計）。
// LVL（1〜7）で HP 倍率・castMag・使える family/z場/パターンを連動して解放する。
// castInitialSpeed は全敵・全LVLで 8 固定（速度差でなく関数の選び方・z場・タイミングで難度を作る）。
// 障害物は solids（重なった円の和＝連続したブロブ）＋rects（四角い壁・#56）。当たった点を円でえぐり取る。
//
// 【#69 の設計方針】
// - 想定プレイ時間 15〜30 分に合わせ、7面 → **5面**へ集約する（1面＝1つの学習テーマ）。
// - 地形は「RPG のダンジョンの部屋」に寄せる：部屋の壁＋**等間隔の柱**＋**壊れた建造物**＋瓦礫。
// - **第1面以外は、味方から敵へ直線が通らない**（全味方 × 全敵で遮蔽が挟まる）。
//   ＝どの面でも「曲げるか、削るか」を必ず考える。stages.test.ts で機械的に固定する。
// - 味方は面ごとに**大きく散開**させる（横一列の密集をやめ、前後にもずらす）。
//   3人が別々の射線・別々の遮蔽を持ち、誰を守り誰で攻めるかの選択が生まれる。
// - 敵配置の原則：**迂回型は遮蔽の陰**（曲射だけが届く）、**火力型は守護型の結界の内側**
//   （守られながら壁を割る）、**守護型は前衛**、**暴発型は半身を隠す**。
//
// 【ステージのサイズ（場の広さ）】面ごとに「サイズ」を持たせて場の半径 rField をスケールで決める。
// 大アリーナでも弾が対岸へ届くよう、サンプリング上限（rotateXMax）は fieldR に追従する（coords.ts）。
import type { Stage } from '../game/types'
import {
  block,
  brokenColonnade,
  brokenTower,
  chamber,
  disc,
  enemy,
  pillarGrid,
  rFieldForSize,
  roomWalls,
  ruinedWall,
  rubble,
  sinCosZ,
  wall,
} from './stageBuilders'

// ===== 第1面 ― 門（LVL 1・サイズ1＝最小の場）：命中だけを学ぶ =====
// ここだけは遮蔽なし（mechanics.obstacles=false）。まっすぐ当てる感覚を掴む面。
const stage1: Stage = {
  id: 'stage-1',
  name: '第一の間 ― 門',
  rField: rFieldForSize(1), // 25：最小。縦長の門（狭い正対の間）
  // 3人はゆるやかに散開（前後にもずらす）。障害物が無いので射線はどこからでも通る
  allyPositions: [
    { x: -10, y: -16 }, // ミラ
    { x: 0, y: -19 }, // レン
    { x: 10, y: -14 }, // ソウ
  ],
  enemies: [enemy('石像の番人', { x: 0, y: 15 }, 'dark', 1, 'line', { hp: 90, species: 'proto' })],
  // 四方を壁で囲った縦長の部屋。mechanics.obstacles=false なので当たり判定は無く
  // 装飾（部屋の枠）として描かれる＝命中だけを学ぶチュートリアルの体験は変わらない。
  obstacles: roomWalls(-11, 11, -20, 20, rFieldForSize(1)),
  introText: [
    '苔むした円形の広間。中央で、古びた石像の番人がゆっくりと目を開ける。',
    '当てる瞬間に式を強く帯びさせるほど、一撃は深く斬り込む。ヒント：z 場の |z| が 5 に近いほど強いが、2.5 を超えると弾は減速する。',
  ],
  clearText: [
    '石像は静かにひび割れ、光の粒となって崩れた。奥に、下りの通路が口を開けている。',
    'ここから先は、釣り合いが崩れている。',
  ],
  mechanics: { obstacles: false, enemyFire: false },
}

// ===== 第2面 ― 崩れた回廊（LVL 2〜3）：遮蔽・相性・迂回をまとめて学ぶ =====
// 旧・第2面（通路）と第3面（踊り場）を統合した面。等間隔の柱列と崩落した大壁で
// 直線を完全に断ち、「山なりに越える」か「反対の理で削る」かを必ず選ばせる。
const S2_R = rFieldForSize(2) // 37
const stage2: Stage = {
  id: 'stage-2',
  name: '第二の間 ― 崩れた回廊',
  rField: S2_R,
  // 散開：左は柱列の裏、中央は最も奥、右は瓦礫寄り。三者三様の射線になる
  allyPositions: [
    { x: -19, y: -25 }, // ミラ
    { x: 1, y: -30 }, // レン
    { x: 18, y: -22 }, // ソウ
  ],
  enemies: [
    // 亡霊魔術師 I（迂回型・05c §2）。family は abs/arc のみ（#46）。崩れた塔の陰に立つ
    enemy('回廊の衛士', { x: -17, y: 15.5 }, 'dark', 2, 'arc', { hp: 110, species: 'wraith' }),
    enemy('影の射手', { x: 17, y: 15.5 }, 'dark', 2, 'abs', { hp: 105, species: 'wraith' }),
    // 鋼鬼 I（火力型・05c §1）：大壁を割って正面から来る。守護型はまだ居ない面
    enemy('石喰いの鬼', { x: 0, y: 21 }, 'light', 3, 'line', {
      families: ['arc'],
      role: 'breaker',
      hp: 130,
      species: 'oni',
    }),
  ],
  obstacles: [
    ...chamber(-25, 25, -33, 33, S2_R),
    // 崩落した大壁（教材：反対の理で速く削れる normal）。開口は左右2か所だが、
    // どの味方からもその開口を通して敵へ直線は通らない位置に置く
    ruinedWall(-25, 25, 1, 2, 'light', undefined, {
      gaps: [
        { center: -6.5, width: 4.5 },
        { center: 6.5, width: 4.5 },
      ],
    }),
    // 等間隔の柱（RPG の回廊）：大壁の手前に一列。崩落口の真下に柱が来るので、
    // 開口を狙った直線は必ず柱に当たる。柱と柱の間（幅 7.2）は曲げれば無傷で抜けられる
    ...pillarGrid({
      x0: -18,
      x1: 18,
      nx: 4,
      y0: -13,
      y1: -13,
      ny: 1,
      element: (ix) => (ix % 2 === 0 ? 'dark' : 'light'),
      kind: 'tough',
    }),
    // 崩れた塔（衛士・射手のカバー）：曲射は回り込むが直射は通らない
    ...brokenTower(-17, 4, 9, 9, 'dark', 'tough', { tallSide: 'right', seed: 11 }),
    ...brokenTower(17, 4, 9, 9, 'light', 'tough', { tallSide: 'left', seed: 12 }),
    rubble(-3, -20, 6, 6, 'neutral', 'fragile', 21), // 崩れ落ちた天井の瓦礫（もろい）
    rubble(12, -8, 5, 5, 'neutral', 'fragile', 22),
  ],
  introText: [
    '崩れかけた回廊。等間隔に並ぶ柱の奥で、回廊の衛士と影の射手が塔の残骸に身を隠している。中央の大壁を割りながら、石喰いの鬼が近づいてくる。',
    'まっすぐ撃っても柱と壁に阻まれる――山なりに越えるか、撃って崩すか。壁は反対の理に弱く（×1.5）、白っぽい瓦礫はもろい。',
  ],
  clearText: [
    '削れた柱の隙間を抜け、最後の一撃が衛士を貫いた。回廊はさらに下へと続く。',
    '刻印の言う“深さ”が、まだ意味を結ばない。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第3面 ― 列柱の広間（LVL 4〜5）：守護型と火力型の連携／結界で守る =====
// 旧・第4面（螺旋）と第5面（深層の広間）を統合。等間隔の列柱が千鳥に二列並び、
// 守護型の結界の内側に火力型が２体（＝守られながら壁を割る）、迂回型は塔の陰から曲射する。
const S3_R = rFieldForSize(3) // 48
const stage3: Stage = {
  id: 'stage-3',
  name: '第三の間 ― 列柱の広間',
  rField: S3_R,
  // 大きく散開（横 50・前後 8 のばらつき）。誰か一人が狙われる形になりやすい
  allyPositions: [
    { x: -26, y: -31 }, // ミラ
    { x: 2, y: -37 }, // レン
    { x: 25, y: -29 }, // ソウ
  ],
  enemies: [
    // ゴーレム II（守護型・方向づけられた場）＝前衛。結界で自分と両脇の鋼鬼を覆う
    enemy('広間の番兵', { x: 0, y: 17 }, 'light', 5, 'spiral', {
      role: 'guardian',
      directedAura: true, // 脅威方向に強度を偏らせる（#47・全周 |z|≤zRef）
      hp: 160,
      species: 'golem',
    }),
    // 鋼鬼 II（火力型）×2：守護型の結界（半径7）の内側に入る位置（距離5）＝守られながら壁を割る
    enemy('鋼鬼（白）', { x: -4, y: 20 }, 'light', 4, 'line', {
      families: ['exp'],
      role: 'breaker',
      hp: 125,
      species: 'oni',
    }),
    enemy('鋼鬼（黒）', { x: 4, y: 20 }, 'dark', 4, 'line', {
      families: ['exp'],
      role: 'breaker',
      hp: 125,
      species: 'oni',
    }),
    // 亡霊魔術師 III（迂回型・高難度：同極すり抜け）＝壊れた塔の陰。曲射だけが味方へ届く
    enemy('広間の射手', { x: -25, y: 13 }, 'dark', 5, 'abs', {
      families: ['poly34'],
      slipThrough: true, // 結界と同極に合わせてすり抜ける
      castZField: sinCosZ(-1),
      hp: 120,
      species: 'wraith',
    }),
  ],
  obstacles: [
    ...chamber(-32, 32, -42, 42, S3_R),
    // 等間隔の列柱を三列。ピッチ 12 のまま列ごとに 1/3 ピッチ（=4）ずつ横へずらす（#69）。
    // 柱の直径 4.8 ≥ ピッチ/3 なので三列の影が横方向で必ず重なり、**どの縦線も必ず1本に当たる**。
    // 一方で同じ列の柱どうしは 7.2 空いており、曲げれば素材に触れずに抜けられる車線が残る。
    ...pillarGrid({
      x0: -24,
      x1: 24,
      nx: 5,
      y0: 6,
      y1: 6,
      ny: 1,
      element: (ix) => (ix % 2 === 0 ? 'light' : 'dark'),
      kind: 'tough',
    }),
    ...pillarGrid({
      x0: -28,
      x1: 20,
      nx: 5,
      y0: -2,
      y1: -2,
      ny: 1,
      element: (ix) => (ix % 2 === 0 ? 'dark' : 'light'),
      kind: 'tough',
    }),
    ...pillarGrid({
      x0: -20,
      x1: 28,
      nx: 5,
      y0: -10,
      y1: -10,
      ny: 1,
      element: (ix) => (ix % 2 === 0 ? 'light' : 'dark'),
      kind: 'tough',
    }),
    // 崩れた列柱（高さがまちまち＝崩落した神殿）。射線を読みにくくする
    brokenColonnade(-28, -20, 4, -18, 4, 'dark', 'tough', 31),
    brokenColonnade(20, 28, 4, -18, 4, 'light', 'tough', 32),
    // 壊れた塔（射手のカバー）と、番兵の前を守る崩落壁
    ...brokenTower(-25, 0, 10, 10, 'dark', 'tough', { tallSide: 'right', seed: 33 }),
    ruinedWall(-14, 14, 24, 2, 'neutral', 'tough', {
      gaps: [
        { center: -6, width: 3.0 },
        { center: 7, width: 3.0 },
      ],
    }),
    rubble(20, -24, 7, 7, 'neutral', 'fragile', 34),
    rubble(-10, -26, 6, 6, 'neutral', 'fragile', 35),
  ],
  introText: [
    '等間隔の列柱が二列、千鳥に並ぶ広間。奥で広間の番兵が防御の輪を張り、その内側から鋼鬼が二体、柱を割りながら撃ってくる。左手の塔の残骸には射手の影。',
    '狙われた者は結界で守り、残る二人で一体ずつ落とせ。注意：広間の射手は結界の理を読み、同じ極に合わせてすり抜けてくる。',
  ],
  clearText: [
    '番兵の輪が霧散し、列柱の間に静けさが戻る。広間の奥に、封じられた帯が見えている。',
    '降りるほどに、上でも下でもないどこかからの視線が、近くなっていく。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第4面 ― 封印帯（LVL 6・初回崩壊）：暴発の誘発 =====
// 崩し手3体＋交互張りの守護型。崩し手は柱と瓦礫に半身を隠し、暴発弾だけが回り込んで届く。
const S4_R = rFieldForSize(3) // 48
const stage4: Stage = {
  id: 'stage-4',
  name: '第四の間 ― 封印帯',
  rField: S4_R,
  // 散開。左のミラは崩し手・弧の正面、右のソウは折れの正面と、担当が分かれる
  allyPositions: [
    { x: -24, y: -29 }, // ミラ
    { x: 0, y: -35 }, // レン
    { x: 23, y: -27 }, // ソウ
  ],
  enemies: [
    // ゴーレム III（守護型・最上位：交互張り＋方向づけ併用）＝崩し手たちの盾
    enemy('封印の番人', { x: 0, y: 17 }, 'light', 6, 'spiral', {
      role: 'guardian',
      alternatingAura: true, // ターンごとに光⇔闇のオーラを張り替える
      directedAura: true, // 脅威方向に強度偏重（併用・#47）
      hp: 180,
      species: 'golem',
    }),
    // 紅亡霊 II（崩し手3体・誘発）。family を個体ごとに abs/arc/poly34 と変える（#46）。
    // 予告✕を見て反対極の結界で受け止めれば暴発しない（学習テーマ）。
    // 位相（fireOffset）は「同じ極性の弾が同一ターンに2本重ならない」よう振り、
    // 初速は遅め（6.5）：反対極の結界1枚で1本ずつ確実に受け切れる。
    enemy('崩し手・弧', { x: -17, y: -2 }, 'light', 6, 'arc', {
      role: 'ruptor',
      fireEvery: 2,
      fireOffset: 1,
      hp: 175,
      castInitialSpeed: 6.5,
      species: 'redWraith',
    }),
    enemy('崩し手・折れ', { x: 17, y: -2 }, 'dark', 6, 'abs', {
      role: 'ruptor',
      fireEvery: 2,
      fireOffset: 0,
      hp: 175,
      castInitialSpeed: 6.5,
      species: 'redWraith',
    }),
    enemy('崩し手・捻れ', { x: 0, y: -7 }, 'light', 6, 'poly34', {
      role: 'ruptor',
      fireEvery: 2,
      fireOffset: 0,
      hp: 175,
      castInitialSpeed: 6.5,
      species: 'redWraith',
    }),
  ],
  obstacles: [
    ...chamber(-28, 28, -38, 38, S4_R),
    block(-4, 2, 4, 2, 'neutral', 'unbreakable'), // 砕けぬ封印核（正面突破不可・番人の盾）
    // 封印帯の等間隔の柱（ピッチ12・列ごとに1/3ずらす・硬い）。味方→崩し手/番人の直線を断つ
    ...pillarGrid({
      x0: -24,
      x1: 24,
      nx: 5,
      y0: -13,
      y1: -13,
      ny: 1,
      element: (ix) => (ix % 2 === 0 ? 'light' : 'dark'),
      kind: 'tough',
    }),
    ...pillarGrid({
      x0: -20,
      x1: 28,
      nx: 5,
      y0: -20,
      y1: -20,
      ny: 1,
      element: 'dark',
      kind: 'tough',
    }),
    ...pillarGrid({
      x0: -28,
      x1: 20,
      nx: 5,
      y0: -27,
      y1: -27,
      ny: 1,
      element: 'light',
      kind: 'tough',
    }),
    // 崩し手の部分カバー（半身・硬い岩塊）
    disc(-16.5, -7, 2.4, 'dark', 'tough'),
    disc(16.5, -7, 2.4, 'light', 'tough'),
    disc(-4.6, -11.5, 2.4, 'light', 'tough'),
    // 壊れた封印壁（番人の前）：開口はあるが直線では届かない
    ruinedWall(-24, 24, 8, 2, 'light', 'tough', {
      gaps: [
        { center: -9, width: 3.2 },
        { center: 9, width: 3.2 },
      ],
    }),
    rubble(-22, -20, 6, 6, 'neutral', 'fragile', 41),
    rubble(21, -19, 6, 6, 'neutral', 'fragile', 42),
  ],
  introText: [
    '左右の封印壁と、中央の砕けぬ封印核。奥に封印の番人、手前には柱と岩塊に半身を隠した崩し手が三体。',
    '崩し手の弾は光か闇をまとい、狙う相手の目前で暴発する。予兆の✕と弾の色を見て、着弾前に反対の理の結界（✕まで覆う大きさ）で受け止めれば防げる――同じ極の結界は素通りされる。封印壁は硬く術では削りにくい。',
  ],
  clearText: [
    '崩れかけた封印帯を抜け、その奥に大広間への扉が開く。冷たい風が、三人の頬を撫でた。',
    '封印は、閉じ込めるためでも守るためでもなく――もう二度と、あれを起こさないためだったのかもしれない。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

// ===== 第5面 ― 大広間（LVL 7・ボス戦・HPフェーズ制／#45） =====
// ①列柱の間（サイズ2.5＝43）→ 床崩落 → ②崩れた大広間（サイズ4＝60・最大の場）。
// フェーズが進むほど遮蔽が減り、最後はボスと正対する＝クライマックスでは直線が通る。
const S5_R = rFieldForSize(2.5) // 43
/** ②崩落後の大広間：崩れ残った柱だけが立つ開けた円（隠れ場所は少ない） */
const collapsedHall = () => [
  ...pillarGrid({
    x0: -26,
    x1: 26,
    nx: 5,
    y0: -6,
    y1: -6,
    ny: 1,
    element: (ix) => (ix % 2 === 0 ? 'dark' : 'light'),
    kind: 'tough',
  }),
  wall(-20, -8, -18, 1, 'dark', 'tough'),
  wall(8, 20, -18, 1, 'light', 'tough'),
]
const stage5: Stage = {
  id: 'stage-5',
  name: '第五の間 ― 大広間',
  boss: true,
  rField: S5_R, // 43：①列柱の間。フェーズで拡大（②③＝60）
  allyPositions: [
    { x: -21, y: -27 }, // ミラ
    { x: 1, y: -32 }, // レン
    { x: 20, y: -25 }, // ソウ
  ],
  enemies: [
    // 多重詠唱（#44）：火力型枠 line/arc/exp・迂回型枠 abs/arc/poly34/harmonic を弾ごとに独立選択（#46/#69）
    enemy('魔導書の守護者', { x: 0, y: 24 }, 'light', 7, 'abs', {
      hp: 380,
      hitboxRadius: 3.6,
      families: ['line', 'arc', 'exp', 'poly34', 'harmonic'],
      boss: true,
      castCount: 2,
      patternPool: ['breaker', 'attacker'],
    }),
    // 亡霊魔術師 IV（眷属・迂回型・高難度）。塔の陰に立ち、曲射だけが届く
    enemy('守護者の眷属（迂回）', { x: -14, y: 15.5 }, 'dark', 6, 'abs', {
      hp: 130,
      families: ['poly34', 'harmonic'],
      slipThrough: true,
      castZField: sinCosZ(-1),
      species: 'wraith',
    }),
    // 鋼鬼 III（眷属・火力型）：ボス（守護者）と盾の傍＝守られながら撃つ位置（距離5）
    enemy('守護者の眷属（火力）', { x: 4, y: 20 }, 'light', 6, 'line', {
      hp: 130,
      families: ['arc'],
      role: 'breaker',
      species: 'oni',
    }),
  ],
  obstacles: [
    ...chamber(-27, 27, -36, 36, S5_R),
    block(-5, -2, 4, 3, 'light', 'tough'), // 守護者の盾（硬い）
    // 等間隔の列柱（大広間の意匠・ピッチ12を1/3ずつずらした三列）：直線を断つ
    ...pillarGrid({
      x0: -24,
      x1: 24,
      nx: 5,
      y0: 4,
      y1: 4,
      ny: 1,
      element: (ix) => (ix % 2 === 0 ? 'light' : 'dark'),
      kind: 'tough',
    }),
    ...pillarGrid({
      x0: -20,
      x1: 28,
      nx: 5,
      y0: -5,
      y1: -5,
      ny: 1,
      element: 'light',
      kind: 'tough',
    }),
    ...pillarGrid({
      x0: -28,
      x1: 20,
      nx: 5,
      y0: -14,
      y1: -14,
      ny: 1,
      element: 'dark',
      kind: 'tough',
    }),
    ...brokenTower(-14, 3, 9, 10, 'light', 'tough', { tallSide: 'left', seed: 51 }),
    rubble(18, -16, 6, 6, 'neutral', 'fragile', 52),
  ],
  // HPフェーズ（#45）：66%/33% で床が崩れ、②崩れた大広間へ。rField は 43→60 と拡大する（#49）。
  // 最下層（33%以下・断末魔前）はボス単独＝眷属を間引き・3同時発射・遮蔽なしの正対。
  bossPhases: [
    { hpBelow: 0.66, castCount: 2, obstacles: collapsedHall(), rField: 60 },
    { hpBelow: 0.33, castCount: 3, obstacles: [], cullMinions: true, rField: 60 },
  ],
  introText: [
    '遺跡最深の大広間。等間隔の列柱と巨大な盾、中心に古代式の魔導書を守る守護者が浮かぶ。両脇に眷属が二体。',
    '守護者は一度に複数の式を同時に放つ。傷が深まるほど床が崩れ、柱ごと下の階層へ落ちていく――隠れる場所は、進むほどに減る。',
  ],
  clearText: [
    '守護者の盾が砕け、巨体が静かに崩れていく。傾き続けた天秤が、ぴたりと水平で止まった。',
    '三つの理が、一つの均衡をなす。守護者は静かに軸をほどきながら、最後に一つだけ、言葉のように残した。開くとは、傾きうるということだ、と。',
  ],
  mechanics: { obstacles: true, enemyFire: true },
}

export const STAGES: Stage[] = [stage1, stage2, stage3, stage4, stage5]
