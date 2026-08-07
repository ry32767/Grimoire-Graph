// エンドロール（DC プロトタイプ v3 の _drawEndroll を移植）。
// 「本物の敵AI同士が撃ち合う」自動対戦をクレジットの背景として流す。
//
// **計算は本番と完全に同一**（#72）：計画は planEnemyShots、解決は resolveTurn をそのまま呼ぶ。
// 相殺・結界の迎撃・障害物の削り・暴発・ダメージ・状態異常はすべて本番の実装が返した結果を
// 描くだけで、この層はロジックを一切持たない（かつては迎撃順・ダメージ式・相殺距離を
// 独自に書き直していて、壁を貫く結界・因果の逆転した霧散が出ていた）。
// 演出の時刻もエンジンが返すゲーム秒（flightTimes / clashes[].t / breakTime）をそのまま使う。
// 描き方も本編と共有する：弾の太さは trailWidthPx、結界の帯と粒は drawOrbitRing（#60/#74）。
import type {
  ActiveOrbit,
  Ally,
  AllyCast,
  Attribute,
  CarveBurst,
  Enemy,
  EnemyFamily,
  EnemyRole,
  FlightSample,
  Obstacle,
  Trajectory,
  Vec2,
  ZPoint,
} from '../game/types'
import { FIELD, GAME } from '../data/constants'
import { toScreen, type Viewport } from '../game/coords'
import { planEnemyShots } from '../game/enemyAI'
import { predictAllyShots } from '../game/enemyPlanning/foresight'
import { ringAverageAttr } from '../game/orbit'
import { resolveTurn, type ResolveResult } from '../game/turn'
import { flightTimes, timeToArc } from '../game/physics'
import { attributeOf, zfieldAt } from '../game/attribute'
import {
  drawObstacles,
  drawBullet,
  drawCarveBurst,
  drawMisfire,
  drawOrbitDissipation,
  drawDamageNumber,
} from './draw'
import {
  drawDarkVeil,
  drawLightAura,
  drawOrbitRing,
  drawParryFlash,
  trailWidthPx,
  type DarkRing,
  type LightRing,
  type RingPhaseStore,
} from './board'
import { dot, dotPx, walkPath } from './pixelfx'
import { ringPhaseKey } from './ringPhase'
import { TOKENS } from './palette'
import { ringVisible, ringBreakTime, lastEventTime } from './sceneTiming'

const TAU = Math.PI * 2
/** 到達しうる最大 LVL＝本編の敵 LVL の上限（7）。ここまで上がってから両者 LVL1 へ戻る。 */
export const MAX_LEVEL = 7
const START_HP = 140
export const POS_A: Vec2 = { x: -16, y: -6 }
export const POS_B: Vec2 = { x: 15, y: 5 }
/** 弾が飛ぶ見かけの秒数（実飛行秒 → 画面秒の倍率をここから決める） */
const FLIGHT_SEC = 3.4
const FIRE_AT = 0.45
/** 結界が散り切るまでの画面秒 */
const DISSIPATE_SEC = 0.76

type Side = 'A' | 'B'

/** 陣営 → 本編の役割名（A＝味方側の結界／B＝敵側の結界）。粒の位相キーもこれで揃える。 */
const ringRole = (side: Side): 'ally' | 'enemy' => (side === 'A' ? 'ally' : 'enemy')

/** 画面に描く1発（味方＝A側／敵＝B側どちらも同じ形で扱う）。 */
interface Bolt {
  side: Side
  samples: FlightSample[]
  /** サンプルごとの z（色・弾の大きさ用） */
  zs: number[]
  /** 各サンプルへの到達ゲーム秒（physics.flightTimes） */
  times: number[]
  total: number
  /** 壁を削った点（到達ゲーム秒つき） */
  carves: (CarveBurst & { t: number })[]
  misfirePos: Vec2 | null
  /** 暴発したゲーム秒 */
  misfireT: number
}

/** 画面に描く結界1枚。 */
interface RingView {
  ring: ZPoint[]
  side: Side
  /** 霧散したゲーム秒（エンジンの breakTime）。存続中／破壊時刻不明の2通りで null（後者は描き続ける） */
  breakT: number | null
  /** この幕で新しく張られたか（フェードインさせる） */
  fresh: boolean
}

/** ダメージ表示1件（量・時刻ともエンジンの popups をそのまま使う）。 */
interface DamageView {
  pos: Vec2
  amount: number
  kind: Attribute | 'misfire' | 'heal'
  t: number
}

interface Bout {
  bolts: Bolt[]
  rings: RingView[]
  clashes: { pos: Vec2; power: number; t: number }[]
  blasts: { pos: Vec2; t: number; r: number }[]
  damages: DamageView[]
  obstacles: Obstacle[]
  /** 画面秒 = FIRE_AT + ゲーム秒 × k */
  k: number
  duration: number
  /** 決着した画面秒 */
  ko?: number
  koSide?: Side
  /**
   * 決着したときの「次の幕の盤面」（LVL 更新・全回復・組み直した壁）。KO の瞬間に確定させ、
   * 幕の尻尾の先取り計画と幕の終わりの状態更新が**同じもの**を使う（壁の乱数を引き直さない）。
   */
  next?: Board
  /** 幕の終わりに反映する状態（次の幕の計画はこれを盤面として使う） */
  after: {
    hpA: number
    hpB: number
    obstacles: Obstacle[]
    orbits: ActiveOrbit[]
    /** この幕で B が撃った手（次の幕で A 側の読みに渡す・#75） */
    enemyCasts: AllyCast[]
  }
}

/**
 * 計画に使う盤面のスナップショット（幕の開始時点）。
 * 先取り計画（幕の尻尾）と本計画で**同じ状態**を見せるために明示的に渡す
 * （以前は先取りだけが「削れる前の壁・古い結界・古い HP」で計画していて、A 側だけ読みが古かった）。
 */
interface Board {
  obstacles: Obstacle[]
  orbits: ActiveOrbit[]
  hpA: number
  hpB: number
  /** その幕の LVL（決着後の幕を先取り計画するため、`EndrollState` ではなくここから読む） */
  lvA: number
  lvB: number
  /** 一つ前の幕で B が撃った手（A 側の読み・#75） */
  lastEnemyCasts: AllyCast[]
}

/** 1 フレームに 1 手だけ進めるための計画ジョブ。 */
interface PlanJob {
  side: Side
  role: EnemyRole
}

