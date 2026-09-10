import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type {
  Ally,
  Attribute,
  CarveBurst,
  DamagePopup,
  Disc,
  Enemy,
  EnemySpecies,
  Obstacle,
  Vec2,
  ZPoint,
} from '../game/types'
import { toScreen, toMath, type Viewport } from '../game/coords'
import {
  drawScene,
  drawBullet,
  drawMisfire,
  drawFallingDebris,
  drawCarveBurst,
  drawClashSpark,
  drawOrbitDissipation,
  drawBulletDissipation,
  drawEnemyDeath,
  drawBossCollapse,
  powerSizeFrac,
  type BossView,
  type SceneParams,
} from '../render/draw'
import {
  drawAimArrow,
  drawDamageNumber,
  drawDarkVeil,
  drawLightAura,
  drawEnemyHpBars,
  drawFlightPath,
  drawImpactShockwave,
  drawLaunchFlash,
  drawOrbitRing,
  drawParryBurst,
  drawPowerSmoke,
  drawSpeedSparks,
  type DarkRing,
  type LightRing,
  type PreviewPoint,
  type RingPhaseStore,
} from '../render/board'
import { seedRingPhases } from '../render/ringPhase'
import { gameTimeAtArcLen } from '../render/effectTiming'
import {
  activeDeathIds,
  animationEndTime,
  deathTime,
  ringBreakTime,
  ringVisible,
  timedOnly,
} from '../render/sceneTiming'
import { ringAverageAttr, ringEncloses, ringRadius, type RingPoint } from '../game/orbit'
import { COLORS } from '../render/theme'
import { COMBAT, FIELD, GAME } from '../data/constants'
import { speciesOf, tierOf } from '../render/species'
import { golemEyeColor, type ConcealView } from '../render/draw'

/** 盤面キャンバスの既定サイズ（実測前の1フレームだけ使う保険値）。 */
const FALLBACK_SIZE = { w: 640, h: 480 }

/** アニメ用サンプル列を、盤面描画が使うプレビュー点列（弧長つき）へ読み替える。 */
function previewPointsOf(samples: AnimSample[]): PreviewPoint[] {
  return samples.map((s) => ({ pos: s.pos, z: s.z, speed: s.speed, arcLen: s.arcLen }))
}

/** 弾の1サンプル（位置・速度・弧長・z）。速度で演出のペースを物理に一致させる（#7）。 */
export interface AnimSample {
  pos: Vec2
  speed: number
  arcLen: number
  /** その点の z（属性の高さ）。発射時の色/形に使う（#21） */
  z: number
}

/** 命中した対象（赤フラッシュ＋揺れ・#20）。弾がこの弧長に達した瞬間に対象が反応する。 */
export interface AnimImpact {
  id: string
  side: 'ally' | 'enemy'
  arcLen: number
}

/** アニメーション用の1発（発射型／敵弾） */
export interface AnimBullet {
  samples: AnimSample[]
  side: 'ally' | 'enemy'
  misfirePos: Vec2 | null
  /** この弾が障害物を削った点（弧長つき。到達時に穴を開示しパーティクルを出す・#11） */
  carves: CarveBurst[]
  /** 命中して対象を反応させる情報（#20。貫通で複数命中しうる。外れ/暴発は空配列） */
  impacts: AnimImpact[]
  /** 速度0で霧散したか（#38：終端で小さくなって散る演出。暴発時は出さない） */
  vanished?: boolean
}

/** 壁を削った破片が散って消えるまでの時間（ms・#45）。弾が壁で止まっても必ずこの時間で消える */
const CARVE_BURST_MS = 480

/** 暴発の大爆発を見せる余韻（弾の到達後にこの時間だけ爆発を展開・#9/#29） */
const MISFIRE_TAIL_MS = 1000

/** 命中の赤フラッシュ＋揺れを見せる余韻（撃破でも演出を見せてから遷移・#20） */
const IMPACT_TAIL_MS = 450

/** 軌道型リング */
export interface AnimOrbit {
  ring: ZPoint[]
  /** 掃射で当てた敵ID群（赤フラッシュ＋揺れ・#20） */
  hitEnemyIds: string[]
  /** 周回が壁に触れて散った点（#34） */
  carves: CarveBurst[]
  /** 壁に当たって霧散したか（#34）。true なら周回せず、一度きり外へ散って消える */
  broken?: boolean
  /** リングの代表速度（#21：威力＝速度×強度で粒の大きさを変える） */
  speed?: number
  /**
   * 霧散した**ゲーム時刻**（秒・#72）。エンジン（resolveTurn）が返す実際の接触時刻で、
   * 演出はこの時刻ちょうどから散り始める。null のときだけ従来の既定タイミングへ落とす。
   */
  breakT?: number | null
  /** 所有者（#61/#72）。粒の流れる向き・闇幕の扱いに使う */
  owner?: 'player' | 'enemy'
  /** 壁・失速で回り出す前に自壊した＝結界は一度も存在しなかった（#75）。true ならリングも霧散演出も描かない */
  bornBroken?: boolean
}

/** 被弾フラッシュの減衰時間（ms）。一瞬赤く光って揺れて戻る（#20） */
const FLASH_MS = 420

/** パリィ／結界の衝突火花の持続（ms・#20）。発火時刻はエンジンの衝突時刻をそのまま使う（#72） */
const CLASH_MS = 460
/** 相殺（パリィ）演出の持続（ms・v3）。二重の衝撃波と破片が広がりきるまで */
const PARRY_MS = 900

/** 周回が壁/魔法に負けて霧散する演出の持続（ms・#34）。接触の瞬間から散り始める */
const DISSIPATE_MS = 520

/**
 * このターンに撃破された敵の消滅演出（05c §6.5・#46）。当たり判定には影響しない描画情報のみ。
 * 撃破された位置で species/element/tier 別の消滅アニメを再生する。boss は専用の最終崩壊。
 */
export interface EnemyDeath {
  id: string
  pos: Vec2
  species: EnemySpecies
  element: Attribute
  tier: 1 | 2 | 3
  hitboxRadius: number
  boss?: boolean
}

export interface ResolveAnimation {
  bullets: AnimBullet[]
  orbits: AnimOrbit[]
  /** 弾・結界の衝突点・威力・**ゲーム時刻**（#20/#38/#72：パリィ/迎撃の火花） */
  clashes?: { pos: Vec2; power: number; t: number }[]
  /** ダメージ／回復の数値表示（#42） */
  popups?: DamagePopup[]
  /** このターン撃破された敵の消滅演出（05c §6.5・#46） */
  deaths?: EnemyDeath[]
  /** ボスの多段外見（#51）に渡す状態（bossPhase・finale・outcome） */
  bossView?: BossView
}

/** 撃破演出の持続（ms・#46）。被弾フラッシュの後に消滅アニメを見せる余韻。 */
const DEATH_MS = 900
/** ボスの最終崩壊の持続（ms・#51）。装甲落下→粒子ほどけ→天秤水平まで長めに引き伸ばす。 */
const BOSS_COLLAPSE_MS = 2200

/** 数値ポップの色（属性色／暴発=白／回復=緑・#42）。 */
function popupColor(kind: DamagePopup['kind']): string {
  if (kind === 'heal') return '#5ad16a'
  if (kind === 'misfire') return '#ffffff'
  if (kind === 'light') return COLORS.light1
  if (kind === 'dark') return '#b483ff'
  return '#e2e2f0' // 中立
}

/** 数値ポップの表示時間（ms・#42）。 */
const POPUP_MS = 950

