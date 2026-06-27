// ゲーム全体で共有するドメイン型。ここは他モジュールに依存しない（循環回避）。

/** 2D ベクトル（数学座標。原点 O=(0,0)＝術者） */
export interface Vec2 {
  x: number
  y: number
}

/** 属性タイプ：命中位置の z 符号で決定（§3.2） */
export type Attribute = 'light' | 'dark' | 'neutral'

/** z（属性の高さ）つきの軌道点。描画の色分けに使う */
export interface ZPoint {
  pos: Vec2
  z: number
}

/** 発射方式：回転（y=g(x) をθ回転）／極座標（r=f(θ)） */
export type FireMode = 'rotate' | 'polar'

/** 敵の得意関数の系統（#17：見た目で判別）。直線/弧/波/渦。 */
export type EnemyFamily = 'line' | 'arc' | 'wave' | 'spiral'

/** 撃ち主 */
export type Owner = 'player' | 'enemy'

/**
 * 回転方式の軌道：y=g(x) を angle[rad] 回転し、術者位置 origin から発射（#14）。
 * 平面軌道は origin を始点に平行移動する（局所 y は g(x)-g(0)）。属性 z は g(x)（生値）。
 */
export interface RotateTrajectory {
  mode: 'rotate'
  g: (x: number) => number
  angle: number
  /** 発射元（術者位置）。未指定は原点 */
  origin?: Vec2
}

/** 極座標方式の軌道：r=f(θ)（術者位置 origin を極の中心に・全方向） */
export interface PolarTrajectory {
  mode: 'polar'
  f: (theta: number) => number
  /** 極の中心（術者位置）。未指定は原点 */
  origin?: Vec2
}

/** 軌道（発射方式の判別共用体） */
export type Trajectory = RotateTrajectory | PolarTrajectory

/** 発射する術式（プレイヤー／敵共通の入力パラメータ） */
export interface Spell {
  owner: Owner
  trajectory: Trajectory
  initialSpeed: number
}

/** 物理シミュレーション結果の1点 */
export interface FlightSample {
  /** 数学座標の位置 */
  pos: Vec2
  /** その時点の速度（飛行中に変化、0 で消滅） */
  speed: number
  /** 原点からの軌道弧長 */
  arcLen: number
  /** 軌道パラメータ（回転=x / 極座標=θ） */
  param: number
}

/** 飛行の終了理由 */
export type FlightEnd =
  | 'vanished' // 速度 0 で消滅
  | 'outOfField' // 場外へ到達
  | 'invalid' // 未定義/発散/非実数
  | 'maxParam' // 軌道を進み切った（場内で完結）

/** 飛行シミュレーションの結果 */
export interface Flight {
  samples: FlightSample[]
  end: FlightEnd
  endPos: Vec2
  endSpeed: number
}

/** 状態異常（§3.3）。持続は「ターン数」で管理 */
export interface StatusEffect {
  kind: 'flinch' | 'burn'
  /** |z| 由来の大きさ */
  magnitude: number
  remainingTurns: number
}

/** 敵 */
export interface Enemy {
  id: string
  name: string
  pos: Vec2
  hp: number
  maxHp: number
  /** 被ダメージ相性に使う防御属性 */
  element: Attribute
  hitboxRadius: number
  statuses: StatusEffect[]
  /** 得意関数の系統（#17：見た目で判別・AIが最適化する関数族） */
  family: EnemyFamily
  /** このターン敵が先出しする術式（軌道・初速）。AI が決める（互換のため保持） */
  castTrajectory: Trajectory
  castInitialSpeed: number
  /** 敵弾が帯びる z（高さ＝属性）。符号=属性, |z|=強度。光の敵は正・闇の敵は負 */
  castZ: number
}

/** 円（障害物の基本形・削り穴の両方に使う）。中心 (x,y)・半径 r。 */
export interface Disc {
  x: number
  y: number
  r: number
}

/**
 * 障害物（§3.7・#1/#16・Graph War 風）。形は solids（重なった円の和＝連続したブロブ）で表す。
 * 耐久値は持たず、魔法が当たった点を中心に円（carves）を引き算して物理的にえぐり取る
 * （＝solids にありつつ どの carves にも入らない点が「素材」。穴は滑らかな円形に削れる）。
 */
export interface Obstacle {
  id: string
  element: Attribute
  /** 基本形：重なった円の和（壁・柱の素材） */
  solids: Disc[]
  /** 魔法に削り取られた円（穴）。solids から引く */
  carves: Disc[]
}

/** 障害物を削った1回分の演出データ（#11：削る瞬間のパーティクル＆穴の開示）。 */
export interface CarveBurst {
  /** えぐった点（数学座標） */
  pos: Vec2
  /** えぐり半径 */
  r: number
  /** 弾がこの点に到達した弧長（アニメで開示タイミングを取る） */
  arcLen: number
  /** えぐった弾の属性（パーティクルの色） */
  attr: Attribute
  /** 削られた障害物ID（穴を正しい障害物に適用する） */
  obstacleId: string
}

/** 味方術者（#15：自陣営3人）。各自が配置（発射元）を持つ */
export interface Ally {
  id: string
  name: string
  /** 配置＝術者位置＝発射元（#14） */
  pos: Vec2
  hp: number
  maxHp: number
  /** 被ダメージ相性に使う防御属性 */
  element: Attribute
  statuses: StatusEffect[]
}

/** どのメカニクスを解禁しているか（段階的導入・機能17）。防御/パリィは軌道型に統合され常時 */
export interface Mechanics {
  obstacles: boolean
  enemyFire: boolean
}

/** ステージ定義（§5・機能14）。データは src/data/ に分離 */
export interface Stage {
  id: string
  name: string
  enemies: Enemy[]
  obstacles: Obstacle[]
  /** 導入テキスト（ステージ前） */
  introText: string[]
  /** クリアテキスト（ステージ後） */
  clearText: string[]
  mechanics: Mechanics
  /** ボス戦か（#6） */
  boss?: boolean
}

/** ターンのフェーズ（敵公開→作成→解決・§4） */
export type Phase = 'enemyReveal' | 'compose' | 'resolve'

/** 戦闘ログの1エントリ */
export interface LogEntry {
  kind:
    | 'info'
    | 'turn'
    | 'playerHit'
    | 'enemyHit'
    | 'misfire'
    | 'parry'
    | 'shield'
    | 'orbit'
    | 'obstacle'
    | 'status'
    | 'miss'
  text: string
}

/** 味方の発射（#4：関数を撃つだけ。ループなら防御も兼ねる）。trajectory は味方位置を origin に持つ */
export interface AllyCast {
  allyId: string
  trajectory: Trajectory
  initialSpeed: number
}

/** 戦闘状態（メモリ上のみ・永続化なし） */
export interface BattleState {
  stageIndex: number
  allies: Ally[]
  enemies: Enemy[]
  obstacles: Obstacle[]
  mechanics: Mechanics
  turn: number
  phase: Phase
  log: LogEntry[]
  outcome: 'ongoing' | 'cleared' | 'gameover'
}