export interface EndrollState {
  lvA: number
  lvB: number
  /** 結界の粒の位相（本編と共有：board.drawOrbitRing がフレームごとに進める） */
  ringPhases: RingPhaseStore
  hpA: number
  hpB: number
  bout: number
  obstacles: Obstacle[]
  /** 持続している結界（両陣営・resolveTurn がそのまま持ち越す） */
  orbits: ActiveOrbit[]
  round: Bout | null
  t0: number
  banner: 'lvup' | 'reset' | null
  /** 次の幕を先取りで計画するためのキュー（board＝その幕の開始時点の盤面） */
  pre: { jobs: PlanJob[]; i: number; casts: AllyCast[]; roles: EnemyRole[]; board: Board } | null
  /** 一つ前の幕で A 側が撃った手（#75：B 側の読みに渡す） */
  lastCasts: AllyCast[]
  /** 一つ前の幕で B 側が撃った手（#75：A 側の読みに渡す。両陣営で読みの有無を揃える） */
  lastEnemyCasts: AllyCast[]
}

const rnd = () => Math.random()

/** 線分が円に触れるか（直線で直接届く経路が残っていないかを確かめる）。 */
function segHitsCircle(a: Vec2, b: Vec2, c: Vec2, r: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const L = dx * dx + dy * dy
  let t = L > 0 ? ((c.x - a.x) * dx + (c.y - a.y) * dy) / L : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y) <= r
}

/**
 * LVL ごとの壁の耐久（上がるほど硬い側へ寄る）。
 * **`unbreakable` は使わない**：エンドロールは決着（KO）でしか LVL が進まないので、
 * 削れない壁で道が完全に塞がると同じ LVL のまま延々と幕が繰り返して進行が止まる。
 * 硬い壁でも毎幕の削りは持ち越される（`Bout.after.obstacles`）ため、いずれ必ず道が開く。
 */
export function kindPool(level: number): NonNullable<Obstacle['kind']>[] {
  if (level <= 2) return ['fragile', 'fragile', 'normal']
  if (level <= 4) return ['fragile', 'normal', 'normal', 'tough']
  if (level <= 6) return ['normal', 'normal', 'tough', 'tough']
  return ['tough', 'tough', 'tough']
}

/** 視線を塞ぐ壁の本数。増えるほど「一度曲がって戻る」だけでは届かない＝経路が複雑になる。 */
export function blockerCount(level: number): number {
  return level <= 3 ? 1 : level <= 5 ? 2 : level <= 6 ? 3 : 4
}

/** 壁の総数（置けた本数はこれ以下）。高 LVL ほど盤面が混み、通り道が細い折れ線になる。 */
export function obstacleCount(level: number): number {
  return Math.min(18, 2 + level * 2)
}

/**
 * 壁の半径（ユニット）。**耐久の最大の効き所はここ**：1撃の削りは
 * `carveMaxRadius(2) × tough(0.32) = 0.64` が上限なので、太い柱ほど抜くのに発数がかかる。
 */
function blockerRadius(level: number): number {
  return 1.7 + rnd() * 0.9 + level * 0.13
}

/** 視線を塞ぐ壁を「厚い衝立」にする LVL（円を A→B 方向へ重ねて奥行きを増す）。 */
const SLAB_MIN_LEVEL = MAX_LEVEL
function scatterRadius(level: number): number {
  return 1.3 + rnd() * 1.2 + level * 0.09
}

/**
 * 術者の周囲に空ける余白（素材の縁までのユニット）。**術者の周りだけは障害物を少なめにする**
 * ＝撃ち出しと着弾の周りが壁で埋まって「出た瞬間に自爆・何も起きない」絵にならないようにする。
 * 視線を塞ぐ壁は A→B 線上に置く必要があるので控えめ、散らす壁は大きく空ける。
 */
export const MAGE_CLEAR = { blocker: 4.6, scatter: 7.4 } as const

/**
 * 壁は決着ごとに引き直す。**LVL が上がるほど本数が増え、太く硬くなり、視線を塞ぐ壁が増える**
 * （＝直進では届かず、高 LVL ほど左右へ振る複雑な経路でしか通れない）。
 * 術者の周囲（MAGE_CLEAR）だけは空けたままにする。
 */
export function makeObstacles(level: number): Obstacle[] {
  const n = obstacleCount(level)
  const kinds = kindPool(level)
  const out: Obstacle[] = []
  const mk = (x: number, y: number, r: number, i: number): Obstacle => ({
    id: `ew${level}-${i}-${Math.floor(rnd() * 1e6)}`,
    element: (rnd() < 0.45 ? (rnd() < 0.5 ? 'light' : 'dark') : 'neutral') as Attribute,
    kind: kinds[Math.floor(rnd() * kinds.length)],
    solids: [{ x, y, r }],
    carves: [],
  })
  // 衝立（複数の円のブロブ）も含めた外接半径。solids[0] を中心の円にそろえてあるので
  // ここから測れば、厚い衝立でも間隔の判定が甘くならない
  const reach = (o: Obstacle) =>
    Math.max(...o.solids.map((sd) => Math.hypot(sd.x - o.solids[0].x, sd.y - o.solids[0].y) + sd.r))
  const free = (x: number, y: number, r: number, clear: number) =>
    Math.hypot(x - POS_A.x, y - POS_A.y) > r + clear &&
    Math.hypot(x - POS_B.x, y - POS_B.y) > r + clear &&
    // 柱どうしの間隔は詰めない：ここを縮めると findRoute は通るのに実弾（半径最大 1.5）が
    // 抜けられない「見せかけの道」になる。複雑さは本数と折れの段数で出す
    out.every((o) => Math.hypot(x - o.solids[0].x, y - o.solids[0].y) > r + reach(o) + 1.4)
  // 視線を塞ぐ壁：必ず A→B の直線上に置く（迂回か掘削でしか通れない）。
  // 2本以上のときは**左右交互**にずらす＝抜け道が左・右・左…と入れ替わり、
  // 1回曲がって戻るだけの軌道では抜けられない（高次・多重の折れが要る経路になる）。
  // 段数は blockerCount（最上位は4段）＝S字を2回描かないと通れない経路になる。
  const ux = POS_B.x - POS_A.x
  const uy = POS_B.y - POS_A.y
  const len = Math.hypot(ux, uy)
  const nx = -uy / len
  const ny = ux / len
  const blockers = blockerCount(level)
  for (let i = 0; i < blockers; i++) {
    const side = blockers === 1 ? rnd() * 2 - 1 : i % 2 === 0 ? 1 : -1
    for (let k = 0; k < 60; k++) {
      // 多段のときは [0.28, 0.72] に収める＝端の段でも術者から MAGE_CLEAR.blocker 以上離れる
      const t = blockers === 1 ? 0.34 + rnd() * 0.32 : 0.28 + (0.44 * i) / (blockers - 1) + (rnd() - 0.5) * 0.05
      const r = blockerRadius(level)
      const off = side * r * (0.35 + rnd() * 0.3)
      const x = POS_A.x + ux * t + nx * off
      const y = POS_A.y + uy * t + ny * off
      // 高 LVL は A→B 方向に円を重ねて「厚い衝立」にする＝迂回路の形は変えずに、
      // 掘って抜くのに必要な発数だけを増やす（削り半径の上限が小さいので奥行きがそのまま耐久）
      const dz = level >= SLAB_MIN_LEVEL ? r * 0.6 : 0
      const dx = (ux / len) * dz
      const dy = (uy / len) * dz
      if (free(x, y, r + dz, MAGE_CLEAR.blocker)) {
        const w = mk(x, y, r, i)
        // solids[0] は必ず中心の円のままにする（間隔判定・直線チェックがここを基準にする）
        if (dz > 0)
          w.solids = [
            { x, y, r },
            { x: x - dx, y: y - dy, r: r * 0.85 },
            { x: x + dx, y: y + dy, r: r * 0.85 },
          ]
        out.push(w)
        break
      }
    }
  }
  // 散らす壁：術者の周囲（MAGE_CLEAR.scatter）を避けて盤面いっぱいに撒く。
  // 撒く範囲は術者の外側まで届かせる＝本数を増やしても「置けずに諦める」で頭打ちにならない
  for (let i = out.length; i < n; i++) {
    for (let k = 0; k < 140; k++) {
      const a = rnd() * TAU
      const d = 3 + rnd() * 16
      const x = Math.cos(a) * d
      const y = Math.sin(a) * d * 0.7
      const r = scatterRadius(level)
      if (free(x, y, r, MAGE_CLEAR.scatter)) {
        out.push(mk(x, y, r, i))
        break
      }
    }
  }
  // 念のため：それでも直線が通っていたら中点に一本足す
  if (!out.some((o) => segHitsCircle(POS_A, POS_B, o.solids[0], o.solids[0].r))) {
    out.push(mk((POS_A.x + POS_B.x) / 2, (POS_A.y + POS_B.y) / 2, 1.9, 99))
  }
  return out
}

