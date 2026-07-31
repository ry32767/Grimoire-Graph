// ステージ構築用の共有ヘルパ（#67 ステージエディタ土台）。
// stages.ts に散在していた「敵ファクトリ」「障害物ヘルパ」「定数」を抽出し、
// エディタ（src/editor/）と本編ステージ定義（src/data/stages.ts）の両方から同じ実装を使う。
// 挙動は抽出前と完全に不変（座標・素材のロジックは1文字も変えていない）。
import type { Disc, Enemy, EnemyFamily, Obstacle, ObstacleKind, Rect, ZField } from '../game/types'
import { GAME } from './constants'

/** サイズ（スケッチの相対値）→ 場の半径 rField（第1面 size1=25 〜 最大 size4=60 の線形）。 */
export function rFieldForSize(size: number): number {
  return Math.round(25 + ((size - 1) * 35) / 3)
}
// 参考: size 1→25, 1.5→31, 2→37, 2.5→43, 3→48, 3.5→54, 4→60

/** LVL → 数値スケール（06b §2）。HP倍率は基礎100を1.0とした目安、castMag は z 強度。 */
export const LVL_SCALE: Record<number, { hp: number; mag: number }> = {
  1: { hp: 1.0, mag: 3 },
  2: { hp: 1.15, mag: 3 },
  3: { hp: 1.3, mag: 3.5 },
  4: { hp: 1.5, mag: 3.5 },
  5: { hp: 1.65, mag: 4 },
  6: { hp: 1.85, mag: 4.5 },
  7: { hp: 2.0, mag: 5 },
}

/** 全敵共通の初速（06b §2：LVLで変化させない） */
export const CAST_SPEED = 8