/** 持続中の周回結界（#39：作成フェーズでも常時表示し、闇は内側を暗くぼかす）。 */
export interface StandingOrbit {
  ring: ZPoint[]
  speed: number
  /** 所有者（#61）。敵の闇結界は作成フェーズで視認阻害を強める（z場/予測経路を隠す）。 */
  owner?: 'player' | 'enemy'
}

interface Props {
  allies: Ally[]
  enemies: Enemy[]
  obstacles: Obstacle[]
  /** 現在の場の半径（#49・06b §5.5）。面/ボスフェーズで可変。ビューポート倍率に使う。未指定は既定 rField */
  rField?: number
  activeAllyId?: string | null
  playerPaths?: (ZPoint[] | null)[]
  /** 各味方の暴発（関数エラー）点。プレビューで赤い✕として可視化する（#30） */
  misfirePoints?: (Vec2 | null)[]
  ghostPaths?: Vec2[][]
  /** 崩し手（#42）の暴発予告点（赤✕＋揺れる円）。無い敵は null */
  ghostMisfires?: (Vec2 | null)[]
  /** ステージの異変の段階（04b §4b.2：0=静か〜3=崩壊目前）。背景の歪み・ひびで危うさを示す */
  anomaly?: number
  /** 崩壊への接近度 0..1（04b §4b.3）。暴発時の画面の揺れ・瓦礫の量がこれでスケールする */
  doom?: number
  /** 破局（致死崩壊・04b §4b.2）：true でステージ全体を覆う暴発演出を再生し、完了で onCollapseDone */
  collapse?: boolean
  onCollapseDone?: () => void
  /** 暴発半径のブレ帯（04b §4b.3）。プレビューの✕の周りにぼやけた二重リングを描く */
  misfireBand?: { min: number; max: number }
  /** 編集中の z 場（#37）。場がエラーになる地点（極・定義域外）を赤で示すのに使う */
  zField?: (x: number, y: number) => number
  /** z 場を表示するか（#37）。作成フェーズ中は常に true（#55） */
  showZField?: boolean
  /**
   * z(t)（t＝アクティブ術者からの飛行距離）。盤面に同心円として全開示する（v3 の主役）。
   * z を「距離の関数」で書いているときだけ渡す。
   */
  zOfT?: ((t: number) => number) | null
  /**
   * プレビュー軌道を最後まで見せるか（既定 false＝出だしだけ）。
   * 既定では「z(t) は完全情報／当たるかは撃つまで分からない」という設計に従う。
   */
  previewFull?: boolean
  /** 持続中の周回結界（#39）。作成フェーズで常時描画＋闇は視認性低下の幕をかける */
  standingOrbits?: StandingOrbit[]
  animation?: ResolveAnimation | null
  onAnimationDone?: () => void
  /** 通過点フィットで選んだ点（#46）。作成フェーズで✛として表示する */
  fitPoints?: Vec2[]
  /** フィールドをクリックした時の数学座標を返す（#46：点ピック中だけ渡す） */
  onFieldClick?: (mathPos: Vec2) => void
  /** フィールドをクリック／ドラッグして発射方向を決める（#47：点ピック中でない時だけ渡す） */
  onAim?: (mathPos: Vec2) => void
  /** 発射方向インジケータ用の角度（#47・回転のみ）。active ally から伸ばす矢印を描く */
  aimAngle?: number
  /** 通過点ピック中か（#49）。true の間はドラッグでルーペを出し、離した位置を点にする */
  pickMode?: boolean
  /**
   * プレイバック制御（見返し用）。指定するとアニメの時計を外から止める／飛ばす／速さを変えられる。
   * seekMs を変えるたびにその位置へ飛ぶ（同じ値のままなら再生を続ける）。
   */
  playback?: PlaybackControl
  /** 毎フレームの再生位置と全体長（ms）を返す。スライダーの目盛りに使う */
  onPlaybackTick?: (posMs: number, totalMs: number) => void
  /** 見返しモード：終端に達しても onAnimationDone を呼ばず、その位置に留まる */
  replay?: boolean
  /** 射線上の敵ID（頭上の HP バーを金色で強調する） */
  aimEnemyId?: string | null
}

/** プレイバック（見返し）の制御値。 */
export interface PlaybackControl {
  paused: boolean
  /** シーク位置（ms） */
  seekMs: number
  /** シーク要求の通し番号。値が変わった瞬間だけ seekMs へ飛ぶ（同じ位置への再シークも効く） */
  seekToken: number
  /** 再生速度（1 / 0.5 / 0.25） */
  rate: number
}

const MS_PER_GAMESEC = 360
const MIN_MS = 700
const MAX_MS = 2300

/**
 * 弾サンプルから「各点までの到達ゲーム時間」を積分する（#72）。
 * **エンジンの physics.flightTimes と同一の定義**（Σ ds/v の台形積分）を使う＝
 * resolveTurn が返すイベント時刻（パリィ・結界の霧散・暴発）と同じ時間軸に乗る。
 * 失速（v≈0）した先へは進めないので、その点で時刻を止める（サンプルもそこで終わっている）。
 */
function buildTimeline(samples: AnimSample[]): { tCum: number[]; total: number } {
  const tCum = [0]
  let stalled = false
  for (let i = 1; i < samples.length; i++) {
    const ds = samples[i].arcLen - samples[i - 1].arcLen
    const v = (samples[i].speed + samples[i - 1].speed) / 2
    if (stalled || v <= 1e-9) {
      stalled = true
      tCum.push(tCum[i - 1])
    } else {
      tCum.push(tCum[i - 1] + ds / v)
    }
  }
  return { tCum, total: tCum[tCum.length - 1] || 0 }
}

/** ゲーム時間 τ における弾の位置・サンプル index・弧長（速度に応じて進む）。 */
function posAtTime(
  samples: AnimSample[],
  tCum: number[],
  total: number,
  tau: number,
): { pos: Vec2; idx: number; arcLen: number } {
  if (samples.length === 0) return { pos: { x: 0, y: 0 }, idx: 0, arcLen: 0 }
  if (tau >= total) {
    const last = samples[samples.length - 1]
    return { pos: last.pos, idx: samples.length - 1, arcLen: last.arcLen }
  }
  let j = 0
  while (j < tCum.length - 1 && tCum[j + 1] <= tau) j++
  const a = samples[j]
  const b = samples[Math.min(j + 1, samples.length - 1)]
  const span = tCum[j + 1] - tCum[j]
  const f = span > 0 ? (tau - tCum[j]) / span : 0
  return {
    pos: { x: a.pos.x + (b.pos.x - a.pos.x) * f, y: a.pos.y + (b.pos.y - a.pos.y) * f },
    idx: j,
    arcLen: a.arcLen + (b.arcLen - a.arcLen) * f,
  }
}