/** LVL ごとの同時発射数（LVL1〜MAX_LEVEL）。 */
export const SHOTS = [1, 2, 2, 3, 3, 3, 4]
const shotCount = (lv: number) => SHOTS[Math.min(SHOTS.length - 1, Math.max(0, lv - 1))]

/** 暴発型は最上位でも1発まで（`MAX_RUPTORS`）。 */
export const MAX_RUPTORS = 1

/**
 * 戦い方の配分。低 LVL は火力型（直進で押す）と迂回型（曲げて回す）をぶつける。
 * 高 LVL は 1 発を結界（guardian）に回すので、攻めの手数はその分減る。
 *
 * **暴発型（ruptor）は最上位でも1発まで**：暴発のダメージは固定 180
 * （`sMax(5) × maxFlightSpeed(24) × opposite(1.5)`・misfire.ts）で、HP140 を一撃で消し飛ばす。
 * しかも AoE は距離だけで判定する（`resolveMisfire`）ので**壁では遮れない**。
 * かつて最上位は2発とも暴発型だったため、壁をどれだけ厚くしても両陣営が初手で相打ちになり、
 * LVL7 の幕が1ターンで終わっていた（実測：どちらか1ターンKO 73% / 相打ち 48%）。
 */
export function rolePool(side: Side, lv: number, bout: number): EnemyRole[] {
  const aggro = (side === 'A') === (bout % 2 === 0)
  const r0: EnemyRole = aggro ? 'breaker' : 'attacker'
  const r1: EnemyRole = aggro ? 'attacker' : 'breaker'
  const n = shotCount(lv)
  const pool: EnemyRole[] = []
  let ruptors = 0
  if (lv >= 4) pool.push('guardian')
  while (pool.length < n) {
    const odd = pool.length % 2 === 1
    if (odd && lv >= MAX_LEVEL && ruptors < MAX_RUPTORS) {
      pool.push('ruptor')
      ruptors++
    } else pool.push(odd ? r1 : r0)
  }
  return pool.slice(0, n)
}

/**
 * LVL ごとの得意関数（LVL1〜MAX_LEVEL）。本編と同じ解禁順：
 * 直線・弧 → 波・指数 → 渦・折れ・高次 → **多重サイン（`harmonic`）は終盤（LVL6以降）だけ**（05b §2）。
 */
export const FAMILY_TABLE: { A: EnemyFamily[]; B: EnemyFamily[] }[] = [
  { A: ['line', 'arc'], B: ['arc', 'line'] },
  { A: ['arc', 'line'], B: ['arc', 'wave'] },
  { A: ['arc', 'wave'], B: ['wave', 'exp'] },
  { A: ['wave', 'exp'], B: ['spiral', 'arc'] },
  { A: ['spiral', 'poly34', 'abs'], B: ['abs', 'wave', 'exp'] },
  { A: ['poly34', 'abs', 'harmonic'], B: ['abs', 'poly34', 'harmonic'] },
  { A: ['harmonic', 'wave', 'exp'], B: ['poly34', 'spiral', 'harmonic'] },
]

/** LVL ごとの個体像。本番の敵と同じ形で組み、実際の敵AIへそのまま渡す。 */
function makeMage(side: Side, bout: number, board: Board): Enemy {
  const lv = side === 'A' ? board.lvA : board.lvB
  const fam = FAMILY_TABLE[Math.min(FAMILY_TABLE.length - 1, Math.max(0, lv - 1))]
  // 最上位で |z| が zPeak（強度の山の頂点）へ届く配分。ばらつきを足しても zPeak は超えない
  // （超えると強度が落ちるうえ減速する＝強くならない）
  const mag = Math.min(FIELD.zPeak, (2.6 + lv * 0.34) * (0.92 + rnd() * 0.18))
  const fams = (side === 'A' ? fam.A : fam.B).slice().sort(() => rnd() - 0.5)
  const pool = rolePool(side, lv, bout)
  const el: Attribute = side === 'A' ? 'light' : 'dark'
  const sg = side === 'A' ? 1 : -1
  return {
    id: side === 'A' ? 'mA' : 'mB',
    name: side === 'A' ? 'LIGHT MAGE' : 'DARK MAGE',
    pos: side === 'A' ? POS_A : POS_B,
    hp: side === 'A' ? board.hpA : board.hpB,
    maxHp: START_HP,
    element: el,
    hitboxRadius: GAME.enemyHitbox,
    statuses: [],
    family: fams[0],
    families: fams,
    role: pool[0],
    castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 },
    castInitialSpeed: FIELD.fixedSpeed,
    castZ: sg * mag,
    // 結界の極性：LVL5 までは幕ごとに入れ替える（張り替えで裏をかける）。
    // LVL6 以降は**指定せず読み（#76）に選ばせる**＝飛来弾の反対極を自分で選ぶ最上位の振る舞いになる
    // （明示すると guardSign がそちらを優先するので、読みが働かない）
    guardZSign: lv >= 6 ? undefined : ((bout % 2 === 0 ? sg : -sg) as 1 | -1),
    castCount: pool.length,
    patternPool: pool,
    // すり抜け（結界と同極に合わせて透過する高難度個体）は最上位だけ
    slipThrough: lv >= MAX_LEVEL,
    directedAura: lv >= MAX_LEVEL,
    species: side === 'A' ? 'wraith' : 'oni',
    // 画面の LVL 表記＝本編の敵 LVL そのもの（1〜7）。式の複雑さ・係数の可動域・結界の
    // 複雑さ（ENEMY_FIT_COMPLEXITY / ENEMY_GUARD_PLANNING の段階表）がそのまま段階的に上がる
    level: lv,
  }
}

