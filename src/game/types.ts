// ゲーム全体で共有するドメイン型。ここは他モジュールに依存しない（循環回避）。

/** 2D ベクトル（数学座標。原点 O=(0,0)＝術者） */
export interface Vec2 {
  x: number
  y: number
}

/** 属性タイプ：命中位置の z 符号で決定（§3.2） */
export type Attribute = 'light' | 'dark' | 'neutral'

/** 発射方式：回転（y=g(x) をθ回転）／極座標（r=f(θ)） */
export type FireMode = 'rotate' | 'polar'

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
  /** このターン敵が先出しする術式（軌道・初速）。AI が決める */
  castTrajectory: Trajectory
  castInitialSpeed: number
  /** 敵弾が帯びる z（高さ＝属性）。符号=属性, |z|=強度。光の敵は正・闇の敵は負 */
  castZ: number
}

/** 属性付き障害物（§3.7・#1/#16：被弾で半径が削れる） */
export interface Obstacle {
  id: string
  pos: Vec2
  hitboxRadius: number
  element: Attribute
  durability: number
  maxDurability: number
  /** 初期半径（半径は耐久比に連動して縮む）。未指定は hitboxRadius を初期値とみなす */
  maxRadius?: number
}

/** 閉曲線シールド（§3.6） */
export interface Shield {
  shape: 'circle' | 'ellipse'
  /** circle: R / ellipse: a,b */
  params: { R?: number; a?: number; b?: number }
  element: Attribute
  durability: number
  maxDurability: number
}

/** プレイヤーの状態 */
export interface PlayerState {
  hp: number
  maxHp: number
  statuses: StatusEffect[]
  shield: Shield | null
}

/** どのメカニクスを解禁しているか（段階的導入・機能17） */
export interface Mechanics {
  obstacles: boolean
  shield: boolean
  enemyFire: boolean
  parry: boolean
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
  /** 「困ったらこれ」のおすすめ関数プリセットID（機能17） */
  recommendedPresetId: string
  /** おすすめ関数の係数（未指定ならプリセット既定値） */
  recommendedCoeffs?: Record<string, number>
  /** おすすめ関数の初速（未指定なら中速） */
  recommendedSpeed?: number
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
    | 'obstacle'
    | 'status'
    | 'miss'
  text: string
}

/** プレイヤーの行動：攻撃（術式発射）か防御（結界展開）（行動枠は1つ） */
export type PlayerAction =
  | { kind: 'attack'; trajectory: Trajectory; initialSpeed: number }
  | { kind: 'shield'; shield: Shield }

/** 戦闘状態（メモリ上のみ・永続化なし） */
export interface BattleState {
  stageIndex: number
  player: PlayerState
  enemies: Enemy[]
  obstacles: Obstacle[]
  mechanics: Mechanics
  turn: number
  phase: Phase
  log: LogEntry[]
  outcome: 'ongoing' | 'cleared' | 'gameover'
}
