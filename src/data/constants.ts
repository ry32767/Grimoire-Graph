// ゲームバランスの基礎定数（§3.4）。すべて調整対象。
// マジックナンバーはここに集約し、ロジック側にハードコードしない。

/** フィールド・物理の基礎定数 */
export const FIELD = {
  /** 場外境界：原点からこの半径外は「場外」＝暴発/消滅（ユニット・#8でスケール拡大） */
  rField: 20,
  /** 強度上限：|z| のクランプ上限（属性強度の最大） */
  sMax: 5,
  /** 中立しきい：|z| < epsilon を中立（光でも闇でもない） */
  epsilon: 0.3,
  /** 加速度上限：|z|≈0 での加速度（ユニット/秒²） */
  aMax: 9,
  /** 加速度基準：|z|≥zRef で加速度 0 */
  zRef: 5,
  /** 積分ステップ（秒）：固定 dt で数値安定 */
  dt: 1 / 60,
  /** 初速：毎回固定（#5）。スライダー廃止 */
  fixedSpeed: 7,
  /** 初速の最小・最大（互換用の安全境界・UIスライダーは廃止） */
  minSpeed: 3,
  maxSpeed: 10,
  /** 飛行速度の上限（加速で際限なく伸びるのを防ぐ・終端速度） */
  maxFlightSpeed: 17,
  /** 暴発の AoE 半径（ユニット） */
  aoeRadius: 2.6,
} as const

/** 極性相性倍率（§3.2） */
export const AFFINITY = {
  /** 反対極（光↔闇）×1.5（有効） */
  opposite: 1.5,
  /** 同極 ×0.5（吸収・耐性） */
  same: 0.5,
  /** 中立 ×1.0 */
  neutral: 1.0,
} as const

/** 戦闘イベントの係数（§3.3 / §3.6 / §3.7 / §3.8） */
export const COMBAT = {
  /** 障害物衝突1回あたりの速度減 Δv_obs（×相性で増減） */
  obstacleSpeedLoss: 2,
  /** パリィ相殺：相手の威力 × この係数 を自分の速度から削る */
  parryLossScale: 0.25,
  /** シールドが敵弾速度を削る基本量（×相性で増減） */
  shieldSpeedLoss: 3,
  /** ひるみ（光）の基本ターン数。|z| でスケール */
  flinchBaseTurns: 1,
  /** 継続ダメージ（闇）の継続ターン数 */
  burnTurns: 3,
  /** 継続ダメージ総量 = |z| × burnScale を burnTurns に分割 */
  burnScale: 2,
} as const

/** ゲーム進行の基礎値 */
export const GAME = {
  /** プレイヤー最大HP（各ステージ開始時に回復・15分3ステージ想定） */
  playerMaxHp: 120,
  /** 敵の既定ヒットボックス半径（ユニット） */
  enemyHitbox: 1.1,
} as const

/** 軌道サンプリング設定（coords） */
export const SAMPLING = {
  /** 回転方式：ローカル x の最大（R_field の少し外まで・#8で拡大） */
  rotateXMax: 32,
  /** 回転方式：x の刻み幅 */
  rotateStep: 0.08,
  /** 極座標方式：θ の最大（らせん・バラ曲線が一周以上展開できるよう広めに） */
  polarThetaMax: 4 * Math.PI,
  /** 極座標方式：θ の刻み幅 */
  polarStep: 0.02,
  /** 物理積分の最大フレーム数（無限ループ防止の安全弁） */
  maxFrames: 4000,
} as const