/** 味方（＝相手の術者）として AI に見せる 1 人ぶん。 */
function asAlly(e: Enemy): Ally {
  return {
    id: e.id,
    name: e.name,
    pos: e.pos,
    hp: e.hp,
    maxHp: e.maxHp,
    element: e.element,
    statuses: [],
  } as Ally
}

/** 次の幕ぶんの「一手」リスト（A 側は1発ずつ計画、B 側は resolveTurn 内でまとめて計画される）。 */
function makeJobs(board: Board, bout: number): PlanJob[] {
  return rolePool('A', board.lvA, bout).map((role) => ({ side: 'A' as const, role }))
}

/**
 * A 側の一手だけ計画する（本番の敵AIを castCount:1 で呼び、結果を「味方の発射」として使う）。
 * false を返したら同じジョブを次フレームへ持ち越す。
 *
 * **B 側（resolveTurn 内の planEnemyShots）と同じ材料をすべて渡す**のが要点：
 * 見えている相手の結界・自前の結界（#71）・前の幕の読み（#75）。片方だけ欠けると
 * 「同じ AI 同士の撃ち合い」に見えて実は一方だけが鈍い、という不公平な絵になる。
 */
function planOne(
  job: PlanJob,
  bout: number,
  bucket: { casts: AllyCast[] },
  board: Board,
): boolean {
  const me = makeMage('A', bout, board)
  const foe = makeMage('B', bout, board)
  const foeAlly = asAlly(foe)
  // 敵AIから見える結界＝相手（B側）が張っている持続結界
  const foeRings = board.orbits.filter((o) => o.owner === 'enemy').map((o) => o.ring)
  // 自前の持続結界（#71：重ね張りを避ける／上限まで張ったら張り直して速度を回復する判断に使う）。
  // B 側は resolveTurn が同じものを渡している＝渡さないと A 側だけ AI が鈍る
  const ownRings = board.orbits.filter((o) => o.owner === 'player').map((o) => o.ring)
  // 読み（#75）：B が前の幕と同じ手で撃ってくると仮定した予測弾。B 側は resolveTurn が
  // lastAllyCasts から同じものを作っている
  const predicted = predictAllyShots(board.lastEnemyCasts, [foeAlly])
  const one: Enemy = { ...me, role: job.role, castCount: 1, patternPool: [job.role] }
  let traj: Trajectory | undefined
  try {
    traj = planEnemyShots(one, [foeAlly], board.obstacles, foeRings, [], FIELD.rField, 0, ownRings, {
      predicted,
    })[0]?.trajectory
  } catch {
    traj = undefined
  }
  if (traj) {
    bucket.casts.push({ allyId: 'mA', trajectory: traj, initialSpeed: FIELD.fixedSpeed })
    return true
  }
  // 暴発型などは手が見つからないことがある。次フレームに迂回型で撃ち直す
  if (job.role !== 'attacker') {
    job.role = 'attacker'
    return false
  }
  return true
}

/** 発散寸前のサンプルは飛び飛びに跳ぶので、破綻した所で切る（見た目のワープ防止）。 */
function tameCount(samples: FlightSample[]): number {
  const MAXSEG = 1.6
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].pos
    const b = samples[i].pos
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (!Number.isFinite(seg) || !Number.isFinite(b.x) || !Number.isFinite(b.y) || seg > MAXSEG) {
      return Math.max(2, i)
    }
  }
  return samples.length
}

/** 飛行＋z から描画用の1発を組む。時刻はすべて physics.flightTimes（本番と同じ定義）。 */
function boltOf(
  side: Side,
  samples: FlightSample[],
  zAt: (pos: Vec2, i: number) => number,
  carves: CarveBurst[],
  misfirePos: Vec2 | null,
): Bolt | null {
  const cut = samples.slice(0, tameCount(samples))
  if (cut.length < 2) return null
  const times = flightTimes(cut)
  const endArc = cut[cut.length - 1].arcLen
  let total = times[times.length - 1]
  if (!Number.isFinite(total) || total <= 0) {
    for (let i = times.length - 1; i >= 0; i--)
      if (Number.isFinite(times[i])) {
        total = times[i]
        break
      }
  }
  if (!Number.isFinite(total) || total <= 0) total = 1
  return {
    side,
    samples: cut,
    zs: cut.map((sm, i) => zAt(sm.pos, i)),
    times,
    total,
    carves: carves
      .filter((c) => c.arcLen <= endArc + 1e-6)
      .map((c) => ({ ...c, t: timeToArc(cut, c.arcLen) }))
      .filter((c) => Number.isFinite(c.t)),
    misfirePos,
    misfireT: misfirePos ? total : 0,
  }
}

/** いまの状態から計画用の盤面を作る（先取りできなかったぶんの計画に使う）。 */
function boardOf(s: EndrollState): Board {
  return {
    obstacles: s.obstacles,
    orbits: s.orbits,
    hpA: s.hpA,
    hpB: s.hpB,
    lvA: s.lvA,
    lvB: s.lvB,
    lastEnemyCasts: s.lastEnemyCasts,
  }
}

