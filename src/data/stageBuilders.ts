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
): Obstacle[] {
  return spanX(x0, x1, step).map((x, i) => pillar(x, y0, n, elems[i % elems.length]))
}