export default function BattleCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const aimingRef = useRef(false)
  // #49：点ピックのルーペ。現在の指位置（数学座標）と、作成フェーズの再描画関数
  const pickPosRef = useRef<Vec2 | null>(null)
  const composeDrawRef = useRef<(() => void) | null>(null)
  const lastTrailRef = useRef(0)
  const doneRef = useRef(props.onAnimationDone)
  doneRef.current = props.onAnimationDone
  // プレイバック制御は「毎フレーム読む値」なので ref で渡す（依存に入れるとアニメが作り直されるため）
  const playbackRef = useRef(props.playback)
  playbackRef.current = props.playback
  const tickRef = useRef(props.onPlaybackTick)
  tickRef.current = props.onPlaybackTick
  const replayRef = useRef(props.replay)
  replayRef.current = props.replay
  // 結界の粒の位相をフレーム間で持ち越す（v3：粒がその場の速度で流れる）
  const ringStoreRef = useRef<RingPhaseStore>({})
  // 前ターンの軌跡（残像）。解決アニメを組んだ時点で記録し、次の作成フェーズでうっすら残す（v3）
  const trailsRef = useRef<ZPoint[][]>([])

  // 盤面の手動ズーム/パン（拡大縮小して見やすくする）。大アリーナ（rField 最大60）で有効。
  const [view, setView] = useState<{ zoom: number; pan: Vec2 }>({ zoom: 1, pan: { x: 0, y: 0 } })
  const rField = props.rField ?? FIELD.rField
  // 場が変わった（面/フェーズ遷移）らズームを初期化
  useEffect(() => {
    setView({ zoom: 1, pan: { x: 0, y: 0 } })
  }, [rField])

  // 盤面はコンテナ全面（DC プロトタイプ v3）。CSS ピクセルの実寸を測り、DPR ぶんだけ内部解像度を上げる。
  const [size, setSize] = useState<{ w: number; h: number }>(FALLBACK_SIZE)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const parent = canvas.parentElement ?? canvas
    const measure = () => {
      const w = Math.max(1, Math.round(parent.clientWidth))
      const h = Math.max(1, Math.round(parent.clientHeight))
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])
  // 内部解像度（DPR）を実寸に合わせる。描画は常に CSS ピクセル座標系で行う（setTransform）。
  const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1)
  const prepare = (ctx: CanvasRenderingContext2D): void => {
    const canvas = ctx.canvas
    const w = Math.round(size.w * dpr)
    const h = Math.round(size.h * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false
  }

  // ビューポート（#49・06b §5.5）：場の半径 props.rField で倍率が決まる。面/フェーズで可変。
  // 手動ズーム/パンを反映（zoom=1・pan=0 なら従来どおり場全体がちょうど収まる）。
  const vp: Viewport = { width: size.w, height: size.h, unitsRadius: rField, zoom: view.zoom, pan: view.pan }

  // アクティブ術者（z 場の同心円・射線・プレビュー帯の中心）
  const activeAlly = props.activeAllyId
    ? props.allies.find((a) => a.id === props.activeAllyId && a.hp > 0) ?? null
    : null
  const activeIndex = activeAlly ? props.allies.filter((a) => a.hp > 0).findIndex((a) => a.id === activeAlly.id) : -1
  const previewPath = activeIndex >= 0 ? props.playerPaths?.[activeIndex] ?? null : null
  const aimTarget = props.aimEnemyId
    ? props.enemies.find((e) => e.id === props.aimEnemyId) ?? null
    : props.enemies.find((e) => e.hp > 0) ?? null

  // 闇の結界に隠されている単位（#73）。ぼかし（闇幕）＋分身で「座標がぶれる」ことを見せる。
  //  - 敵：こちらの視界が敵の闇結界に阻まれる（RMSE ＝ リング半径/2・engine と同じ式）
  //  - 味方：敵から見えにくくなっている（engine が付けた concealed / concealRmse をそのまま使う）
  const standing = props.standingOrbits ?? []
  const darkStanding = standing.filter((o) => o.ring.length >= 3 && ringAverageAttr(o.ring) === 'dark')
  const concealViews: ConcealView[] = []
  for (const e of props.enemies) {
    if (e.hp <= 0) continue
    const inside = darkStanding
      .filter((o) => o.owner === 'enemy' && ringEncloses(o.ring as RingPoint[], e.pos))
      .map((o) => ringRadius(o.ring as RingPoint[]))
      .sort((a, b) => a - b)
      .slice(0, COMBAT.orbitConcealFull)
    if (inside.length === 0) continue
    concealViews.push({
      id: e.id,
      pos: e.pos,
      side: 'enemy',
      layers: inside.length,
      rmse: inside.reduce((sum, r) => sum + r / 2, 0),
      radius: e.hitboxRadius,
      look: { species: speciesOf(e), tier: tierOf(e.level), element: e.element, eye: golemEyeColor(e) },
    })
  }
  for (const a of props.allies) {
    if (a.hp <= 0 || !a.concealed || a.concealed <= 0) continue
    concealViews.push({
      id: a.id,
      pos: a.pos,
      side: 'ally',
      layers: a.concealed,
      rmse: a.concealRmse ?? 0,
      radius: GAME.allyHitbox,
    })
  }
  const lightStanding: LightRing[] = standing
    .filter((o) => o.ring.length >= 3 && ringAverageAttr(o.ring) === 'light')
    .map((o) => ({ ring: o.ring, owner: o.owner === 'enemy' ? 'enemy' : 'ally' }))

  const staticParams: SceneParams = {
    vp,
    allies: props.allies,
    enemies: props.enemies,
    obstacles: props.obstacles,
    activeAllyId: props.activeAllyId,
    misfirePoints: props.misfirePoints,
    ghostPaths: props.ghostPaths,
    ghostMisfires: props.ghostMisfires,
    anomaly: props.anomaly,
    misfireBand: props.misfireBand,
    zField: props.zField,
    showZField: props.showZField,
    zRings:
      activeAlly && props.zOfT
        ? { casterPos: activeAlly.pos, zOfT: props.zOfT, targetPos: aimTarget?.pos ?? null }
        : undefined,
    rayAxis: activeAlly && props.aimAngle !== undefined ? { pos: activeAlly.pos, angle: props.aimAngle } : null,
    previewPath,
    previewFull: props.previewFull,
    conceal: concealViews,
  }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (props.collapse) return // 破局（致死崩壊）演出中は専用エフェクトがキャンバスを占有する

    if (!props.animation) {
      // 作成フェーズ：持続周回があれば粒を回し続ける（#39）。無ければ1回だけ描画（z場プレビュー含む・#37）。
      const drawComposeFrame = (trailPhase: number) => {
        lastTrailRef.current = trailPhase
        prepare(ctx)
        drawScene(ctx, { ...staticParams, trailPhase, trails: trailsRef.current })
        // 光の結界：内側に癒やしの場（昇る光の粒）。重なりは「二重回復」（#73）
        drawLightAura(ctx, vp, lightStanding, trailPhase)
        // 結界（周回）：帯の太さ・明るさが区間ごとの速度を語り、粒がその場の速度で流れる（v3）
        for (const o of standing) {
          drawOrbitRing(ctx, vp, o.ring, o.owner === 'enemy' ? 'enemy' : 'ally', ringStoreRef.current)
        }
        // 闇結界の視認阻害（#39/#61/#62）：1重＝幕＋ざらつき／2重＝真っ黒＋「視認不能」
        const darkRings: DarkRing[] = standing
          .filter((o) => ringAverageAttr(o.ring) === 'dark')
          .map((o) => ({ ring: o.ring, owner: o.owner === 'enemy' ? 'enemy' : 'ally' }))
        drawDarkVeil(ctx, vp, darkRings, trailPhase)
        // 発射方向インジケータ（#47）：active ally から θ 方向へ矢印
        if (props.aimAngle !== undefined && activeAlly) drawAimArrow(ctx, vp, activeAlly.pos, props.aimAngle)
        // 敵ごとの残り HP は頭の上（盤面の隅にウィンドウを置かない）
        drawEnemyHpBars(ctx, vp, props.enemies, undefined, props.aimEnemyId)
        // 通過点フィットの選択点を✛で表示（#46）
        drawFitPoints(ctx, props.fitPoints, vp)
        // 点ピック中は指の上に拡大鏡（ルーペ）を出す（#49：指で点が隠れない）
        if (pickPosRef.current) drawPickLoupe(ctx, pickPosRef.current, vp)
      }
      // ポインタ移動時に手動で再描画できるよう関数を保持
      composeDrawRef.current = () => drawComposeFrame(lastTrailRef.current)
      // 崩し手の予告円（#42）と異変（04b）は揺れ続けるので、ある間はアニメーションループを回す
      const hasRuptureWarning = (props.ghostMisfires ?? []).some(Boolean)
      const hasAnomaly = (props.anomaly ?? 0) > 0
      if (standing.length === 0 && !hasRuptureWarning && !hasAnomaly) {
        drawComposeFrame(0)
        return () => {
          composeDrawRef.current = null
        }
      }
      let raf = 0
      const start = performance.now()
      const loop = (now: number) => {
        drawComposeFrame((now - start) * 0.004)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return () => {
        composeDrawRef.current = null
        cancelAnimationFrame(raf)
      }
    }

    const anim = props.animation
    // 前ターンの軌跡（残像）として、この解決の飛行経路を控えておく（次の作成フェーズで薄く残る）
    trailsRef.current = anim.bullets
      .filter((b) => b.samples.length > 1)
      .map((b) => b.samples.map((sm) => ({ pos: sm.pos, z: sm.z })))
    // 各弾の時間軸を構築。最も時間のかかる弾でアニメーション窓を決める（速い弾は先に着く＝#7）
    const timelines = anim.bullets.map((b) => buildTimeline(b.samples))
    // エンジンが返すイベント時刻（相殺・結界の霧散）も時間窓に含める＝弾が居ないターンでも
    // 演出が窓の外へはみ出さない（#72）
    const popups = timedOnly(anim.popups ?? [])
    const eventTimes: number[] = [
      ...(anim.clashes ?? []).map((c) => c.t),
      ...anim.orbits.map((o) => o.breakT ?? 0),
      ...popups.map((p) => p.t),
    ].filter((t) => Number.isFinite(t))
    const maxTotal = Math.max(0.001, ...timelines.map((t) => t.total), ...eventTimes)
    // 軌道型がある時は周回が見えるよう窓を長めに確保（#24）
    const hasOrbit = anim.orbits.length > 0
    const floorMs = hasOrbit ? 1600 : MIN_MS
    const flightMs = Math.min(MAX_MS, Math.max(floorMs, maxTotal * MS_PER_GAMESEC))

    /** ゲーム秒（エンジンのイベント時刻）→ アニメの実時間 ms（#72）。 */
    const msOfGameTime = (t: number): number =>
      Math.max(0, Math.min(flightMs, (t / maxTotal) * flightMs))

    // ダメージ／回復の数値（#42）：発生ゲーム秒 p.t をそのまま実時間へ写す（#75）
    // 弾の到達後に演出を見せる余韻：暴発は大きく、命中は短く確保する（#9/#29/#20）
    const hasMisfire = anim.bullets.some((b) => b.misfirePos)
    const hasImpact =
      anim.bullets.some((b) => b.impacts.length > 0) || anim.orbits.some((o) => o.hitEnemyIds.length > 0)
    const hasClash = !!anim.clashes && anim.clashes.length > 0
    const hasBrokenOrbit = anim.orbits.some((o) => o.broken)
    // 発射魔法の霧散（速度0）にも余韻を確保する（#38。貫通のため命中と霧散は両立しうる）
    const hasVanish = anim.bullets.some((b) => b.vanished && !b.misfirePos)
    const baseTail = hasMisfire
      ? MISFIRE_TAIL_MS
      : hasBrokenOrbit || hasVanish
        ? Math.max(IMPACT_TAIL_MS, DISSIPATE_MS + 150)
        : hasImpact || hasClash
          ? IMPACT_TAIL_MS
          : 0
    // ダメージ／回復の数値を最後まで見せる余韻を確保する（#42/#75）：最後のポップの開始時刻＋表示時間で決める
    const popupStartMs = popups.map((p) => msOfGameTime(p.t))
    // 撃破演出（#46/#51）の余韻：フラッシュ（余韻の頭）に続けて消滅アニメを見せる。
    const deaths = anim.deaths ?? []
    const deathStartMs = deaths.map((d) => {
      const lastHitT = deathTime(popups, d.id)
      return lastHitT === null ? 0.9 * flightMs : msOfGameTime(lastHitT)
    })
    const realMs = animationEndTime({
      flightMs,
      baseTailMs: baseTail,
      popupStartMs,
      popupDurationMs: POPUP_MS,
      popupPaddingMs: 300,
      deathEndMs: deaths.map((d, i) => deathStartMs[i] + (d.boss ? BOSS_COLLAPSE_MS : DEATH_MS)),
    })

    /**
     * 弾 i がその弧長へ届く実時間 ms（#70）。演出の開始時刻を「経過時刻から引ける値」にするための要。
     * これまでは到達したフレームの現在時刻をラッチしていたため、見返しで時刻を飛ばすと
     * その時点で進行中だったはずの演出が出せなかった。
     */
    const msAtArc = (i: number, arcLen: number): number => {
      const b = anim.bullets[i]
      if (!b || b.samples.length === 0) return 0
      return msOfGameTime(gameTimeAtArcLen(b.samples, timelines[i].tCum, arcLen))
    }

    // 被弾フラッシュ：対象IDごとに「反応を開始した実時刻」を記録し、以後減衰させる（#20）。
    // ※ ダメージ数値のポップはここに依らず p.t を直接使う（#75。1体に2発当たった時のズレ対策）
    const flashStartByTarget: Record<string, number> = {}
    // 衝突火花：clash ごとに「弾がその点へ到達した実時刻」を記録し、その瞬間から弾けさせる（#20）
    const clashStartByIdx: Record<number, number> = {}
    // 霧散：負けた周回ごとに「接触の実時刻」を記録し、その瞬間から散らせる（#34）
    const dissipateStartByIdx: Record<number, number> = {}
    // 壁を削った破片：carve ごとに「弾が到達した実時刻」を記録し、一定時間で散って消す（#45）。
    // 弧長だけで判定すると弾が壁で止まった地点に破片が永久に残る不具合があった。
    const carveStartByKey: Record<string, number> = {}
    // 撃破演出（#46/#51）：敵IDごとに「消滅を開始した実時刻」を記録し、以後 progress で進める。
    const deathStartById: Record<string, number> = {}

    // ダメージ／回復の数値（#42）：同じ対象・契機のポップは縦に積む（重なり防止）
    const popupOrd: number[] = []
    const ordCount: Record<string, number> = {}
    for (const p of popups) {
      const k = `${p.targetId}|${p.trigger}`
      const o = ordCount[k] ?? 0
      ordCount[k] = o + 1
      popupOrd.push(o)
    }

    let raf = 0
    let finished = false
    const start = performance.now()
    // 外部プレイバック用の時計。制御が無いときは実時間そのまま（従来と同じ挙動）。
    let clock = 0
    let prevNow = start
    let lastSeekToken = playbackRef.current?.seekToken ?? -1

    const finish = () => {
      if (finished) return
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      doneRef.current?.()
    }

    const frame = (now: number) => {
      const dt = Math.max(0, now - prevNow)
      prevNow = now
      const pb = playbackRef.current
      if (pb) {
        if (pb.seekToken !== lastSeekToken) {
          lastSeekToken = pb.seekToken
          clock = pb.seekMs
          for (const k of Object.keys(flashStartByTarget)) delete flashStartByTarget[k]
          for (const k of Object.keys(clashStartByIdx)) delete clashStartByIdx[Number(k)]
          for (const k of Object.keys(dissipateStartByIdx)) delete dissipateStartByIdx[Number(k)]
          for (const k of Object.keys(carveStartByKey)) delete carveStartByKey[k]
          for (const k of Object.keys(deathStartById)) delete deathStartById[k]
          // 結界リングの粒は持ち越し状態。位相は毎フレーム seedRingPhases で組み直すが、
          // 消えた結界のぶんが残らないようシークのたびに掃除する（#69）
          for (const k of Object.keys(ringStoreRef.current)) delete ringStoreRef.current[k]
        } else if (!pb.paused) {
          clock += dt * (pb.rate || 1)
        }
      } else {
        clock = now - start
      }
      const elapsed = Math.max(0, Math.min(clock, realMs))
      tickRef.current?.(elapsed, realMs)
      // 飛行は flightMs で進み切る。余韻（暴発）中は弾は終端で静止する。
      const e = Math.min(1, elapsed / flightMs)
      const tau = e * maxTotal
      const phase = e * flightMs * 0.02
      // 軌跡の波・粒は実時間でゆっくり流す（作成フェーズと同じ流速。速いとチカチカするため・#11）
      const trailPhase = elapsed * 0.004

      // 各弾の現在位置・弧長を先に計算（穴の開示・削るパーティクルに使う）
      const states = anim.bullets.map((b, i) =>
        b.samples.length ? posAtTime(b.samples, timelines[i].tCum, timelines[i].total, tau) : null,
      )

      // 障害物の穴を進行に応じて開示：弾が到達した（弧長を越えた）carve だけ反映する
      const revealed: Record<string, Disc[]> = {}
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st) return
        for (const cv of b.carves) {
          if (cv.arcLen > st.arcLen) continue
          if (!revealed[cv.obstacleId]) revealed[cv.obstacleId] = []
          revealed[cv.obstacleId].push({ x: cv.pos.x, y: cv.pos.y, r: cv.r })
        }
      })
      const obstacles = props.obstacles.map((o) =>
        revealed[o.id] ? { ...o, carves: [...o.carves, ...revealed[o.id]] } : o,
      )

      // 被弾の検出：弾が命中弧長に達したら対象の反応を開始（#20。貫通で複数対象に届きうる）
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st) return
        for (const im of b.impacts) {
          if (st.arcLen >= im.arcLen && flashStartByTarget[im.id] === undefined) {
            flashStartByTarget[im.id] = msAtArc(i, im.arcLen)
          }
        }
      })
      // 軌道型の掃射ヒットは周回が一巡した中盤で反応
      if (e >= 0.55) {
        for (const o of anim.orbits) {
          for (const id of o.hitEnemyIds) {
            if (flashStartByTarget[id] === undefined) flashStartByTarget[id] = 0.55 * flightMs
          }
        }
      }
      // 各対象の現在のフラッシュ強度（1→0へ減衰）
      const flash: Record<string, number> = {}
      for (const id in flashStartByTarget) {
        const t = (elapsed - flashStartByTarget[id]) / FLASH_MS
        if (t >= 0 && t < 1) flash[id] = 1 - t
      }

      // 撃破演出（#46/#51）：**その敵への最後のダメージポップの時刻**（＝致命打）に消滅アニメを開始する（#75）。
      // フラッシュ開始（＝最初の被弾）だと、2発当てて倒したときに1発目のタイミングで消滅が始まってしまう。
      // 該当ポップが無い（掃射など数値を出さない撃破）ときだけ、飛行終盤（e>=0.9）を保険に開始する。
      for (const d of deaths) {
        if (deathStartById[d.id] !== undefined) continue
        const lastHitT = deathTime(popups, d.id)
        if (lastHitT !== null) deathStartById[d.id] = msOfGameTime(lastHitT)
        else if (e >= 0.9) deathStartById[d.id] = 0.9 * flightMs
      }
      // 消滅が始まった敵は生存スプライトを隠す（消滅アニメへ譲る・#46）
      const hideEnemyIds = activeDeathIds(deathStartById, elapsed)

      // 暴発のステージ全体演出（#41）：揺れの強さ（爆発直後が最強→減衰）と破片の落下進行
      let mfShake = 0
      let mfProgress = 0
      anim.bullets.forEach((b, i) => {
        if (!b.misfirePos) return
        const tl = timelines[i]
        const arrivalMs = maxTotal > 0 ? (tl.total / maxTotal) * flightMs : 0
        if (elapsed < arrivalMs) return
        const mp = Math.min(1, (elapsed - arrivalMs) / Math.max(1, realMs - arrivalMs))
        if (mp > mfProgress) mfProgress = mp
        const sh = Math.max(0, 1 - mp * 1.6) // 直後が最強
        if (sh > mfShake) mfShake = sh
      })
      // ステージ全体をガタガタ揺らす（ズレで端に隙間が出ないよう、先に背景で塗りつぶす）。
      // 崩壊へ近づくほど揺れが強くなる（04b §4b.3：doom=count/misfireLimit で最大 2.5 倍）
      const doom = Math.max(0, Math.min(1, props.doom ?? 0))
      const gAmp = mfShake * 9 * (1 + doom * 1.5)
      const gx = mfShake > 0 ? Math.sin(elapsed * 0.07) * gAmp : 0
      const gy = mfShake > 0 ? Math.cos(elapsed * 0.085) * gAmp : 0
      prepare(ctx)
      if (mfShake > 0) {
        ctx.fillStyle = COLORS.bg
        ctx.fillRect(0, 0, vp.width, vp.height)
      }
      ctx.save()
      ctx.translate(gx, gy)

      drawScene(ctx, {
        ...staticParams,
        obstacles,
        previewPath: null,
        misfirePoints: undefined,
        flash,
        shakePhase: elapsed * 0.05,
        bossView: anim.bossView,
        hideEnemyIds,
      })

      // 撃破演出（05c §6.5・#46/#51）：開始済みの敵を消滅アニメで描く（当たり判定には無関係）
      for (const d of deaths) {
        const dStart = deathStartById[d.id]
        if (dStart === undefined) continue
        const dur = d.boss ? BOSS_COLLAPSE_MS : DEATH_MS
        const dp = (elapsed - dStart) / dur
        if (dp < 0 || dp >= 1) continue
        if (d.boss) drawBossCollapse(ctx, d.pos, d.hitboxRadius, dp, vp)
        else drawEnemyDeath(ctx, d.pos, d.hitboxRadius, d.species, d.element, d.tier, dp, vp)
      }

      // 闇の周回は内側を暗くぼかす（#39：プレイヤー視点の視認性低下）。霧散した周回は幕を外す
      const liveDarkRings: DarkRing[] = []
      // 光の周回は内側に癒やしの場を出す（#73）。霧散した周回は外す
      const liveLightRings: LightRing[] = []

      // 軌道型リング：ゆっくり周回（#24）。壁/魔法に負けた周回は接触の瞬間から霧散（#34）
      for (let oi = 0; oi < anim.orbits.length; oi++) {
        const o = anim.orbits[oi]
        const ring = o.ring
        const len = ring.length
        if (len < 2) continue
        // 一度も存在しなかった結界（壁・失速で回り出す前に自壊・#75）：リングも霧散演出も描かない
        if (!ringVisible(o)) continue

        // 霧散する周回：**エンジンが返した破壊時刻**ちょうどから散り始める（#72）。
        // 旧実装は「どれかの弾が破壊点へ近づいたか」で推定し、近づかない場合は飛行の40%で
        // 強制発火していたため、パリィで弾が消えた／暴発で壊れた結界が実際より早く散っていた。
        // 破壊時刻が取れないとき（#75）は、時刻をでっち上げず霧散演出そのものを出さない
        // （下の「接触前」経路へ流れ、周回している見た目のまま留まる）。
        if (o.broken) {
          if (dissipateStartByIdx[oi] === undefined) {
            const bt = ringBreakTime({ broken: o.broken, breakTime: o.breakT, bornBroken: o.bornBroken })
            if (bt !== null) {
              if (elapsed >= msOfGameTime(bt)) dissipateStartByIdx[oi] = msOfGameTime(bt)
            }
          }
          const dStart = dissipateStartByIdx[oi]
          if (dStart !== undefined) {
            // 接触後：周回せず、一度きり外へ散って消える
            const dp = Math.min(0.999, (elapsed - dStart) / DISSIPATE_MS)
            drawOrbitDissipation(ctx, ring, dp, vp)
            for (const cv of o.carves) {
              if (dp < 0.6) drawCarveBurst(ctx, cv.pos, cv.r + 1.2, cv.attr, dp / 0.6, vp)
            }
            continue
          }
          // 接触前：通常どおり周回して見せる（弾の到達を待つ）→ 下の通常描画へ
        }

        // 通常の周回（存続中／霧散前）：帯＋その場の速度で流れる粒（v3 の _drawRing）。
        // 粒の位相は経過時刻から組み立てる（フレーム数で進めると見返しで巻き戻らない・#69）
        const role = o.owner === 'enemy' ? 'enemy' : 'ally'
        seedRingPhases(ringStoreRef.current, ring, role, elapsed)
        drawOrbitRing(ctx, vp, ring, role, ringStoreRef.current)
        const avg = ringAverageAttr(ring)
        if (avg === 'dark') liveDarkRings.push({ ring, owner: role })
        else if (avg === 'light') liveLightRings.push({ ring, owner: role })
      }
      // 光結界の癒やしの場（存続している光のリングだけ・#73）
      drawLightAura(ctx, vp, liveLightRings, trailPhase)
      // 闇結界の視認阻害（存続している闇のリングだけ）
      drawDarkVeil(ctx, vp, liveDarkRings, trailPhase)

      // 発射型・敵弾（速度に応じて進む）
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st) return
        const tl = timelines[i]
        const { pos, idx } = st
        // 発射されたら z 場の値で色/形が決まる（#21）。属性で色、強度で大きさ・棘。
        const z = b.samples[idx]?.z ?? 0
        // 暴発：弾が終端へ到達してから余韻いっぱいまで爆発を進める（実時間ベース）
        const arrivalMs = maxTotal > 0 ? (tl.total / maxTotal) * flightMs : 0
        const exploding = b.misfirePos && elapsed >= arrivalMs
        // 霧散：暴発しない弾が終端（速度0）に達したら、小さくなって散る（#38。貫通で命中後も飛び続けた弾も対象）
        const vanishing = b.vanished && !b.misfirePos && elapsed >= arrivalMs
        // 通ってきた道を属性色で残し（古いほど薄い）、一定間隔に燐光を落とす（v3）
        const pts = previewPointsOf(b.samples)
        drawFlightPath(ctx, vp, pts, idx, trailPhase, powerSizeFrac)
        // 発射の閃光（詠唱の瞬間・術者位置から広がる輪）
        if (elapsed < 260 && pts.length > 0) drawLaunchFlash(ctx, vp, pts[0].pos, pts[0].z, elapsed / 260)
        if (!exploding && !vanishing) {
          const frac = powerSizeFrac(b.samples[idx]?.speed ?? 0, z)
          // 威力はドット絵の煙で語る（#74）。太さ一定の「玉の尻尾」は軌跡を殺すのでやめた
          drawPowerSmoke(ctx, vp, pts, idx, trailPhase, frac)
          drawSpeedSparks(ctx, vp, pts, idx, phase, frac)
          drawBullet(ctx, pos, z, vp, phase, b.samples[idx]?.speed ?? 0)
        }
        if (vanishing) {
          const last = b.samples[b.samples.length - 1]
          const dp = Math.min(0.999, (elapsed - arrivalMs) / DISSIPATE_MS)
          const sizeFrac = Math.max(0.35, powerSizeFrac(0, last?.z ?? 0) || Math.min(1, Math.abs(last?.z ?? 0) / FIELD.sMax))
          drawBulletDissipation(ctx, last?.pos ?? pos, last?.z ?? 0, dp, vp, sizeFrac)
        }
        if (b.misfirePos && exploding) {
          const mp = Math.min(1, (elapsed - arrivalMs) / Math.max(1, realMs - arrivalMs))
          drawMisfire(ctx, b.misfirePos, mp, vp)
        }
      })

      // 障害物を削る瞬間のパーティクル（弾が到達した瞬間から一定時間だけ破片が舞い、必ず消える・#11/#45）。
      // 弧長差で判定すると弾が壁で停止した地点に破片が残り続けるため、到達時刻から実時間で散らす。
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st) return
        for (let j = 0; j < b.carves.length; j++) {
          const cv = b.carves[j]
          if (st.arcLen < cv.arcLen) continue // まだ弾が届いていない
          const key = `${i}-${j}`
          if (carveStartByKey[key] === undefined) carveStartByKey[key] = msAtArc(i, cv.arcLen)
          const cp = (elapsed - carveStartByKey[key]) / CARVE_BURST_MS
          if (cp >= 0 && cp < 1) drawCarveBurst(ctx, cv.pos, cv.r, cv.attr, cp, vp)
        }
      })

      // 一発ごとの着弾時刻・属性・威力で描く。連続命中と見返しでも各衝撃が欠けない。
      anim.bullets.forEach((b, i) => {
        for (const im of b.impacts) {
          const dt = elapsed - msAtArc(i, im.arcLen)
          if (dt < 0 || dt >= FLASH_MS) continue
          const target = im.side === 'enemy' ? props.enemies : props.allies
          const t = target.find((q) => q.id === im.id)
          const sample = b.samples.find((s) => s.arcLen >= im.arcLen) ?? b.samples[b.samples.length - 1]
          if (t && sample) drawImpactShockwave(ctx, vp, t.pos, dt / FLASH_MS, sample.z, powerSizeFrac(sample.speed, sample.z))
        }
      })
      const sweepDt = elapsed - 0.55 * flightMs
      if (sweepDt >= 0 && sweepDt < FLASH_MS) {
        for (const o of anim.orbits) {
          const z = o.ring.reduce((sum, p) => sum + p.z, 0) / Math.max(1, o.ring.length)
          for (const id of o.hitEnemyIds) {
            const t = props.enemies.find((q) => q.id === id)
            if (t) drawImpactShockwave(ctx, vp, t.pos, sweepDt / FLASH_MS, z, powerSizeFrac(o.speed ?? 0, z))
          }
        }
      }

      // パリィ／結界の相殺（#20/#38）：二重の衝撃波＋光闇の破片＋「相殺」の文字（v3）。
      // 大きさは威力（パリィは2魔法の威力合計）に依存する。
      if (anim.clashes && anim.clashes.length > 0) {
        anim.clashes.forEach((clash, ci) => {
          const pos = clash.pos
          // 発火は**エンジンが返した衝突時刻**（#72）。旧実装の「弾が近づいたら」推定では、
          // 相殺で消えた弾の火花や、弾の経路上に無い暴発 AoE の火花が正しく出なかった。
          if (clashStartByIdx[ci] === undefined) {
            const at = msOfGameTime(clash.t)
            if (elapsed >= at) clashStartByIdx[ci] = at
          }
          const start0 = clashStartByIdx[ci]
          if (start0 === undefined) return
          const dt = elapsed - start0
          if (dt < 0) return
          if (dt < PARRY_MS) drawParryBurst(ctx, vp, pos, clash.power, dt / PARRY_MS)
          const cp = dt / CLASH_MS
          const sizeFrac = Math.min(1, clash.power / (FIELD.sMax * FIELD.maxFlightSpeed))
          if (cp < 1) drawClashSpark(ctx, pos, cp, vp, sizeFrac)
        })
      }

      // 暴発：上空から遺跡の破片が降ってくる（ステージ全体・揺れの中で・#41）。
      // 崩壊へ近づくほど瓦礫が増える（04b §4b.3：doom で量をスケール・最大3倍）
      if (mfProgress > 0 && mfProgress < 1) drawFallingDebris(ctx, vp, mfProgress, 1 + doom * 2)

      ctx.restore() // ステージ全体シェイクの translate を戻す

      // 敵ごとの残り HP（揺れの外＝読みやすい位置。消滅中の敵は出さない）
      drawEnemyHpBars(ctx, vp, props.enemies, hideEnemyIds, null)

      // ダメージ／回復の数値（揺れの外＝読みやすい UI として安定表示・#42）。
      // v3：黒の輪郭＋影のドット数字。重なりは上へ積み上げて必ず全部読める。
      const placedPops: { x: number; y: number; w: number; h: number }[] = []
      for (let i = 0; i < popups.length; i++) {
        const p = popups[i]
        // ポップの開始時刻はエンジンが返した発生ゲーム秒 p.t をそのまま使う（#75）。
        // trigger による分岐（flash/misfire/heal）はもう不要：flashStartByTarget は
        // 同じ敵への2発目以降が1発目の時刻に引きずられる（1回しか代入しない）ため、
        // ポップの時刻源としては使わない（被弾フラッシュ本体の用途では引き続き使う）。
        const start = msOfGameTime(p.t)
        const t = (elapsed - start) / POPUP_MS
        if (t < 0 || t >= 1) continue
        const sp = toScreen(p.pos, vp)
        const text = `${Math.round(p.amount)}`
        const size = Math.round(15 + Math.min(15, p.amount / 11))
        const w = text.length * size * 0.68 + 12
        const h = size * 1.35
        let py = sp.y - 14 - Math.pow(t, 0.6) * 30
        for (let g = 0; g < 28; g++) {
          const c = placedPops.find(
            (q) => Math.abs(q.x - sp.x) < (q.w + w) / 2 && Math.abs(q.y - py) < (q.h + h) / 2,
          )
          if (!c) break
          py = c.y - (c.h + h) / 2 - 2
        }
        py = Math.max(h * 0.7 + 2, py)
        placedPops.push({ x: sp.x, y: py, w, h })
        const alpha = Math.min(1, (1 - t) * 2.6)
        drawDamageNumber(ctx, sp.x, py, text, popupColor(p.kind), size, alpha, p.kind === 'heal')
      }

      // 見返しモードは終端でも回し続ける（スライダーで前後に動かせるように）
      if (replayRef.current || elapsed < realMs) raf = requestAnimationFrame(frame)
      else finish()
    }
    raf = requestAnimationFrame(frame)
    // 保険のタイマーは通常再生のときだけ（プレイバック中は時計が止まりうるので働かせない）
    const timer = props.playback || props.replay ? 0 : setTimeout(finish, realMs + 250)
    return () => {
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.animation,
    props.allies,
    props.enemies,
    props.obstacles,
    props.activeAllyId,
    props.playerPaths,
    props.misfirePoints,
    props.ghostPaths,
    props.ghostMisfires,
    props.zField,
    props.showZField,
    props.standingOrbits,
    props.fitPoints,
    props.aimAngle,
    props.rField,
    props.anomaly,
    props.misfireBand,
    props.doom,
    props.collapse,
    props.aimEnemyId,
    props.zOfT,
    props.previewFull,
    view.zoom,
    view.pan,
    size.w,
    size.h,
  ])

  // 破局（致死崩壊・04b §4b.2）：暴発の効果範囲がステージ全体を覆い、場そのものが呑まれる演出。
  // 揺れは進行とともに強まり、瓦礫は最大量で降り続け、最後は白熱へ溶けて onCollapseDone を呼ぶ。
  const collapseDoneRef = useRef(props.onCollapseDone)
  collapseDoneRef.current = props.onCollapseDone
  useEffect(() => {
    if (!props.collapse) return
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const COLLAPSE_MS = 3000
    let finished = false
    const t0 = performance.now()
    let raf = 0
    const done = () => {
      if (finished) return
      finished = true
      collapseDoneRef.current?.()
    }
    const frame = (now: number) => {
      if (finished) return
      const elapsed = now - t0
      const progress = Math.min(1, elapsed / COLLAPSE_MS)
      // 揺れ：進行とともに強く（通常の暴発より大きい）
      const amp = 6 + progress * 16
      const gx = Math.sin(elapsed * 0.07) * amp
      const gy = Math.cos(elapsed * 0.085) * amp
      prepare(ctx)
      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, vp.width, vp.height)
      ctx.save()
      ctx.translate(gx, gy)
      drawScene(ctx, {
        ...staticParams,
        previewPath: null,
        rayAxis: null,
        misfirePoints: undefined,
        ghostPaths: undefined,
        ghostMisfires: undefined,
        showZField: false,
        anomaly: 3, // 崩壊目前の異変を最大で重ねる
        shakePhase: elapsed * 0.05,
      })
      // ステージ全体を覆う暴発（AoE＝場外境界 rField・面/フェーズで可変）＝膜の破れが場を丸ごと呑む
      drawMisfire(ctx, { x: 0, y: 0 }, progress, vp, props.rField ?? FIELD.rField)
      // 瓦礫は最大量で繰り返し降り続ける
      drawFallingDebris(ctx, vp, (elapsed % 1100) / 1100, 3.5)
      ctx.restore()
      // 終盤は白熱へ溶けていく（暴発の中心が白く埋まる質感と揃える・#41）
      if (progress > 0.72) {
        ctx.globalAlpha = Math.min(1, (progress - 0.72) / 0.28)
        ctx.fillStyle = '#fff8e1'
        ctx.fillRect(0, 0, vp.width, vp.height)
        ctx.globalAlpha = 1
      }
      if (elapsed < COLLAPSE_MS) raf = requestAnimationFrame(frame)
      else done()
    }
    raf = requestAnimationFrame(frame)
    const timer = setTimeout(done, COLLAPSE_MS + 400)
    return () => {
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.collapse, size.w, size.h])

  // ポインタ位置を数学座標へ変換（内部解像度と表示サイズの差を補正）
  const eventToMath = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const canvas = ref.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const px = ((e.clientX - rect.left) * vp.width) / rect.width
    const py = ((e.clientY - rect.top) * vp.height) / rect.height
    return toMath({ x: px, y: py }, vp)
  }
  const redrawCompose = () => composeDrawRef.current?.()

  // ===== 盤面の拡大縮小（ズーム/パン・見やすくする） =====
  const ZOOM_MIN = 1
  const ZOOM_MAX = 3.5
  // 内部解像度でのポインタ座標（ピンチの中心/距離に使う）
  const eventToInternal = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const canvas = ref.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    return {
      x: ((e.clientX - rect.left) * vp.width) / rect.width,
      y: ((e.clientY - rect.top) * vp.height) / rect.height,
    }
  }
  const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
  // 場が画面外へ抜け切らないようパンを制限（中心から場の縁が見える範囲まで）
  const clampPan = (pan: Vec2, zoom: number): Vec2 => {
    const lim = rField * Math.max(0, 1 - 1 / zoom)
    return { x: Math.max(-lim, Math.min(lim, pan.x)), y: Math.max(-lim, Math.min(lim, pan.y)) }
  }
  // ある内部ピクセル点（focal）を固定したままズーム倍率を変える
  const zoomAtInternal = (nextZoom: number, focalPx: Vec2) => {
    setView((v) => {
      const z = clampZoom(nextZoom)
      const focal = toMath(focalPx, { ...vp, zoom: v.zoom, pan: v.pan })
      // newPan = focal - (focal - oldPan) * oldZoom/newZoom（focal をスクリーン上に留める）
      const pan = {
        x: focal.x - (focal.x - v.pan.x) * (v.zoom / z),
        y: focal.y - (focal.y - v.pan.y) * (v.zoom / z),
      }
      return { zoom: z, pan: clampPan(pan, z) }
    })
  }
  const zoomAtCenter = (nextZoom: number) => zoomAtInternal(nextZoom, { x: vp.width / 2, y: vp.height / 2 })

  // マルチタッチ（ピンチ）追跡
  const pointersRef = useRef<Map<number, Vec2>>(new Map())
  const pinchRef = useRef<{ dist: number; mid: Vec2; zoom: number; focal: Vec2 } | null>(null)
  const suppressAimRef = useRef(false)

  const pinchMetrics = () => {
    const pts = [...pointersRef.current.values()]
    const dx = pts[0].x - pts[1].x
    const dy = pts[0].y - pts[1].y
    return { dist: Math.hypot(dx, dy) || 1, mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } }
  }

  const interactive = !!props.pickMode || !!props.onAim

  // ポインタ操作：2本指＝ピンチ（ズーム）＆パン、1本指＝点ピック（ルーペ・#49）/発射方向ドラッグ（#47）
  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const px = eventToInternal(e)
    if (!px) return
    pointersRef.current.set(e.pointerId, px)
    try {
      ref.current?.setPointerCapture(e.pointerId)
    } catch {
      /* 非対応は無視 */
    }
    if (pointersRef.current.size >= 2) {
      // ピンチ開始：進行中の照準/点ピックを取り消す
      aimingRef.current = false
      pickPosRef.current = null
      suppressAimRef.current = true
      const { dist, mid } = pinchMetrics()
      pinchRef.current = { dist, mid, zoom: view.zoom, focal: toMath(mid, vp) }
      return
    }
    if (!interactive) return
    const m = eventToMath(e)
    if (!m) return
    if (props.pickMode) {
      pickPosRef.current = m
      redrawCompose()
    } else if (props.onAim) {
      aimingRef.current = true
      props.onAim(m)
    }
  }
  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const px = eventToInternal(e)
    if (px && pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, px)
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      // ピンチ：距離比でズーム、中心の移動でパン（開始時の focal を現在の中心へ合わせる）
      const { dist, mid } = pinchMetrics()
      const start = pinchRef.current
      const z = clampZoom((start.zoom * dist) / start.dist)
      const baseScale = Math.min(vp.width, vp.height) / 2 / rField
      const scale = baseScale * z
      // toScreen: midScreen = center + (focal - pan)*scale（y反転）→ pan = focal - (midScreen-center)/scale
      const pan = {
        x: start.focal.x - (mid.x - vp.width / 2) / scale,
        y: start.focal.y + (mid.y - vp.height / 2) / scale,
      }
      setView({ zoom: z, pan: clampPan(pan, z) })
      return
    }
    if (!interactive) return
    const m = eventToMath(e)
    if (!m) return
    if (props.pickMode && pickPosRef.current) {
      pickPosRef.current = m
      redrawCompose()
    } else if (props.onAim && aimingRef.current && !suppressAimRef.current) {
      props.onAim(m)
    }
  }
  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 0) suppressAimRef.current = false
    if (props.pickMode && pickPosRef.current) {
      props.onFieldClick?.(pickPosRef.current)
      pickPosRef.current = null
      redrawCompose()
    }
    aimingRef.current = false
  }
  // ホイールでズーム（カーソル位置を固定）。ページスクロールを止めるため非パッシブで登録
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const px = eventToInternal(e)
      if (!px) return
      const factor = Math.exp(-e.deltaY * 0.0015)
      zoomAtInternal(view.zoom * factor, px)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.zoom, view.pan, rField])

  const zoomed = view.zoom > 1.001
  return (
    <>
      <canvas
        ref={ref}
        aria-label="バトルフィールド"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          cursor: interactive ? 'crosshair' : 'default',
          touchAction: 'none',
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
      <div className="zoom-controls" aria-label="盤面の拡大縮小">
        <button type="button" aria-label="拡大" onClick={() => zoomAtCenter(view.zoom * 1.4)}>
          ＋
        </button>
        <button type="button" aria-label="縮小" onClick={() => zoomAtCenter(view.zoom / 1.4)}>
          －
        </button>
        {zoomed && (
          <button
            type="button"
            aria-label="ズームを戻す"
            className="zoom-reset"
            onClick={() => setView({ zoom: 1, pan: { x: 0, y: 0 } })}
          >
            ⟲
          </button>
        )}
      </div>
    </>
  )
}