/** 幕を組み立てる：本番の resolveTurn を1回呼び、返ってきた結果を描画データへ読み替える。 */
function startBout(s: EndrollState, now: number): void {
  s.bout++
  // 先取りは「その幕の開始時点の盤面」で計画済み。補うぶんも同じ盤面で計画する
  const board = s.pre?.board ?? boardOf(s)
  const bucket = s.pre ?? { casts: [], jobs: [], i: 0, roles: [], board }
  // 先取りが間に合っていない手はここで補う
  const jobs = s.pre?.jobs ?? makeJobs(board, s.bout)
  for (let i = s.pre?.i ?? 0, guard = 0; i < jobs.length && guard < 24; guard++) {
    if (planOne(jobs[i], s.bout, bucket, board)) i++
  }
  s.pre = null

  const mageA = makeMage('A', s.bout, board)
  const mageB = makeMage('B', s.bout, board)
  const allyA: Ally = asAlly(mageA)
  let res: ResolveResult
  try {
    res = resolveTurn({
      allies: [allyA],
      casts: bucket.casts,
      enemies: [mageB],
      castingEnemyIds: [mageB.id],
      obstacles: board.obstacles,
      mechanics: { obstacles: true, enemyFire: true },
      activeOrbits: board.orbits,
      lastAllyCasts: s.lastCasts, // B 側の読み（#75）：A が前の幕と同じ手を撃つと仮定させる
    })
  } catch {
    s.round = null
    s.t0 = now
    return
  }

  s.lastCasts = bucket.casts // 次の幕で B 側が読む「A の前の手」（#75）
  // 次の幕で A 側が読む「B の前の手」（#75）。結界（周回）は resolveTurn 側と同じく読みから外れる
  const enemyCasts: AllyCast[] = res.enemyShots.map((sh) => ({
    allyId: mageB.id,
    trajectory: sh.traj,
    initialSpeed: mageB.castInitialSpeed,
  }))

  // --- 弾（A=味方の発射型／B=敵弾）---
  const bolts: Bolt[] = []
  for (const sh of res.allyShots) {
    if (sh.kind !== 'projectile' || !sh.flight) continue
    const b = boltOf('A', sh.flight.samples, (_p, i) => sh.path[i]?.z ?? 0, sh.carves, sh.misfirePos)
    if (b) bolts.push(b)
  }
  for (const sh of res.enemyShots) {
    const b = boltOf(
      'B',
      sh.flight.samples,
      (p) => zfieldAt(sh.traj, p),
      sh.carves,
      sh.misfired ? sh.misfirePos : null,
    )
    if (b) bolts.push(b)
  }

  // --- 結界（今ターン張った新規＋前ターンからの持続）---
  const rings: RingView[] = []
  for (const sh of res.allyShots) {
    // bornBroken＝壁・失速で回り出す前に自壊した＝結界は一度も存在しなかった。描かない（sceneTiming）
    if (sh.kind !== 'orbit' || sh.path.length < 3 || !ringVisible(sh)) continue
    rings.push({ ring: sh.path, side: 'A', breakT: ringBreakTime(sh), fresh: true })
  }
  for (const er of res.enemyRings) {
    if (er.ring.length < 3 || !ringVisible(er)) continue
    rings.push({ ring: er.ring, side: 'B', breakT: ringBreakTime(er), fresh: true })
  }
  for (const po of s.orbits) {
    const survived = res.orbits.some((o) => o.id === po.id)
    const brk = res.orbitBreaks[po.id]
    // 同じ場所へ張り直したぶんは新規側で描く（二重表示の防止）
    if (survived && rings.some((r) => r.ring === po.ring)) continue
    // 破壊時刻が分からない（brk が無い＝暴発等の記録漏れ）ときは「発射直後に壊れた」と
    // 捏造せず、時刻不明のまま null（＝存続中と同じ扱い）にする（#75。判断は sceneTiming に集約）
    rings.push({
      ring: po.ring,
      side: po.owner === 'player' ? 'A' : 'B',
      breakT: ringBreakTime({ broken: !survived, breakTime: brk?.t ?? null }),
      fresh: false,
    })
  }

  // 粒の位相は幕をまたいで持ち越す（持続結界は流れが途切れない）。消えた結界のキーは捨てる
  const live = new Set(rings.map((r) => ringPhaseKey(r.ring, ringRole(r.side))))
  for (const key in s.ringPhases) if (!live.has(key)) delete s.ringPhases[key]

  // --- 暴発の爆発 ---
  const blasts: Bout['blasts'] = bolts
    .filter((b) => b.misfirePos)
    .map((b) => ({ pos: b.misfirePos as Vec2, t: b.misfireT, r: FIELD.aoeRadius }))

  // --- ダメージ表示：量も時刻もエンジンの popups をそのまま使う（#75。以前は命中時刻を
  // hitTimes から shift() で割り当て直す二重実装があり、対応がずれる余地があった） ---
  const damages: DamageView[] = res.popups.map((p) => ({ pos: p.pos, amount: p.amount, kind: p.kind, t: p.t }))

  // --- 画面時間へのスケール（尺の決定は sceneTiming.lastEventTime に集約・#75） ---
  const lastGame = lastEventTime(
    bolts.map((b) => ({ t: b.total })),
    res.clashes,
    rings.map((r) => ({ t: r.breakT ?? 0 })),
    damages,
  )
  const k = FLIGHT_SEC / Math.max(0.25, lastGame)
  const last = FIRE_AT + lastGame * k

  s.round = {
    bolts,
    rings,
    clashes: res.clashes.filter((c) => Number.isFinite(c.t)),
    blasts,
    damages,
    obstacles: board.obstacles,
    k,
    duration: Math.min(14, last + 1.6),
    after: {
      hpA: res.allies[0]?.hp ?? board.hpA,
      hpB: res.enemies[0]?.hp ?? board.hpB,
      obstacles: res.obstacles,
      orbits: res.orbits,
      enemyCasts,
    },
  }
  s.t0 = now
}

/** 新しいエンドロールを開始する。 */
export function createEndroll(now: number): EndrollState {
  const s: EndrollState = {
    lvA: 1,
    lvB: 1,
    ringPhases: {},
    hpA: START_HP,
    hpB: START_HP,
    bout: 0,
    obstacles: [],
    orbits: [],
    round: null,
    t0: now,
    banner: null,
    pre: null,
    lastCasts: [],
    lastEnemyCasts: [],
  }
  s.obstacles = makeObstacles(1)
  startBout(s, now)
  return s
}

/**
 * 決着（KO）が見えた瞬間に確定する「次の幕の盤面」。
 * やられた側だけ LVL +1・全回復し、最大 LVL で決着したら両者 LVL1 へ戻る。壁は組み直し、
 * 場の結界と「前の手の読み」は持ち越さない（仕切り直し）。
 */