/** 敵の追加設定（#28/#42/#44/05b） */
export interface EnemyOpts {
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

/** 敵IDカウンタ（モジュール連番）。エディタ等で新規ステージを作るたびに衝突を避けたい場合は resetSeq() で巻き戻す。 */
export let seq = 0
export function resetSeq(n = 0): void {
  seq = n
}

/** 敵ファクトリ：LVL から HP・castMag を決める（06b §2）。基礎 HP=100 × LVL倍率。 */
export function enemy(
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
export const sinCosZ =
  (sign: 1 | -1) =>
  (mag: number): ZField =>
  (x: number, y: number) =>
    sign * mag * Math.sin(0.28 * x + 0.22 * y + 1.2)

// 障害物は solids（重なった円の和＝連続したブロブ）で構成し、ステージのテーマに合わせて配置する。
export const R = 2.4 // 円の半径
export const STEP = 2.4 // 円の間隔（半径と同じ＝隣と重なって連続したブロブになる）
/** 障害物IDカウンタ（モジュール連番）。エディタ等で衝突を避けたい場合は resetOseq() で巻き戻す。 */
export let oseq = 0
export function resetOseq(n = 0): void {
  oseq = n
}
export function ob(element: Obstacle['element'], solids: Disc[], kind?: ObstacleKind): Obstacle {
  return kind ? { id: `o${oseq++}`, element, solids, carves: [], kind } : { id: `o${oseq++}`, element, solids, carves: [] }
}
/** 四角い壁（#56）：solids の代わりに矩形で素材を表す（角がシャープ）。 */
export function obRect(element: Obstacle['element'], rects: Rect[], kind?: ObstacleKind): Obstacle {
  const base = { id: `o${oseq++}`, element, solids: [], rects, carves: [] }
  return kind ? { ...base, kind } : base
}
/** 任意半径の円（柱）1個（#68）：(cx, cy) 中心・半径 r の単一の solid。エディタで自由配置する。 */
export function disc(cx: number, cy: number, r: number, element: Obstacle['element'], kind?: ObstacleKind): Obstacle {
  return ob(element, [{ x: cx, y: cy, r }], kind)
}
/** 任意サイズの矩形の壁1枚（#68・自由な部屋）：左下 (x, y)・幅 w・高さ h。 */
export function rect(x: number, y: number, w: number, h: number, element: Obstacle['element'], kind?: ObstacleKind): Obstacle {
  return obRect(element, [{ x, y, w, h }], kind)
}
/** 縦の柱：(cx, y0) から上へ n 個の円を積んだブロブ */
export function pillar(cx: number, y0: number, n: number, element: Obstacle['element'], kind?: ObstacleKind): Obstacle {
  return ob(
    element,
    Array.from({ length: n }, (_, i) => ({ x: cx, y: y0 + i * STEP, r: R })),
    kind,
  )
}
/** 矩形ブロック：左下 (x0, y0) から cols×rows ぶんを占める四角い壁（#56：角がシャープ）。 */
export function block(
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
export function spiralArm(
  cx: number,
  cy: number,
  n: number,
  turns: number,
  phase: number,
  element: Obstacle['element'],
  r0 = 2.5,
  kind?: ObstacleKind,
): Obstacle {
  return ob(
    element,
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * turns * Math.PI * 2 + phase
      const rad = r0 + 0.9 * t
      return { x: cx + rad * Math.cos(t), y: cy + rad * Math.sin(t), r: R }
    }),
    kind,
  )
}
/** 横一列に連続する壁（円を overlap させて x0→x1 を切れ目なく覆う）。rows 段重ね。 */
export function wall(
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

/** リング（環状の壁）：中心 (cx,cy)・半径 radius に円ブロブを n 個円環状に並べる（第2面の中央リング）。 */
export function ring(
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

/**
 * 部屋の囲い（手描き仕様）：円の中に矩形の部屋 [xL,xR]×[yB,yT] を残し、外側（円内の残り）を
 * 壁で埋めて「四方を壁で囲った部屋」にする。上下左右の4枚の矩形で密封する（角は場境界の外まで
 * 伸ばして回り込みを断つ＝翼壁の役割を内包）。既定は割れない壁（部屋の境界）。
 */
export function roomWalls(
  xL: number,
  xR: number,
  yB: number,
  yT: number,
  rField: number,
  element: Obstacle['element'] = 'neutral',
  kind: ObstacleKind = 'unbreakable',
): Obstacle[] {
  const M = rField + 6 // 場境界の外まで（円の外周まで壁を届かせる）
  return [
    obRect(element, [{ x: -M, y: -M, w: xL - -M, h: 2 * M }], kind), // 左
    obRect(element, [{ x: xR, y: -M, w: M - xR, h: 2 * M }], kind), // 右
    obRect(element, [{ x: xL, y: yT, w: xR - xL, h: M - yT }], kind), // 上
    obRect(element, [{ x: xL, y: -M, w: xR - xL, h: yB - -M }], kind), // 下
  ]
}
/** 左右だけを壁で塞ぐ部屋（上下は開く＝縦長の広間）。第5面：上下に射線を通しつつ側面の回り込みを断つ。 */
export function roomWallsOpenEnds(xL: number, xR: number, rField: number): Obstacle[] {
  const M = rField + 6
  return [
    obRect('neutral', [{ x: -M, y: -M, w: xL - -M, h: 2 * M }], 'unbreakable'), // 左
    obRect('neutral', [{ x: xR, y: -M, w: M - xR, h: 2 * M }], 'unbreakable'), // 右
  ]
}
/** x0→x1 を step 刻みで並べた x 座標列 */
export function spanX(x0: number, x1: number, step: number): number[] {
  const xs: number[] = []
  for (let x = x0; x <= x1 + 1e-6; x += step) xs.push(x)
  return xs
}
/** 列柱：x0→x1 を step 間隔で、各柱は縦 n 段のブロブ。elems を順に割り当てて光闇を交互にできる。 */
export function colonnade(
  x0: number,
  x1: number,
  step: number,
  y0: number,
  n: number,
  elems: Obstacle['element'][],
  kind?: ObstacleKind,
): Obstacle[] {
  return spanX(x0, x1, step).map((x, i) => pillar(x, y0, n, elems[i % elems.length], kind))
}

// ===== RPG の部屋風レイアウト用のヘルパ（#69）=====
// 「等間隔の柱」「壊れた建造物」「ドアで繋がった部屋」を組み合わせて、
// 直線では敵に届かない複雑な地形を宣言的に書けるようにする。
// 崩れ具合のばらつきは決定的な擬似乱数（シード）で作る：Math.random は使わない（テストが揺れるため）。

/** 決定的な擬似乱数（mulberry32）。同じ seed なら常に同じ地形になる。 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 壁に空ける開口（ドア・崩落口）。center は壁の長手方向の座標、width は開口の幅。 */
export interface Gap {
  center: number
  width: number
}

/** [lo, hi] の区間から gaps を抜いた残りの区間列（開口つきの壁を作る土台）。 */
function spansWithGaps(lo: number, hi: number, gaps: Gap[]): { a: number; b: number }[] {
  const sorted = [...gaps].sort((g1, g2) => g1.center - g2.center)
  const out: { a: number; b: number }[] = []
  let cur = lo
  for (const g of sorted) {
    const a = g.center - g.width / 2
    const b = g.center + g.width / 2
    if (b <= cur || a >= hi) continue
    if (a > cur) out.push({ a: cur, b: Math.min(a, hi) })
    cur = Math.max(cur, b)
  }
  if (cur < hi) out.push({ a: cur, b: hi })
  return out.filter((s) => s.b - s.a > 1e-6)
}

/**
 * ドア（開口）つきの部屋（#69）。roomWalls と同じく円の外まで壁を伸ばして回り込みを断つが、
 * 各辺に開口を空けられる＝「部屋どうしが扉で繋がった RPG のダンジョン」を組める。
 * doors の座標は辺の長手方向（左右＝y、上下＝x）で指定する。
 */
export function chamber(
  xL: number,
  xR: number,
  yB: number,
  yT: number,
  rField: number,
  doors: { left?: Gap[]; right?: Gap[]; top?: Gap[]; bottom?: Gap[] } = {},
  element: Obstacle['element'] = 'neutral',
  kind: ObstacleKind = 'unbreakable',
): Obstacle[] {
  const M = rField + 6 // 場境界の外まで（円の外周まで壁を届かせる）
  const vert = (x: number, w: number, gaps: Gap[]): Obstacle =>
    obRect(element, spansWithGaps(-M, M, gaps).map((s) => ({ x, y: s.a, w, h: s.b - s.a })), kind)
  const horiz = (y: number, h: number, gaps: Gap[]): Obstacle =>
    obRect(element, spansWithGaps(xL, xR, gaps).map((s) => ({ x: s.a, y, w: s.b - s.a, h })), kind)
  return [
    vert(-M, xL - -M, doors.left ?? []),
    vert(xR, M - xR, doors.right ?? []),
    horiz(yT, M - yT, doors.top ?? []),
    horiz(-M, yB - -M, doors.bottom ?? []),
  ]
}

/**
 * 等間隔の柱グリッド（#69）：矩形 [x0,x1]×[y0,y1] に nx×ny 本の円柱を等間隔で立てる。
 * 素材は要素ごとに1つの Obstacle へまとめる（判定コストを抑える）。
 * skip(ix, iy) が true の格子は「崩れて無くなった柱」として立てない。
 */
export function pillarGrid(opts: {
  x0: number
  x1: number
  nx: number
  y0: number
  y1: number
  ny: number
  r?: number
  /** 柱ごとの属性（格子番号で切り替えたいときは関数で渡す） */
  element: Obstacle['element'] | ((ix: number, iy: number) => Obstacle['element'])
  kind?: ObstacleKind
  skip?: (ix: number, iy: number) => boolean
}): Obstacle[] {
  const r = opts.r ?? R
  const byElement = new Map<Obstacle['element'], Disc[]>()
  for (let ix = 0; ix < opts.nx; ix++) {
    for (let iy = 0; iy < opts.ny; iy++) {
      if (opts.skip?.(ix, iy)) continue
      const tx = opts.nx === 1 ? 0.5 : ix / (opts.nx - 1)
      const ty = opts.ny === 1 ? 0.5 : iy / (opts.ny - 1)
      const el = typeof opts.element === 'function' ? opts.element(ix, iy) : opts.element
      const list = byElement.get(el) ?? []
      list.push({ x: opts.x0 + (opts.x1 - opts.x0) * tx, y: opts.y0 + (opts.y1 - opts.y0) * ty, r })
      byElement.set(el, list)
    }
  }
  return [...byElement].map(([el, solids]) => ob(el, solids, opts.kind))
}

/**
 * 崩れ落ちた壁（#69）：x0→x1 の横壁に開口をいくつも空けた「崩落した建造物」。
 * gaps を明示しなければ seed から決定的にばらけた欠けを作る（同じ seed なら常に同じ形）。
 */
export function ruinedWall(
  x0: number,
  x1: number,
  y: number,
  rows: number,
  element: Obstacle['element'],
  kind?: ObstacleKind,
  opts: { gaps?: Gap[]; gapCount?: number; seed?: number } = {},
): Obstacle {
  const step = R * 1.4
  const h = (rows - 1) * step + 2 * R
  let gaps = opts.gaps
  if (!gaps) {
    const n = opts.gapCount ?? 2
    const rand = rng(opts.seed ?? 1)
    const span = x1 - x0
    gaps = Array.from({ length: n }, (_, i) => ({
      center: x0 + (span * (i + 0.5)) / n + (rand() - 0.5) * (span / n) * 0.5,
      width: 2.4 + rand() * 2.4,
    }))
  }
  return obRect(
    element,
    spansWithGaps(x0 - R, x1 + R, gaps).map((s) => ({ x: s.a, y: y - R, w: s.b - s.a, h })),
    kind,
  )
}

/**
 * 折れた列柱（#69）：x0→x1 に step 間隔で柱を立てるが、高さが柱ごとにばらつく（＝崩れかけの神殿）。
 * 高さのばらつきは seed から決定的に決まる。射線は「柱の間」と「短い柱の上」の両方から通る。
 */
export function brokenColonnade(
  x0: number,
  x1: number,
  step: number,
  y0: number,
  maxRows: number,
  element: Obstacle['element'],
  kind?: ObstacleKind,
  seed = 7,
): Obstacle {
  const rand = rng(seed)
  const solids: Disc[] = []
  for (const x of spanX(x0, x1, step)) {
    const n = 1 + Math.floor(rand() * maxRows)
    for (let i = 0; i < n; i++) solids.push({ x, y: y0 + i * STEP, r: R })
  }
  return ob(element, solids, kind)
}

/**
 * 瓦礫の山（#69）：中心 (cx,cy) の周りに半径のばらついた小さな塊を散らす。既定は fragile
 * （もろい＝一撃で大きく崩せる）。遮蔽としては頼りないが射線を曲げる素材になる。
 */
export function rubble(
  cx: number,
  cy: number,
  spread: number,
  n: number,
  element: Obstacle['element'] = 'neutral',
  kind: ObstacleKind = 'fragile',
  seed = 3,
): Obstacle {
  const rand = rng(seed)
  return ob(
    element,
    Array.from({ length: n }, () => {
      const t = rand() * Math.PI * 2
      const rad = spread * Math.sqrt(rand())
      return { x: cx + rad * Math.cos(t), y: cy + rad * Math.sin(t), r: 1.2 + rand() * 1.4 }
    }),
    kind,
  )
}

/**
 * 壊れた塔（#69）：崩れて片側だけが高く残った建造物。矩形2枚で「欠けた輪郭」を作り、
 * 足元に瓦礫を伴う。単純な四角い壁より射線の通り方が読みにくくなる。
 */
export function brokenTower(
  cx: number,
  cy: number,
  w: number,
  h: number,
  element: Obstacle['element'],
  kind: ObstacleKind = 'tough',
  opts: { tallSide?: 'left' | 'right'; seed?: number } = {},
): Obstacle[] {
  const rand = rng(opts.seed ?? 5)
  const tall = opts.tallSide ?? (rand() < 0.5 ? 'left' : 'right')
  const half = w / 2
  const lowH = h * (0.35 + rand() * 0.2)
  const tower = obRect(
    element,
    tall === 'left'
      ? [
          { x: cx - half, y: cy, w: half, h },
          { x: cx, y: cy, w: half, h: lowH },
        ]
      : [
          { x: cx - half, y: cy, w: half, h: lowH },
          { x: cx, y: cy, w: half, h },
        ],
    kind,
  )
  return [tower, rubble(cx + (tall === 'left' ? half : -half), cy - 1, half * 0.9, 4, element, 'fragile', opts.seed ?? 5)]
}