/** 点ピック中の拡大鏡（ルーペ・#49）。指の少し上に、指の下の盤面を拡大して見せる。 */
function drawPickLoupe(ctx: CanvasRenderingContext2D, pos: Vec2, vp: Viewport): void {
  const fs = toScreen(pos, vp)
  const R = 70
  const zoom = 2.6
  const gap = 40
  let cx = fs.x
  let cy = fs.y - R - gap
  if (cy - R < 4) cy = fs.y + R + gap // 上が見切れるなら下に出す
  cx = Math.max(R + 4, Math.min(vp.width - R - 4, cx))
  cy = Math.max(R + 4, Math.min(vp.height - R - 4, cy))
  const half = R / zoom
  ctx.save()
  // 指→ルーペの接続線
  ctx.strokeStyle = 'rgba(90, 209, 255, 0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(fs.x, fs.y)
  ctx.lineTo(cx, cy)
  ctx.stroke()
  // ルーペ円の内側に、指の下の領域を拡大して描く
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#0d0b14'
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(ctx.canvas, fs.x - half, fs.y - half, half * 2, half * 2, cx - R, cy - R, R * 2, R * 2)
  // 中心のクロスヘア
  ctx.strokeStyle = '#5ad1ff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - 12, cy)
  ctx.lineTo(cx + 12, cy)
  ctx.moveTo(cx, cy - 12)
  ctx.lineTo(cx, cy + 12)
  ctx.stroke()
  ctx.restore() // クリップ解除
  // 枠
  ctx.strokeStyle = '#5ad1ff'
  ctx.lineWidth = 3
  ctx.shadowColor = '#5ad1ff'
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.shadowBlur = 0
  // 実際に点が置かれる位置に小さな✛
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(fs.x - 7, fs.y)
  ctx.lineTo(fs.x + 7, fs.y)
  ctx.moveTo(fs.x, fs.y - 7)
  ctx.lineTo(fs.x, fs.y + 7)
  ctx.stroke()
  ctx.restore()
}

/** 通過点フィットで選んだ点を✛＋連番で表示する（#46）。 */
function drawFitPoints(ctx: CanvasRenderingContext2D, points: Vec2[] | undefined, vp: Viewport): void {
  if (!points || points.length === 0) return
  ctx.save()
  for (let i = 0; i < points.length; i++) {
    const s = toScreen(points[i], vp)
    ctx.strokeStyle = '#5ad1ff'
    ctx.lineWidth = 2
    ctx.shadowColor = '#5ad1ff'
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.moveTo(s.x - 6, s.y)
    ctx.lineTo(s.x + 6, s.y)
    ctx.moveTo(s.x, s.y - 6)
    ctx.lineTo(s.x, s.y + 6)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#cdeffd'
    ctx.font = '11px sans-serif'
    ctx.fillText(String(i + 1), s.x + 8, s.y - 8)
  }
  ctx.restore()
}
