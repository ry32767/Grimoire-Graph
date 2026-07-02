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

/**
 * z 場（属性の高さ）＝位置の2変数関数 z=f(x,y)（#30/#21）。
 * 軌道（経路）とは別物で、弾が通る各点の (x,y) で評価して属性・強度・加速度を決める。
 * 符号で属性（+光/−闇）、|z| が V に近いほど強い（attribute.strengthOf）。未指定なら中立(0)。
 */
export type ZField = (x: number, y: number) => number

/** 敵の得意関数の系統（#17：見た目で判別）。直線/弧/波/渦＋昇り（指数）/捻れ（3/4次・#43）。 */
export type EnemyFamily = 'line' | 'arc' | 'wave' | 'spiral' | 'exp' | 'poly34'

/**
 * 敵の戦い方（#28/#42）。
 * - attacker：味方へ最大ダメージを狙う（既定）。障害物は避けて通る（迂回型）。
 * - breaker：壁を貫いてでも味方へ届かせる（障害物ペナルティを受けない・火力型）。
 * - guardian：自陣を守る防御用の周回結界を張り、味方弾を迎撃する（守護型）。
 * - ruptor：崩し手（暴発型）。z 場に極を仕込み、狙った対象の近傍で暴発を起こす。
 */
export type EnemyRole = 'attacker' | 'breaker' | 'guardian' | 'ruptor'

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
  /** 属性の z 場 z=f(x,y)（#30/#21）。未指定は中立(0)。経路上の位置で評価する */
  z?: ZField
}

/** 極座標方式の軌道：r=f(θ)（術者位置 origin を極の中心に・全方向） */
export interface PolarTrajectory {
  mode: 'polar'
  f: (theta: number) => number
  /** 極の中心（術者位置）。未指定は原点 */
  origin?: Vec2
  /** 属性の z 場 z=f(x,y)（#30/#21）。未指定は中立(0）。経路上の位置で評価する */
  z?: ZField
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
  /**
   * 得意関数を複数持つ場合の追加系統（#28：1～2個）。AI は family＋これらを全部試して最良を選ぶ。
   * 中盤以降の敵は複数を組み合わせて戦う。未指定なら family の1つだけ。
   */
  families?: EnemyFamily[]
  /** 戦い方（#28）。未指定は attacker。 */
  role?: EnemyRole
  /** このターン敵が先出しする術式（軌道・初速）。AI が決める（互換のため保持） */
  castTrajectory: Trajectory
  castInitialSpeed: number
  /** 敵弾の代表 z（符号=属性、UI/AI の基準）。実際の属性は castZField を位置で評価して決める */
  castZ: number
  /** 敵弾の z 場 z=f(x,y)（#28）。未指定なら定数 castZ の場として扱う */
  castZField?: ZField
  /**
   * 崩し手（#42）の狙い先。'obstacles' は味方でなく障害物（壁）を狙って暴発させる
   * （第4面の暴発デモ個体用：岩壁を吹き飛ばして見せる）。未指定は 'allies'。
   */
  ruptorTarget?: 'allies' | 'obstacles'
}

/** 円（障害物の基本形・削り穴の両方に使う）。中心 (x,y)・半径 r。 */
export interface Disc {
  x: number
  y: number
  r: number
}

/**
 * 壁の耐久種別（#40）。削れやすさ（えぐり半径・速度損）が変わる。
 * - normal：従来の属性付き壁（element=light/dark で相性が効く）。
 * - fragile：無属性の壊れやすい壁（一撃で大きく削れる）。
 * - tough：無属性の壊れにくい壁（最大火力でも貫通に複数発かかる目安）。
 * - unbreakable：壊れない壁（素材は削れず、当たった魔法はその場で止まる）。
 */
export type ObstacleKind = 'normal' | 'fragile' | 'tough' | 'unbreakable'

/**
 * 障害物（§3.7・#1/#16・Graph War 風）。形は solids（重なった円の和＝連続したブロブ）で表す。
 * 耐久値は持たず、魔法が当たった点を中心に円（carves）を引き算して物理的にえぐり取る
 * （＝solids にありつつ どの carves にも入らない点が「素材」。穴は滑らかな円形に削れる）。
 * kind で削れやすさが変わる（#40）。未指定は normal。
 */
export interface Obstacle {
  id: string
  element: Attribute
  /** 基本形：重なった円の和（壁・柱の素材） */
  solids: Disc[]
  /** 魔法に削り取られた円（穴）。solids から引く */
  carves: Disc[]
  /** 耐久種別（#40）。未指定は normal。 */
  kind?: ObstacleKind
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
  /**
   * 闇の周回で囲まれている重数（#35）。1 で敵の狙いがずれ、orbitConcealFull で視認不可。
   * 各ターンの周回で再計算される。未指定は 0。
   */
  concealed?: number
  /**
   * 闇の周回による敵の狙いのブレ幅 RMSE（#39）。囲む円の半径に連動（1重=半径/2、2重=半径）。
   * 敵はこの大きさだけ味方の見かけ位置をずらして狙う。未指定は 0。
   */
  concealRmse?: number
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

/**
 * 永続する周回結界（#39）。一度張った周回は破壊されるまでターンをまたいで残り、
 * 毎ターン内側へ効果（光=回復／闇=隠蔽）を及ぼし、敵弾を迎撃する。反対属性の弾に相殺されると消える。
 */
export interface ActiveOrbit {
  id: string
  /** 張った術者ID */
  ownerId: string
  owner: Owner
  /** リング点列（位置＋属性 z）。描画・囲み判定・迎撃に使う */
  ring: ZPoint[]
  /** 迎撃の相殺計算に使う代表速度（#21/#34） */
  ringSpeed: number
}

/** ターンのフェーズ（敵公開→作成→解決・§4） */
export type Phase = 'enemyReveal' | 'compose' | 'resolve'

/**
 * 浮かび上がるダメージ／回復の数値表示（#42）。
 * 色は属性色（光=金/闇=紫/中立=淡）、暴発=白、回復=緑。大きさは量に依存。
 */
export interface DamagePopup {
  /** 表示位置（数学座標・対象の位置） */
  pos: Vec2
  /** 量（ダメージ or 回復の絶対値） */
  amount: number
  /** 色の種別：属性色／暴発(misfire)=白／回復(heal)=緑 */
  kind: Attribute | 'misfire' | 'heal'
  /** 同期する対象ID（trigger='flash' のとき被弾フラッシュに合わせて出す） */
  targetId: string
  /** 出すタイミング：被弾フラッシュ／暴発の爆発／回復（固定） */
  trigger: 'flash' | 'misfire' | 'heal'
}

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
  /** 持続中の周回結界（#39：破壊されるまでターンをまたいで残る）。未指定は空。 */
  orbits?: ActiveOrbit[]
}