function nextBoardAfterKo(s: EndrollState, R: Bout): Board {
  const lv = R.koSide === 'A' ? s.lvA : s.lvB
  const reset = lv >= MAX_LEVEL
  const lvA = reset ? 1 : R.koSide === 'A' ? s.lvA + 1 : s.lvA
  const lvB = reset ? 1 : R.koSide === 'B' ? s.lvB + 1 : s.lvB
  return {
    obstacles: makeObstacles(Math.max(lvA, lvB)),
    orbits: [],
    hpA: reset || R.koSide === 'A' ? START_HP : R.after.hpA,
    hpB: reset || R.koSide === 'B' ? START_HP : R.after.hpB,
    lvA,
    lvB,
    lastEnemyCasts: [],
  }
}

/** 幕を進める。やられた側だけが LVL を上げて全回復し、壁は別配置に組み直す。 */
function tick(s: EndrollState, now: number): number {
  const R = s.round
  if (!R) {
    startBout(s, now)
    return 0
  }
  const lt = (now - s.t0) / 1000
  // HP は「ダメージ表示が出た時刻」に合わせて減らす（見た目と数字を揃える）
  let dmgA = 0
  let dmgB = 0
  for (const d of R.damages) {
    if (lt < FIRE_AT + d.t * R.k) continue
    const sign = d.kind === 'heal' ? -1 : 1
    // 位置で被害者を判定する（A の術者位置に近い方が A の被弾）
    if (Math.hypot(d.pos.x - POS_A.x, d.pos.y - POS_A.y) < Math.hypot(d.pos.x - POS_B.x, d.pos.y - POS_B.y))
      dmgA += sign * d.amount
    else dmgB += sign * d.amount
  }
  const hpA = Math.max(0, Math.min(START_HP, s.hpA - dmgA))
  const hpB = Math.max(0, Math.min(START_HP, s.hpB - dmgB))
  if (R.ko === undefined && (hpA <= 0 || hpB <= 0)) {
    R.ko = lt
    R.koSide = hpA <= 0 ? 'A' : 'B'
    R.duration = Math.min(R.duration, lt + 3.0)
    const lv = R.koSide === 'A' ? s.lvA : s.lvB
    s.banner = lv >= MAX_LEVEL ? 'reset' : 'lvup'
    // 決着が見えた時点で「次の幕の盤面」（LVL・全回復・組み直した壁）を確定させる。
    // 以前はここで先取りを捨てていたため、**決着の次の幕だけ計画が全部同期で走って画面が固まった**
    // （LVL が上がるほど castCount も壁も増えるので、最悪のフレームがちょうど LVL 更新時に来る）。
    R.next = nextBoardAfterKo(s, R)
    s.pre = null
  }
  // 幕の尻尾で次の幕の計画を 1 フレーム 1 手ずつ進めておく（切り替わりで描画が止まらない）。
  // 盤面は**この幕を解決し終えた後の状態**（決着していれば R.next＝LVL 更新後）＝次の幕の開始時点。
  // B 側は resolveTurn の中で最新の盤面を見るので、ここを今の s のままにすると A 側だけが
  // 「削れる前の壁・古い結界・古い HP」で計画することになる（不公平な非対称）。
  if (lt > R.duration - 2.4) {
    const board: Board =
      R.next ?? {
        obstacles: R.after.obstacles,
        orbits: R.after.orbits,
        hpA: R.after.hpA,
        hpB: R.after.hpB,
        lvA: s.lvA,
        lvB: s.lvB,
        lastEnemyCasts: R.after.enemyCasts,
      }
    if (!s.pre) s.pre = { jobs: makeJobs(board, s.bout + 1), i: 0, casts: [], roles: [], board }
    else if (s.pre.i < s.pre.jobs.length) {
      if (planOne(s.pre.jobs[s.pre.i], s.bout + 1, s.pre, s.pre.board)) s.pre.i++
    }
  }
  if (lt >= R.duration) {
    // 幕の終わりにエンジンの最終状態を反映する（削れた壁・持続結界・HP・読み）
    s.obstacles = R.after.obstacles
    s.orbits = R.after.orbits
    s.hpA = R.after.hpA
    s.hpB = R.after.hpB
    s.lastEnemyCasts = R.after.enemyCasts
    if (R.next) {
      // 決着後の状態は KO の瞬間に確定させたもの（＝先取り計画がその盤面で進んでいる）を必ず使う。
      // ここで作り直すと、壁の乱数が引き直されて「計画した盤面」と「実際に撃つ盤面」がズレる
      s.lvA = R.next.lvA
      s.lvB = R.next.lvB
      s.hpA = R.next.hpA
      s.hpB = R.next.hpB
      s.obstacles = R.next.obstacles
      s.orbits = R.next.orbits // 決着で場の結界は消える
      // 決着＝仕切り直しなので、両陣営の「前の手の読み」も持ち越さない（#75）
      s.lastCasts = []
      s.lastEnemyCasts = R.next.lastEnemyCasts
      s.banner = null
    }
    s.round = null
    startBout(s, now)
    return 0
  }
  return lt
}

const col = (attr: Attribute, a = 1) =>
  attr === 'light' ? `rgba(244,196,48,${a})` : attr === 'dark' ? `rgba(138,111,214,${a})` : `rgba(150,160,180,${a})`

/** エンドロールを 1 フレーム描く。 */
export function drawEndroll(
  ctx: CanvasRenderingContext2D,
  s: EndrollState,
  w: number,
  h: number,
  now: number,
): void {
  const lt = tick(s, now)
  const R = s.round
  if (!R) return
  ctx.clearRect(0, 0, w, h)
  // 本編（BattleCanvas）と同じ倍率にする（#75）：unitsRadius は props.rField（未指定は FIELD.rField）。
  // エンドロールの盤面は常に FIELD.rField の広さで生成している（makeObstacles・planOne が渡す rField も同じ）
  // ので、ここも FIELD.rField をそのまま使う。かつては *0.8 で縮めていたため弾が本編より 1.25 倍大きく見えていた
  const UR = FIELD.rField
  const vp: Viewport = { width: w, height: h, unitsRadius: UR, zoom: 1, pan: { x: 0, y: -UR / 3 } }
  const S = (p: Vec2) => toScreen(p, vp)
  const scale = Math.min(w, h) / 2 / UR
  const phase = (now / 1000) * 3
  /** ゲーム秒 → 画面秒 */
  const at = (t: number) => FIRE_AT + t * R.k

  // 方眼・場の境界
  ctx.lineWidth = 1
  for (let g = -FIELD.rField; g <= FIELD.rField; g += 5) {
    const P = S({ x: g, y: -FIELD.rField })
    const Q = S({ x: g, y: FIELD.rField })
    const C0 = S({ x: -FIELD.rField, y: g })
    const D0 = S({ x: FIELD.rField, y: g })
    ctx.strokeStyle = g % 10 === 0 ? 'rgba(125,143,196,.15)' : 'rgba(125,143,196,.075)'
    ctx.beginPath()
    ctx.moveTo(P.x, P.y)
    ctx.lineTo(Q.x, Q.y)
    ctx.moveTo(C0.x, C0.y)
    ctx.lineTo(D0.x, D0.y)
    ctx.stroke()
  }
  const O = S({ x: 0, y: 0 })
  ctx.strokeStyle = 'rgba(125,143,196,.42)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(O.x, O.y, FIELD.rField * scale, 0, TAU)
  ctx.stroke()

  // 結界：霧散はエンジンが返した breakTime ちょうどから始まる（#72）
  for (const rec of R.rings) {
    if (rec.breakT !== null) {
      const bt = at(rec.breakT)
      if (lt >= bt) {
        const pr = (lt - bt) / DISSIPATE_SEC
        if (pr < 1) drawOrbitDissipation(ctx, rec.ring, Math.min(0.999, pr), vp)
        continue
      }
    }
    // 帯も粒も本編と同じ drawOrbitRing に任せる（#60/#74）。粒は**その場のリング速度**で流れるので
    // |z|<zRef の区間で加速し、|z|>zRef の区間で詰まる。かつてはここで
    // 「一定周期（3.4秒で一周）・向きは陣営で反転」という自前の回転を描いていて、
    // 結界が加速しない／闇側だけ逆回りに見える、という本編との食い違いが出ていた。
    ctx.save()
    if (rec.fresh) ctx.globalAlpha = Math.min(1, Math.max(0, (lt - 0.45) / 0.6))
    ctx.globalAlpha *= 0.34
    drawOrbitRing(ctx, vp, rec.ring, ringRole(rec.side), s.ringPhases, true)
    ctx.restore()
  }

  // 壁（弾が届いた削りだけ見せる）
  if (R.obstacles.length) {
    const view = R.obstacles.map((o) => {
      const holes: { x: number; y: number; r: number }[] = []
      for (const b of R.bolts) {
        for (const c of b.carves) {
          if (c.obstacleId === o.id && lt >= at(c.t)) holes.push({ x: c.pos.x, y: c.pos.y, r: c.r })
        }
      }
      return holes.length ? { ...o, carves: [...o.carves, ...holes] } : o
    })
    drawObstacles(ctx, view, vp)
  }

  // 結界の効果（#39/#61/#73）：光＝内側を毎ターン回復させる癒やしの場、闇＝内側を隠す幕。
  // 効果を及ぼすのは「霧散していない結界」だけ＝エンジンの判定（turn.ts §5.5）と同じ条件で選ぶ。
  // 属性の決め方（ringAverageAttr）も描き方（drawLightAura/drawDarkVeil）も本編と同じ実装を呼ぶ。
  const liveLight: LightRing[] = []
  const liveDark: DarkRing[] = []
  for (const rec of R.rings) {
    if (rec.breakT !== null && lt >= at(rec.breakT)) continue
    const avg = ringAverageAttr(rec.ring)
    if (avg === 'light') liveLight.push({ ring: rec.ring, owner: ringRole(rec.side) })
    else if (avg === 'dark') liveDark.push({ ring: rec.ring, owner: ringRole(rec.side) })
  }
  // 背景なので見出し（「癒やしの輪 — 毎ターン回復」等）は伏せる
  drawLightAura(ctx, vp, liveLight, phase, true)
  drawDarkVeil(ctx, vp, liveDark, phase, true)

  // 弾
  for (const b of R.bolts) {
    const tg = (lt - FIRE_AT) / R.k // 現在のゲーム秒
    if (tg < 0) continue
    const done = tg >= b.total
    let i = 1
    while (i < b.times.length - 1 && b.times[i] < tg) i++
    if (done) i = b.samples.length - 1
    const fade = done ? Math.max(0, 1 - (lt - at(b.total)) / 1.2) : 1
    if (fade <= 0) continue
    ctx.save()
    // 軌跡は本編（board.drawFlightPath）と同じドット絵の文法で描く（#74）：
    // 大きさ＝属性強度（trailWidthPx・格子へ量子化済み）、濃さは頭に近いほど濃い段。
    // サンプル間隔は速度でばらつくので、**弧長で等間隔に**打ち直す（walkPath）＝
    // 速い区間で軌跡が途切れない。
    const back = Math.min(i, 44)
    const trail: { pos: Vec2; z: number }[] = []
    for (let n = back; n >= 0; n--) {
      const p = b.samples[i - n]
      if (p) trail.push({ pos: p.pos, z: b.zs[i - n] ?? 0 })
    }
    let lx = NaN
    let ly = NaN
    walkPath(trail, trail.length - 1, (t) => S(t.pos), Math.max(2, dotPx(vp)), (x, y, src, _n, head) => {
      const w = trailWidthPx(src.z, vp)
      // 間隔はその場の大きさに合わせる（固定歩幅だと太い所がのっぺりした帯になる）
      if (!Number.isNaN(lx) && Math.hypot(x - lx, y - ly) < w * 0.8) return
      lx = x
      ly = y
      dot(ctx, x, y, w, col(attributeOf(src.z), 1), head * head * 0.7 * fade)
    })
    ctx.restore()
    if (!done) drawBullet(ctx, b.samples[i].pos, b.zs[i] ?? 0, vp, phase, b.samples[i].speed)
    for (const c of b.carves) {
      const dt = (lt - at(c.t)) / 0.55
      if (dt >= 0 && dt < 1) drawCarveBurst(ctx, c.pos, c.r, c.attr, dt, vp)
    }
  }

  // 相殺・迎撃の火花（時刻はエンジンの clashes[].t）。
  // 絵は本編と共有する（board.drawParryFlash）＝「相殺」の文字だけがエンドロールに無い。
  for (const cl of R.clashes) {
    const dt = (lt - at(cl.t)) / 0.95
    if (dt < 0 || dt >= 1) continue
    drawParryFlash(ctx, vp, cl.pos, cl.power, dt)
  }

  // 暴発
  for (const bl of R.blasts) {
    const q = (lt - at(bl.t)) / 1.5
    if (q < 0 || q >= 1) continue
    // 0.62 までは広がり、そこからは畳まれる（広がりっぱなしにしない）
    const kk = q < 0.62 ? 1 : Math.pow(Math.max(0, 1 - (q - 0.62) / 0.38), 0.9)
    if (kk <= 0.02) continue
    const P = S(bl.pos)
    ctx.save()
    ctx.translate(P.x, P.y)
    ctx.scale(kk, kk)
    ctx.translate(-P.x, -P.y)
    drawMisfire(ctx, bl.pos, Math.min(0.999, q), vp, bl.r)
    ctx.restore()
  }

  // 術者（HP はダメージ表示と同じ時刻で減る）
  let shownA = s.hpA
  let shownB = s.hpB
  for (const d of R.damages) {
    if (lt < at(d.t)) continue
    const sign = d.kind === 'heal' ? -1 : 1
    if (Math.hypot(d.pos.x - POS_A.x, d.pos.y - POS_A.y) < Math.hypot(d.pos.x - POS_B.x, d.pos.y - POS_B.y))
      shownA -= sign * d.amount
    else shownB -= sign * d.amount
  }
  shownA = Math.max(0, Math.min(START_HP, shownA))
  shownB = Math.max(0, Math.min(START_HP, shownB))
  for (const [p, attr, hp] of [
    [POS_A, 'light', shownA],
    [POS_B, 'dark', shownB],
  ] as [Vec2, Attribute, number][]) {
    const P = S(p)
    if (hp <= 0) {
      const dt = R.ko !== undefined ? Math.min(1, Math.max(0, (lt - R.ko) / 1.1)) : 1
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let j = 0; j < 10; j++) {
        const aa = (j / 10) * TAU + 0.2
        const len = 10 + 34 * Math.pow(dt, 0.5)
        ctx.strokeStyle = col(j % 2 ? 'light' : 'dark', 0.8 * (1 - dt))
        ctx.lineWidth = 2.4 * (1 - dt) + 0.4
        ctx.beginPath()
        ctx.moveTo(P.x + Math.cos(aa) * len * 0.25, P.y + Math.sin(aa) * len * 0.25)
        ctx.lineTo(P.x + Math.cos(aa) * len, P.y + Math.sin(aa) * len)
        ctx.stroke()
      }
      ctx.restore()
      continue
    }
    ctx.globalAlpha = hp <= 35 ? 0.55 + 0.45 * Math.sin((now / 1000) * 9) : 1
    ctx.fillStyle = col(attr, 0.85)
    ctx.fillRect(P.x - 3, P.y - 3, 6, 6)
    ctx.strokeStyle = col(attr, 0.3)
    ctx.lineWidth = 1
    ctx.strokeRect(P.x - 7, P.y - 7, 14, 14)
    ctx.globalAlpha = 1
  }

  // ダメージ表示
  for (const d of R.damages) {
    const dt = (lt - at(d.t)) * 1000
    if (dt < 0 || dt >= 1000) continue
    const pr = dt / 1000
    const P = S(d.pos)
    const size = Math.round(15 + Math.min(15, d.amount / 11))
    drawDamageNumber(
      ctx,
      P.x,
      P.y - 14 - Math.pow(pr, 0.6) * 30,
      String(Math.round(d.amount)),
      d.kind === 'misfire' ? '#ffffff' : d.kind === 'heal' ? '#5ad16a' : col(d.kind, 1),
      size,
      Math.min(1, (1 - pr) * 2.6),
    )
  }

  // HUD：両者の HP と LVL
  const barW = Math.min(240, w * 0.26)
  const barH = 9
  const top = 18
  const bar = (x: number, hp: number, c: string, name: string, lv: number, right: boolean) => {
    ctx.save()
    ctx.fillStyle = 'rgba(10,10,20,.72)'
    ctx.fillRect(x, top, barW, barH)
    ctx.strokeStyle = 'rgba(125,143,196,.5)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, top + 0.5, barW - 1, barH - 1)
    const fw = Math.max(0, Math.min(1, hp / START_HP)) * (barW - 4)
    ctx.fillStyle = hp <= 35 ? TOKENS.hpLow : hp <= 70 ? TOKENS.light : c
    if (right) ctx.fillRect(x + barW - 2 - fw, top + 2, fw, barH - 4)
    else ctx.fillRect(x + 2, top + 2, fw, barH - 4)
    ctx.font = "10px 'DotGothic16', monospace"
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = right ? 'right' : 'left'
    ctx.fillStyle = TOKENS.textDim
    ctx.fillText(name, right ? x + barW : x, top - 5)
    ctx.fillStyle = c
    ctx.fillText(String(Math.round(hp)), right ? x - 10 : x + barW + 10, top + barH - 0.5)
    ctx.font = "700 11px 'DotGothic16', monospace"
    ctx.fillText(`LVL ${lv}`, right ? x + barW : x, top + barH + 13)
    ctx.font = "9px 'DotGothic16', monospace"
    ctx.fillStyle = TOKENS.textDim
    const nm: Record<string, string> = { breaker: '火力', attacker: '迂回', ruptor: '暴発', guardian: '結界' }
    ctx.fillText(
      rolePool(right ? 'B' : 'A', lv, s.bout)
        .map((r) => nm[r] ?? r)
        .join('・'),
      right ? x + barW : x,
      top + barH + 25,
    )
    ctx.restore()
  }
  bar(24, shownA, TOKENS.light, 'LIGHT MAGE', s.lvA, false)
  bar(w - 24 - barW, shownB, TOKENS.dark, 'DARK MAGE', s.lvB, true)

  // 決着の見出し
  if (R.ko !== undefined && s.banner) {
    const q = Math.min(1, Math.max(0, (lt - R.ko) / 0.4))
    ctx.save()
    ctx.globalAlpha = q * Math.min(1, (R.duration - lt) / 0.5)
    ctx.textAlign = 'center'
    ctx.font = "700 26px 'DotGothic16', monospace"
    ctx.lineJoin = 'miter'
    ctx.miterLimit = 2
    const lo = R.koSide === 'A' ? 'LIGHT MAGE' : 'DARK MAGE'
    const lv = R.koSide === 'A' ? s.lvA : s.lvB
    const txt = s.banner === 'lvup' ? `${lo} LVL ${lv + 1}` : 'LVL 1 から やり直し'
    ctx.strokeStyle = TOKENS.edgeDark
    ctx.lineWidth = 6
    ctx.strokeText(txt, w / 2, h * 0.3)
    ctx.fillStyle = s.banner === 'lvup' ? TOKENS.lightSoft : TOKENS.hpLow
    ctx.fillText(txt, w / 2, h * 0.3)
    ctx.font = "10px 'DotGothic16', monospace"
    ctx.fillStyle = TOKENS.textDim
    ctx.fillText(s.banner === 'lvup' ? '全回復して壁を組み直す' : '両者 LVL 1・全回復', w / 2, h * 0.3 + 20)
    ctx.restore()
  }

  // 中央を読ませる暗幕
  const g2 = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6)
  g2.addColorStop(0, 'rgba(4,4,10,.52)')
  g2.addColorStop(0.42, 'rgba(4,4,10,.34)')
  g2.addColorStop(1, 'rgba(4,4,10,.04)')
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, w, h)
}
