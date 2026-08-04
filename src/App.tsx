import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ally, AllyCast, BattleState, CarveBurst, Stage, Vec2, ZPoint } from './game/types'
import { createBattleState, prepareTurn, resolveAllyCasts } from './game/battle'
import { planEnemyShots, enemyFlight } from './game/enemyAI'
import { zfieldAt } from './game/attribute'
import { ringAverageAttr } from './game/orbit'
import { recommendCast } from './game/recommend'
import { ROTATE_PRESETS, defaultCoeffs } from './game/functions'
import { ZFIELD_PRESETS, defaultZCoeffs } from './game/zfields'
import { STAGES } from './data/stages'
import { makeParty } from './data/party'
import { FIELD, INSTABILITY } from './data/constants'
import {
  PROLOGUE,
  EPILOGUE,
  GAMEOVER_TEXT,
  GAMEOVER_COLLAPSE,
  RUPTOR_DEMO,
  COLLAPSE_FIRST,
  COLLAPSE_PHASE,
  COLLAPSE_FINAL,
  CODEX_MISFIRE_HINT,
  INSCRIPTIONS,
  SCENERIES,
} from './data/story'
import {
  anomalyLevel,
  applyStageClearRelief,
  collapseProximity,
  isLethal,
  misfireRadiusBand,
  shouldFirstCollapse,
  varianceOf,
} from './game/misfireInstability'
import {
  type ComposerState,
  buildComposerTrajectory,
  buildZField,
  computePreview,
  parametricPatch,
  zParametricPatch,
  fitSpecOf,
  yTextOf,
  buildZAt,
  NO_FIT,
} from './components/composer'
import { computeReadout, type Readout } from './components/readout'
import { solveAngle } from './components/solveAngle'
import { buildTestStage } from './components/testStage'
import ReadoutStrip, { ReadoutStats } from './components/ReadoutStrip'
import PlaybackBar from './components/PlaybackBar'
import DraftPad from './components/DraftPad'
import AnomalyOverlay from './components/AnomalyOverlay'
import TopRail from './components/TopRail'
import ZPlot from './components/ZPlot'
import CasterCards from './components/CasterCards'
import Endroll from './components/Endroll'
import type { ConsoleFocus } from './components/FunctionPanel'
import { fitToPoints, renderExpr } from './game/exprFit'
import BattleCanvas, {
  type ResolveAnimation,
  type AnimBullet,
  type AnimOrbit,
  type EnemyDeath,
} from './components/BattleCanvas'
import { speciesOf, tierOf } from './render/species'
import FunctionPanel from './components/FunctionPanel'
import Codex from './components/Codex'
import Guide from './components/Guide'
import { TitleScreen, StoryScreen, ResultScreen, TurnResultOverlay } from './components/screens'
import { ensureAudio, playSfx, startMusic, toggleMuted, type SfxKind } from './audio/sound'
// ステージエディタ（#67）は開発ビルド専用ツール。マウントは import.meta.env.DEV のときだけ（本番非露出）。
import StageEditor from './editor/StageEditor'

type Screen =
  | 'title'
  | 'stageSelect'
  | 'prologue'
  | 'stageIntro'
  | 'battle'
  | 'stageClear'
  | 'gameover'
  | 'ending'
  | 'endroll'
  | 'editor'

/** 見返し（プレイバック）用に取っておく 1 ターンぶんのスナップショット。 */
interface ReplayEntry {
  turn: number
  animation: ResolveAnimation
  allies: Ally[]
  enemies: BattleState['enemies']
  obstacles: BattleState['obstacles']
  rField: number | undefined
}
/** 保持する見返しターン数。見返せるのは**直近 1 ターン**だけでよい（#69）。 */
const REPLAY_KEEP = 1

/** 開発時のみ：URL の ?stage=N（1始まり）で指定ステージへ直行（通常プレイ＝本番ビルドでは無効・#33）。 */
const DEV = import.meta.env.DEV
function devStageFromUrl(): number | null {
  if (!DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('stage')
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 && n <= STAGES.length ? n - 1 : null
}

/** 開発時のみ：URL の ?editor=1 でステージエディタへ直行（#67・本番ビルドでは無効）。 */
function devEditorFromUrl(): boolean {
  if (!DEV || typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('editor') === '1'
}

/** from→to を a 直線で狙う角度。 */
function aimAngle(from: Vec2, to: Vec2, a: number): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - Math.atan(a)
}

/** 触覚フィードバック（#49・対応端末のみ。非対応は無視）。 */
function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern)
  } catch {
    /* 非対応・権限なしは無視 */
  }
}

/** ミリ秒を mm:ss に整形（#6：クリアタイム）。 */
function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * 1 人ぶんの初期コンポーザ。y（軌道）と z（属性場・変数 t＝術者からの距離）は別入力で、
 * どちらも自由式のまま持ち、式中の数値だけ係数スライダーへ自動検出する（#46/#52）。
 */
function makeComposer(angle: number, yExpr = '0', zExpr = '0'): ComposerState {
  const coeffs = defaultCoeffs(ROTATE_PRESETS[0])
  const zPreset = ZFIELD_PRESETS[0] // 一定（const）：zRadial=false の互換経路でのみ使う
  const zCoeffs = defaultZCoeffs(zPreset)
  const base: ComposerState = {
    mode: 'rotate',
    presetId: 'line',
    coeffs,
    angle,
    speed: FIELD.fixedSpeed,
    useFree: true,
    freeExpr: yExpr,
    freeError: null,
    yText: yExpr,
    zText: zExpr,
    ...NO_FIT,
    zRadial: true,
    zPresetId: zPreset.id,
    zCoeffs,
    zUseFree: true,
    zFreeExpr: zExpr,
    zFreeError: null,
    zFitTemplate: '',
    zFitParams: [],
    zFitValues: {},
  }
  return {
    ...base,
    ...parametricPatch(yExpr, 'x'),
    ...zParametricPatch(zExpr, true),
    yText: yExpr,
    zText: zExpr,
  }
}

/**
 * パーティ各自の初期の z。**正準形（山／平）で始める**ので、開いた直後から
 * z 整形のスライダー（t₀ / w / z₀）がそのまま効く（自由式だと無効表示になり手がかりが減る）。
 * 符号は各自の防御属性に寄せてある（ミラ＝光／レン＝闇／ソウ＝中立）。
 */
const DEFAULT_Z: string[] = ['3*exp(-((t - 20)/8)^2)', '-3*exp(-((t - 20)/8)^2)', '0']

/** パーティ各自の初期コンポーザ（敵陣（上方）へ向ける）。 */
function initComposers(party: Ally[]): Record<string, ComposerState> {
  const m: Record<string, ComposerState> = {}
  party.forEach((a, i) => {
    m[a.id] = makeComposer(aimAngle(a.pos, { x: 0, y: 19 }, 0), '0', DEFAULT_Z[i] ?? '0')
  })
  return m
}

/**
 * ステージエディタのテストプレイ（#67 §7）用の一時セッションのスナップショット。
 * テストプレイ中の状態（HP消費・instability の増減など）を本編の進行状況と完全に分離するため、
 * 開始前の状態をここへ退避し、終了（勝敗/中断）時にそのまま復元してエディタへ戻る。
 */
interface TestPlaySnapshot {
  instability: number
  stageStartInstability: number
  stageMisfires: number
  collapseSeen: boolean
  collapseGameover: boolean
  collapsePlaying: boolean
  demoSeen: boolean
  runStartMs: number | null
  battle: BattleState | null
  castingIds: string[]
  impairedIds: string[]
  composers: Record<string, ComposerState>
  activeAllyId: string
  animation: ResolveAnimation | null
  pendingState: BattleState | null
  touchedAllies: Set<string>
  confirmArmed: boolean
  stageIndex: number
}

export default function App() {
  const devStage = devStageFromUrl()
  const devEditor = devEditorFromUrl()
  const [screen, setScreen] = useState<Screen>(devEditor ? 'editor' : devStage !== null ? 'stageIntro' : 'title')
  const [stageIndex, setStageIndex] = useState(devStage ?? 0)
  const [battle, setBattle] = useState<BattleState | null>(null)
  const [castingIds, setCastingIds] = useState<string[]>([])
  const [impairedIds, setImpairedIds] = useState<string[]>([])
  const [composers, setComposers] = useState<Record<string, ComposerState>>({})
  const [activeAllyId, setActiveAllyId] = useState<string>('')
  const [animation, setAnimation] = useState<ResolveAnimation | null>(null)
  const [pendingState, setPendingState] = useState<BattleState | null>(null)
  // DoT（burn）撃破の消滅演出（バグ修正）：prepareTurn で継続ダメージにより倒れた敵の
  // 撃破アニメを一度挟むあいだ、準備済みの次ターン状態をここへ退避しておき、演出後に適用する。
  // これがある間の onAnimationDone は prepareTurn を再実行せず、退避した prep をそのまま反映する
  // （DoT の二重適用を防ぐ＝ロジック不変・演出のみ）。
  const pendingPrepRef = useRef<ReturnType<typeof prepareTurn> | null>(null)
  // #46：通過点フィット。点ピック中フラグと、選んだ通過点（数学座標）
  const [fitPickActive, setFitPickActive] = useState(false)
  const [fitPoints, setFitPoints] = useState<Vec2[]>([])
  // #48：ボタンを減らすためのメニュー（遊び方/図鑑/音）開閉
  const [menuOpen, setMenuOpen] = useState(false)
  // #49：このターンで術式を設定/変更した味方ID（準備状況の✓・発射前確認）
  const [touchedAllies, setTouchedAllies] = useState<Set<string>>(new Set())
  const [codexOpen, setCodexOpen] = useState(false)
  // #23：図鑑用に「遭遇した敵」を記録（セッション内・永続化しない）
  const [seenEnemies, setSeenEnemies] = useState<Set<string>>(new Set())
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideShown, setGuideShown] = useState(false)
  // #6：クリアタイム計測
  const [runStartMs, setRunStartMs] = useState<number | null>(null)
  const [clearSnapshotMs, setClearSnapshotMs] = useState(0)
  // エンドロールに出す総ターン数（ラン全体で数える）
  const [totalTurns, setTotalTurns] = useState(0)
  // ===== 暴発の不安定化・累積・崩壊（04b）：ラン全体で持ち越す膜の摩耗 =====
  const [instability, setInstability] = useState(0)
  // ステージ開始時点のスナップショット（リトライ時にそこへ巻き戻す）
  const [stageStartInstability, setStageStartInstability] = useState(0)
  // このステージ内で解決した暴発数（暴発ゼロクリアの緩和・04b §4b.1 用）
  const [stageMisfires, setStageMisfires] = useState(0)
  // 初回崩壊（グリモワール救済）を見たか（一度きり）。以後メーター可視・崩壊＝ゲームオーバー
  const [collapseSeen, setCollapseSeen] = useState(false)
  // 敵の暴発を初めて見たか（RUPTOR_DEMO・図鑑補足を一度だけ出す）
  const [demoSeen, setDemoSeen] = useState(false)
  // 破局（instability 上限到達）でのゲームオーバーか（専用テキスト）
  const [collapseGameover, setCollapseGameover] = useState(false)
  /** 破局（致死崩壊）演出の再生中（04b §4b.2：ステージ全体を覆う暴発 → gameover へ） */
  const [collapsePlaying, setCollapsePlaying] = useState(false)
  // 物語オーバーレイ（RUPTOR_DEMO／COLLAPSE_FIRST）：戦闘の上に一度だけ挟む
  const [storyOverlay, setStoryOverlay] = useState<{ title: string; lines: string[] } | null>(null)
  // 確認ゲート（04b §4b.2）：崩壊につながる暴発を含む発射は、一度警告してから撃つ
  const [confirmArmed, setConfirmArmed] = useState(false)
  // このターンの解決で起きたことを onAnimationDone へ引き継ぐ
  const pendingEventsRef = useRef<{ gained: number; enemyMisfired: boolean; logLines: string[] } | null>(null)
  // #10：音
  const sfxRef = useRef<SfxKind[]>([])
  const [muted, setMutedState] = useState(false)
  // ステージエディタのテストプレイ（#67 §7）：本編の進行状況と分離した使い捨てセッション中フラグ
  const [testPlayActive, setTestPlayActive] = useState(false)
  const testPlaySnapshotRef = useRef<TestPlaySnapshot | null>(null)
  /** テストプレイ／試しの間の終了後に戻る画面（エディタ or ステージ選択） */
  const [testPlayReturn, setTestPlayReturn] = useState<'editor' | 'stageSelect'>('editor')
  /**
   * 盤面の見出しに出すステージ名。BattleState は stageIndex しか持たないので、
   * 試しの間やエディタのテストプレイ（STAGES に無いステージ）でも正しい名前を出せるよう控えておく。
   */
  const [stageLabel, setStageLabel] = useState('')
  // ===== 詠唱コンソール（y/z 別入力・DC プロトタイプ v3）=====
  const [consoleFocus, setConsoleFocus] = useState<ConsoleFocus>('y')
  // 記号盤は既定で開く（プロトタイプ v3 の padOpen:true）
  const [padOpen, setPadOpen] = useState(true)
  const [draftOpen, setDraftOpen] = useState(false)
  const [solving, setSolving] = useState(false)
  // ===== ターン結果パネル =====
  const [turnResult, setTurnResult] = useState<{ turn: number; title: string; lines: string[] } | null>(null)
  // ===== 見返し（プレイバック）=====
  const [replays, setReplays] = useState<ReplayEntry[]>([])
  const [replay, setReplay] = useState<{
    turn: number
    paused: boolean
    seekMs: number
    seekToken: number
    rate: number
    posMs: number
    totalMs: number
  } | null>(null)

  const aliveAllies = useMemo(() => battle?.allies.filter((a) => a.hp > 0) ?? [], [battle])

  // 各味方の軌道・プレビュー（作成フェーズ）
  const previews = useMemo(() => {
    if (!battle) return {} as Record<string, ReturnType<typeof computePreview>>
    const out: Record<string, ReturnType<typeof computePreview>> = {}
    for (const a of battle.allies) {
      if (a.hp <= 0) continue
      const c = composers[a.id]
      if (!c) continue
      const traj = buildComposerTrajectory(c, a.pos, battle.rField)
      out[a.id] = computePreview(traj, c.speed, battle.mechanics.obstacles ? battle.obstacles : [])
    }
    return out
  }, [battle, composers])

  const playerPaths = useMemo(
    () => aliveAllies.map((a) => previews[a.id]?.path ?? null),
    [aliveAllies, previews],
  )
  // 関数（軌道 or z 場）がエラーで暴発する点（#30）。プレビューで赤い✕として可視化する
  const misfirePoints = useMemo(
    () => aliveAllies.map((a) => previews[a.id]?.misfirePos ?? null),
    [aliveAllies, previews],
  )
  // 編集中の z 場（#37）。アクティブな術者の z 場を場として薄く表示する。
  // z 場は術者位置を原点に評価するため、プレビューも術者位置ぶんずらして描く（#52）
  const activeZField = useMemo(() => {
    const c = composers[activeAllyId]
    if (!c) return null
    const raw = buildZField(c)
    const ally = battle?.allies.find((a) => a.id === activeAllyId)
    if (!ally) return raw
    return (x: number, y: number) => raw(x - ally.pos.x, y - ally.pos.y)
  }, [composers, activeAllyId, battle])
  // 持続中の周回結界（#39：作成フェーズでも常時表示し、闇は内側を暗くぼかす）。
  // owner を渡し、敵の闇結界は作成フェーズで視認阻害（ぼかし＋z場/予測経路を隠す・#61）する。
  const standingOrbits = useMemo(
    () => (battle?.orbits ?? []).map((o) => ({ ring: o.ring, speed: o.ringSpeed, owner: o.owner })),
    [battle],
  )

  // 敵の先出し術式を公開（#17：得意関数の形を見せる）。崩し手は暴発予告点も添え（#42）、
  // 多重詠唱（#44）は弾ごとにゴーストを並べる。断末魔のボス（HP0）も castingIds に入っていれば晒す（#45）
  const ghostPlans = useMemo(() => {
    if (!battle) return [] as { path: Vec2[]; misfire: Vec2 | null }[]
    return castingIds
      .map((id) => battle.enemies.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => !!e)
      .flatMap((e) =>
        planEnemyShots(
          e,
          battle.allies,
          battle.obstacles,
          (battle.orbits ?? []).filter((o) => o.owner === 'player').map((o) => o.ring),
          battle.enemies,
          battle.rField,
        ).map((plan) => ({
          path: enemyFlight(plan.trajectory, e.castInitialSpeed).path,
          misfire: plan.misfirePos ?? null,
        })),
      )
      .filter((g) => g.path.length > 0)
  }, [battle, castingIds])
  const ghostPaths = useMemo(() => ghostPlans.map((g) => g.path), [ghostPlans])
  const ghostMisfires = useMemo(() => ghostPlans.map((g) => g.misfire), [ghostPlans])

  // #49：このターンで「術式を設定/変更した味方」を記録（準備状況の✓・発射確認に使う）
  const markTouched = (id: string) => setTouchedAllies((s) => (s.has(id) ? s : new Set(s).add(id)))
  const onChange = (patch: Partial<ComposerState>) => {
    setConfirmArmed(false) // 式を変えたら確認ゲートを解除（04b §4b.2）
    // 軌道 y↔結界 r を切り替えたら、前の意味で拾った盤面の通過点は捨てる（#68）
    if (patch.mode && patch.mode !== composers[activeAllyId]?.mode) clearFit()
    setComposers((m) => ({ ...m, [activeAllyId]: { ...m[activeAllyId], ...patch } }))
    markTouched(activeAllyId)
  }

  // 物語オーバーレイ（RUPTOR_DEMO／COLLAPSE_FIRST・04b）。どの画面の上にも一度だけ挟む
  const storyOverlayEl = storyOverlay && (
    <div className="modal-backdrop story-overlay">
      <div className="modal">
        <div className="modal-head">
          <h2>{storyOverlay.title}</h2>
        </div>
        <div className="story-text">
          {storyOverlay.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
        <div className="center-actions">
          <button className="btn primary" onClick={() => setStoryOverlay(null)}>
            続ける
          </button>
        </div>
      </div>
    </div>
  )

  // 開発ジャンプ時はクリアタイム計測の起点を初期化（#33）
  useEffect(() => {
    if (devStage !== null && runStartMs === null) setRunStartMs(performance.now())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 開発用：指定ステージのイントロへ直行する（DEV のみ・#33）。 */
  const devJumpToStage = (i: number) => {
    setStageIndex(i)
    setBattle(null)
    setAnimation(null)
    setPendingState(null)
    if (runStartMs === null) setRunStartMs(performance.now())
    setScreen('stageIntro')
  }

  // ===== 画面遷移 =====
  const startBattle = () => {
    const stage = STAGES[stageIndex]
    setStageLabel(stage.name)
    // 遭遇した敵を図鑑に記録（#23）
    setSeenEnemies((prev) => new Set([...prev, ...stage.enemies.map((e) => e.name)]))
    // instability はステージ開始時点へ巻き戻す（リトライ対応・ラン全体では持ち越し・04b）
    setInstability(stageStartInstability)
    setStageMisfires(0)
    setCollapseGameover(false)
    setCollapsePlaying(false)
    setConfirmArmed(false)
    pendingEventsRef.current = null
    const party = makeParty()
    const fresh = createBattleState(stage, stageIndex, party)
    const prep = prepareTurn(fresh)
    setBattle(prep.state)
    setCastingIds(prep.castingEnemyIds)
    setImpairedIds(prep.impairedAllyIds)
    setComposers(initComposers(party))
    setActiveAllyId(party[0].id)
    setAnimation(null)
    setPendingState(null)
    setTouchedAllies(new Set())
    setReplays([])
    setReplay(null)
    setTurnResult(null)
    setConsoleFocus('y')
    setDraftOpen(false)
    setScreen('battle')
    if (stageIndex === 0 && !guideShown) {
      setGuideOpen(true)
      setGuideShown(true)
    }
  }

  /**
   * ステージエディタのテストプレイ開始（#67 §7）。編集中の Stage をそのまま battle 化し、
   * タイトル/序章/イントロを飛ばして直接戦闘へ入る。開始前の本編の進行状況はスナップショットへ退避し、
   * テストプレイ終了時にそのまま復元する（本編の instability・HP 等には一切影響しない）。
   */
  const startTestPlay = (stage: Stage, instabilityStart: number, testStageIndex: number) => {
    testPlaySnapshotRef.current = {
      instability,
      stageStartInstability,
      stageMisfires,
      collapseSeen,
      collapseGameover,
      collapsePlaying,
      demoSeen,
      runStartMs,
      battle,
      castingIds,
      impairedIds,
      composers,
      activeAllyId,
      animation,
      pendingState,
      touchedAllies,
      confirmArmed,
      stageIndex,
    }
    setTestPlayActive(true)
    setStageLabel(stage.name)
    pendingPrepRef.current = null
    pendingEventsRef.current = null
    setInstability(instabilityStart)
    setStageStartInstability(instabilityStart)
    setStageMisfires(0)
    setCollapseSeen(false)
    setCollapseGameover(false)
    setCollapsePlaying(false)
    setDemoSeen(false)
    setConfirmArmed(false)
    setStoryOverlay(null)
    // 編集中ステージの元インデックスへ合わせる（戦闘画面のステージ名表示・#67 §7）
    setStageIndex(testStageIndex)
    const party = makeParty()
    const fresh = createBattleState(stage, testStageIndex, party)
    const prep = prepareTurn(fresh)
    setBattle(prep.state)
    setCastingIds(prep.castingEnemyIds)
    setImpairedIds(prep.impairedAllyIds)
    setComposers(initComposers(party))
    setActiveAllyId(party[0].id)
    setAnimation(null)
    setPendingState(null)
    setTouchedAllies(new Set())
    setReplays([])
    setReplay(null)
    setTurnResult(null)
    setConsoleFocus('y')
    setDraftOpen(false)
    if (runStartMs === null) setRunStartMs(performance.now())
    setScreen('battle')
  }

  /** 「試しの間」（練習部屋）。本編の進行状況は退避したまま、壁の削れとパリィだけを試す。 */
  const startPractice = () => {
    // 練習部屋は開発用。本番ビルドには到達経路が無い
    setTestPlayReturn('stageSelect')
    startTestPlay(buildTestStage(), 0, 0)
  }

  /** テストプレイ終了（勝敗/中断のいずれか・#67 §7）：本編の状態を復元してエディタ画面へ戻す。 */
  const endTestPlay = () => {
    const snap = testPlaySnapshotRef.current
    testPlaySnapshotRef.current = null
    setTestPlayActive(false)
    pendingPrepRef.current = null
    pendingEventsRef.current = null
    if (snap) {
      setInstability(snap.instability)
      setStageStartInstability(snap.stageStartInstability)
      setStageMisfires(snap.stageMisfires)
      setCollapseSeen(snap.collapseSeen)
      setCollapseGameover(snap.collapseGameover)
      setCollapsePlaying(snap.collapsePlaying)
      setDemoSeen(snap.demoSeen)
      setRunStartMs(snap.runStartMs)
      setBattle(snap.battle)
      setCastingIds(snap.castingIds)
      setImpairedIds(snap.impairedIds)
      setComposers(snap.composers)
      setActiveAllyId(snap.activeAllyId)
      setAnimation(snap.animation)
      setPendingState(snap.pendingState)
      setTouchedAllies(snap.touchedAllies)
      setConfirmArmed(snap.confirmArmed)
      setStageIndex(snap.stageIndex)
    }
    setStoryOverlay(null)
    setReplays([])
    setReplay(null)
    setTurnResult(null)
    setScreen(testPlayReturn)
  }

  // 1人ぶんのおすすめ術式を作る（#46）。対象は最も近い生存敵。組めなければ null。
  const recommendFor = (ally: Ally): ComposerState | null => {
    const enemiesAlive = battle?.enemies.filter((e) => e.hp > 0) ?? []
    if (enemiesAlive.length === 0) return null
    const target = enemiesAlive.reduce((best, e) =>
      Math.hypot(e.pos.x - ally.pos.x, e.pos.y - ally.pos.y) <
      Math.hypot(best.pos.x - ally.pos.x, best.pos.y - ally.pos.y)
        ? e
        : best,
    )
    const r = recommendCast(ally.pos, target, battle?.mechanics.obstacles ? battle.obstacles : [], battle?.rField)
    // z 場は敵の反対極を最強で当てる一定値（#21）。z(t) の自由式（定数）としてそのまま渡す
    const expr = r.line ? `${r.line.a}*x` : (r.freeExpr ?? '0')
    return makeComposer(r.angle, expr || '0', `${r.zConst}`)
  }
  // #49：一括おまかせ。生存・非ひるみの全味方へ当たる術式を自動設定
  const recommendAll = () => {
    if (!battle) return
    const next: Record<string, ComposerState> = {}
    const touched = new Set(touchedAllies)
    for (const a of battle.allies) {
      if (a.hp <= 0 || impairedIds.includes(a.id)) continue
      const c = recommendFor(a)
      if (c) {
        next[a.id] = c
        touched.add(a.id)
      }
    }
    setComposers((m) => ({ ...m, ...next }))
    setTouchedAllies(touched)
    vibrate(18)
  }

  // #46：通過点フィット
  const clearFit = () => {
    setFitPoints([])
    setFitPickActive(false)
  }
  // #54：点ピックの開始/終了。開始時はスマホでも盤面（全画面）へ移動してそのまま点を打てるようにする
  const toggleFitPick = () => {
    setFitPickActive((v) => {
      const next = !v
      if (next) vibrate(8)
      return next
    })
  }
  const onFieldClick = (p: Vec2) => {
    if (!fitPickActive) return
    setFitPoints((prev) => [...prev, p])
    vibrate(8)
  }
  // #47：フィールドのクリック／ドラッグで発射方向（θ）を決める（射出＝回転のみ）
  const aimAt = (p: Vec2) => {
    const c = composers[activeAllyId]
    const ally = battle?.allies.find((a) => a.id === activeAllyId)
    if (!c || !ally || c.mode !== 'rotate') return
    const ang = Math.atan2(p.y - ally.pos.y, p.x - ally.pos.x)
    const norm = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    onChange({ angle: norm })
  }
  const runFit = () => {
    const c = composers[activeAllyId]
    const ally = battle?.allies.find((a) => a.id === activeAllyId)
    if (!c || !ally || c.mode !== 'rotate' || c.fitParams.length === 0 || fitPoints.length === 0) return
    const spec = fitSpecOf(c)
    // #50：打った順に通すよう発射方向 θ も選び直す。係数は多スタート LM（sin/指数/1/x 対応）
    const { values, angle } = fitToPoints(spec, c.fitValues, c.angle, ally.pos, fitPoints)
    const expr = renderExpr(spec, values)
    onChange({
      fitValues: values,
      freeExpr: expr,
      yText: yTextOf(expr, c.mode),
      angle,
      useFree: true,
      freeError: null,
    })
    // 点は残したまま（曲線が点に近づいた結果を確認できる）。ピックは抜ける。クリアは手動。
    setFitPickActive(false)
    vibrate(14)
  }
  // 別の味方に切り替えたらピック状態は破棄する
  const switchAlly = (id: string) => {
    clearFit()
    playSfx('select')
    vibrate(8)
    setActiveAllyId(id)
  }

  const fireAll = () => {
    if (!battle) return
    clearFit()
    setMenuOpen(false)
    vibrate([18, 40, 18])
    const casts: AllyCast[] = []
    for (const a of battle.allies) {
      if (a.hp <= 0 || impairedIds.includes(a.id)) continue
      const c = composers[a.id]
      if (!c) continue
      const traj = buildComposerTrajectory(c, a.pos, battle.rField)
      if (!traj) continue
      casts.push({ allyId: a.id, trajectory: traj, initialSpeed: c.speed })
    }
    // 確認ゲート（04b §4b.2）：メーター開示後、この発射に含まれる暴発で上限に達しうるなら一度警告する
    const previewMisfireCount = casts.filter((c) => previews[c.allyId]?.misfirePos).length
    const dangerous =
      collapseSeen && previewMisfireCount > 0 && instability + previewMisfireCount >= INSTABILITY.misfireLimit
    if (dangerous && !confirmArmed) {
      setConfirmArmed(true)
      return
    }
    setConfirmArmed(false)
    const { state: after, resolution } = resolveAllyCasts(battle, casts, castingIds, {
      instability,
      misfireRoll: Math.random(), // 半径ばらつき（04b §4b.3）。ロジックは純粋関数のまま乱数だけ注入
    })
    pendingEventsRef.current = {
      gained: resolution.misfires.length,
      enemyMisfired: resolution.misfires.some((m) => m.owner === 'enemy'),
      logLines: resolution.log.filter((l) => l.kind !== 'info').map((l) => l.text),
    }
    const bullets: AnimBullet[] = []
    const orbits: AnimOrbit[] = []
    for (const s of resolution.allyShots) {
      if (s.kind === 'orbit') {
        orbits.push({ ring: s.path, hitEnemyIds: s.sweptEnemyIds, carves: s.carves, broken: s.broken, speed: s.ringSpeed })
      } else if (s.flight) {
        bullets.push({
          samples: s.flight.samples.map((x, i) => ({
            pos: x.pos,
            speed: x.speed,
            arcLen: x.arcLen,
            z: s.path[i]?.z ?? 0, // 発射時の色/形（#21）
          })),
          side: 'ally',
          misfirePos: s.misfirePos,
          carves: s.carves,
          impacts: s.hits.map((h) => ({ id: h.targetId, side: 'enemy' as const, arcLen: h.arcLen })),
          vanished: s.flight?.end === 'vanished', // 速度0で霧散（#38）
        })
      }
    }
    // 結界の破壊点を霧散演出の同期点として渡す（#64：BattleCanvas は弾がこの点へ到達した
    // 瞬間から散らし始める。無ければ従来どおり既定タイミングで散る）
    const breakCarve = (ring: ZPoint[], pos: Vec2 | null | undefined): CarveBurst[] =>
      pos ? [{ pos, r: 1, arcLen: 0, attr: ringAverageAttr(ring), obstacleId: '' }] : []
    // guardian 敵の防御結界も周回として描く（#28）。壁/弾に負けたら霧散（#34）
    for (const er of resolution.enemyRings) {
      orbits.push({
        ring: er.ring,
        hitEnemyIds: [],
        carves: breakCarve(er.ring, er.breakPos),
        broken: er.broken,
        speed: er.ringSpeed,
      })
    }
    // 持続周回（#39）：前ターンから残っている結界も回転表示。今ターン相殺で消えたら霧散させる
    const prevOrbits = battle.orbits ?? []
    for (const po of prevOrbits) {
      const survived = resolution.orbits.some((o) => o.id === po.id)
      orbits.push({
        ring: po.ring,
        hitEnemyIds: [],
        carves: breakCarve(po.ring, resolution.orbitBreaks[po.id]),
        broken: !survived,
        speed: po.ringSpeed,
      })
    }
    for (const es of resolution.enemyShots) {
      bullets.push({
        samples: es.flight.samples.map((x) => ({
          pos: x.pos,
          speed: x.speed,
          arcLen: x.arcLen,
          z: zfieldAt(es.traj, x.pos), // 敵弾も z 場で色/形が決まる（#28）
        })),
        side: 'enemy',
        misfirePos: es.misfired ? es.misfirePos : null, // 崩し手の暴発（#42）：解決したときだけ爆発演出
        carves: es.carves,
        impacts: es.hits.map((h) => ({ id: h.targetId, side: 'ally' as const, arcLen: h.arcLen })),
        vanished: es.flight.end === 'vanished', // 結界/壁で止められて霧散（#38）
      })
    }
    // 着弾時に鳴らす効果音を予約（#10）
    const kinds = new Set(resolution.log.map((l) => l.kind))
    const sfx: SfxKind[] = []
    if (kinds.has('misfire')) sfx.push('misfire')
    if (kinds.has('playerHit')) sfx.push('hit')
    if (kinds.has('orbit')) sfx.push('orbit')
    if (kinds.has('enemyHit')) sfx.push('enemyHit')
    if (resolution.clashes.length > 0) sfx.push('clash') // パリィ/結界の「バチッ」（#38）
    sfxRef.current = sfx
    // 撃破演出（05c §6.5・#46/#51）：このターン hp>0→hp<=0 になった敵を種族別に消滅させる。
    // 位置・種族・ティアは撃破前の敵（battle.enemies）から取る（描画のみ・ロジック不変）。
    const deaths: EnemyDeath[] = []
    for (const before of battle.enemies) {
      if (before.hp <= 0) continue
      const nowDead = after.enemies.find((x) => x.id === before.id)
      if (!nowDead || nowDead.hp > 0) continue
      // ボスは断末魔（finale=pending/cast）の間は HP0 でも崩壊させない。撃破確定（cleared）でのみ最終崩壊（#51）。
      if (before.boss && after.outcome !== 'cleared') continue
      deaths.push({
        id: before.id,
        pos: before.pos,
        species: speciesOf(before),
        element: before.element,
        tier: tierOf(before.level),
        hitboxRadius: before.hitboxRadius,
        boss: before.boss,
      })
    }
    const bossView = { phase: after.bossPhase, finale: after.finale, outcome: after.outcome }
    const anim: ResolveAnimation = {
      bullets,
      orbits,
      clashes: resolution.clashes,
      popups: resolution.popups,
      deaths,
      bossView,
    }
    setBattle({ ...battle, phase: 'resolve' })
    setAnimation(anim)
    setPendingState(after)
    // 見返し（プレイバック）用に、解決前の盤面ごと控えておく（直近 REPLAY_KEEP ターンぶん）
    setReplays((prev) =>
      [
        ...prev,
        {
          turn: battle.turn,
          animation: anim,
          allies: battle.allies,
          enemies: battle.enemies,
          obstacles: battle.obstacles,
          rField: battle.rField,
        },
      ].slice(-REPLAY_KEEP),
    )
    setReplay(null)
    setTurnResult(null)
    if (!testPlayActive) setTotalTurns((n) => n + 1)
    playSfx('fire')
  }

  const snapshotTime = () => setClearSnapshotMs(performance.now() - (runStartMs ?? performance.now()))

  /** 準備済みの次ターン状態を盤面へ反映する（onAnimationDone の後半・DoT撃破演出の後にも再利用）。 */
  const applyPreparedTurn = (prep: ReturnType<typeof prepareTurn>) => {
    setBattle(prep.state)
    setCastingIds(prep.castingEnemyIds)
    setImpairedIds(prep.impairedAllyIds)
    setTouchedAllies(new Set()) // #49：準備状況は毎ターンリセット
    const stillActive = prep.state.allies.find((a) => a.id === activeAllyId)
    if (!stillActive || stillActive.hp <= 0) {
      const firstAlive = prep.state.allies.find((a) => a.hp > 0)
      if (firstAlive) setActiveAllyId(firstAlive.id)
    }
    if (prep.state.outcome === 'cleared') {
      playSfx('clear')
      snapshotTime()
      // テストプレイ中（#67 §7）は結果画面を出さず、そのままエディタへ戻る
      if (testPlayActive) endTestPlay()
      else setScreen('stageClear')
    } else if (prep.state.outcome === 'gameover') {
      playSfx('gameover')
      if (testPlayActive) endTestPlay()
      else setScreen('gameover')
    }
  }

  const onAnimationDone = () => {
    // DoT（burn）撃破の消滅演出を挟んでいた場合は、準備済みの次ターンをそのまま反映して終える
    // （prepareTurn は再実行しない＝継続ダメージの二重適用を防ぐ・演出のみ・バグ修正）。
    if (pendingPrepRef.current) {
      const prep = pendingPrepRef.current
      pendingPrepRef.current = null
      setAnimation(null)
      setPendingState(null)
      applyPreparedTurn(prep)
      return
    }
    const after = pendingState
    setAnimation(null)
    setPendingState(null)
    // 予約した着弾効果音を再生
    sfxRef.current.forEach((k) => playSfx(k))
    sfxRef.current = []
    if (!after) return

    // ===== 暴発の累積とイベント判定（04b）。勝敗判定より先に破局を見る =====
    const ev = pendingEventsRef.current
    pendingEventsRef.current = null
    let count = instability
    let overlay: { title: string; lines: string[] } | null = null
    if (ev) {
      count = instability + ev.gained
      setInstability(count)
      setStageMisfires((s) => s + ev.gained)
      if (ev.enemyMisfired && !demoSeen) setDemoSeen(true)
      // 破局（致死期・04b §4b.2）：初回崩壊済みで上限到達＝ステージ全体暴発。勝敗に関わらずゲームオーバー。
      // 暴発の効果範囲がステージ全体を覆う崩壊演出を再生してから、ゲームオーバー画面へ遷移する
      if (collapseSeen && isLethal(count)) {
        setCollapseGameover(true)
        setBattle(after)
        playSfx('misfire')
        setCollapsePlaying(true)
        return
      }
      // 初回崩壊（閾値到達 or 保証面・一度きり）：グリモワールの介入で救済し、以後メーターを開示
      if (shouldFirstCollapse(count, after.stageIndex + 1, after.turn, collapseSeen)) {
        setCollapseSeen(true)
        overlay = { title: '崩壊 ― 頁の気配', lines: COLLAPSE_FIRST }
      } else if (ev.enemyMisfired && !demoSeen) {
        // 敵の暴発を初めて見た（RUPTOR_DEMO・図鑑補足つき・一度きり）
        overlay = { title: '暴発 ― 式の破れ', lines: [...RUPTOR_DEMO, CODEX_MISFIRE_HINT] }
      }
    }
    // ボス戦の演出（#45）：断末魔の予告 ＞ 床崩落（初回崩壊が同時なら初回崩壊を優先）
    if (!overlay && after.finale === 'pending' && battle?.finale === undefined) {
      overlay = { title: '断末魔 ― 三つの綻び', lines: COLLAPSE_FINAL }
    }
    if (!overlay && (after.bossPhase ?? 0) > (battle?.bossPhase ?? 0)) {
      overlay = { title: '崩落 ― 下の階層へ', lines: COLLAPSE_PHASE }
    }
    if (overlay) setStoryOverlay(overlay)

    // ターン結果パネル（DC プロトタイプ v3）。物語オーバーレイが出るターンはそちらへ譲る
    if (!overlay && after.outcome === 'ongoing') {
      const mis = ev?.gained ?? 0
      setTurnResult({
        turn: battle?.turn ?? after.turn,
        title: mis > 0 ? `暴発 ${mis} 回` : 'ターン解決',
        lines: (ev?.logLines ?? []).slice(-6),
      })
    }

    if (after.outcome === 'cleared') {
      // 暴発ゼロでクリアしたら膜がわずかに落ち着く（04b §4b.1・任意の緩和）
      setInstability(applyStageClearRelief(count, stageMisfires + (ev?.gained ?? 0)))
      playSfx('clear')
      snapshotTime()
      setBattle(after)
      // テストプレイ中（#67 §7）は結果画面を出さず、そのままエディタへ戻る
      if (testPlayActive) endTestPlay()
      else setScreen('stageClear')
      return
    }
    if (after.outcome === 'gameover') {
      playSfx('gameover')
      setBattle(after)
      if (testPlayActive) endTestPlay()
      else setScreen('gameover')
      return
    }
    const prep = prepareTurn(after)
    // DoT（burn）撃破の消滅演出（バグ修正・05c §6.5）：prepareTurn の継続ダメージで hp>0→hp<=0 に
    // なった敵は、通常命中・掃射・暴発と同じく種族別の撃破アニメで消す。位置・種族は撃破前（after）から取る。
    // ボスは断末魔中は崩壊させない（通常撃破と同じ扱い）。演出のみでロジック（hp/勝敗）は不変。
    const burnDeaths: EnemyDeath[] = []
    for (const before of after.enemies) {
      if (before.hp <= 0) continue
      const now = prep.state.enemies.find((x) => x.id === before.id)
      if (!now || now.hp > 0) continue
      if (before.boss && prep.state.outcome !== 'cleared') continue
      burnDeaths.push({
        id: before.id,
        pos: before.pos,
        species: speciesOf(before),
        element: before.element,
        tier: tierOf(before.level),
        hitboxRadius: before.hitboxRadius,
        boss: before.boss,
      })
    }
    if (burnDeaths.length > 0) {
      // 撃破演出を一度挟む：deaths だけのアニメを再生し、完了後に準備済みの次ターンを反映する。
      // バグ修正：主解決（fireAll）で撃破済みの敵が burn 中間演出で生き返って見えないよう、
      // 盤面を after（主解決後の敵配列）へ更新してから再生する。BattleCanvas は after.enemies を描くので、
      // 主解決で hp<=0 の敵は隠れ、burnDeaths の敵だけが消滅アニメで消える。bossView も after 準拠にする。
      pendingPrepRef.current = prep
      setBattle({ ...after, phase: 'resolve' })
      setAnimation({
        bullets: [],
        orbits: [],
        clashes: [],
        popups: [],
        deaths: burnDeaths,
        bossView: { phase: after.bossPhase, finale: after.finale, outcome: prep.state.outcome },
      })
      return
    }
    applyPreparedTurn(prep)
  }

  // ===== 全画面（タイトル/物語/結果） =====
  // ステージエディタ（#67）：開発ビルド専用。到達経路（devEditorFromUrl・タイトルの DEV ボタン）は
  // どちらも DEV ガード済みなので、本番ビルドで screen==='editor' になることはない。
  if (screen === 'editor') {
    return (
      <div className="app">
        <StageEditor
          onBack={() => setScreen('title')}
          onTestPlay={(stage, inst, idx) => {
            setTestPlayReturn('editor')
            startTestPlay(stage, inst, idx)
          }}
        />
      </div>
    )
  }
  if (screen === 'title') {
    return (
      <div className="app">
        <TitleScreen
          onStart={() => {
            ensureAudio()
            startMusic()
            setRunStartMs(performance.now())
            // 新しいラン：膜の摩耗と開示状態をリセット（04b）
            setInstability(0)
            setStageStartInstability(0)
            setStageMisfires(0)
            setTotalTurns(0)
            setCollapseSeen(false)
            setDemoSeen(false)
            setCollapseGameover(false)
            setCollapsePlaying(false)
            setStoryOverlay(null)
            setScreen('prologue')
          }}
          onGuide={() => setGuideOpen(true)}
          onStageSelect={DEV ? () => setScreen('stageSelect') : undefined}
        />
        {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}
        {DEV && (
          <div className="dev-stage-jump">
            <span>DEV ステージ直行：</span>
            {STAGES.map((s, i) => (
              <button key={s.name} className="btn small" onClick={() => devJumpToStage(i)}>
                {i + 1}
              </button>
            ))}
            <button className="btn small" onClick={() => setScreen('editor')}>
              ステージエディタ
            </button>
          </div>
        )}
      </div>
    )
  }
  // 「間を選ぶ／試しの間」は開発用ツール（#67 のエディタと同じ扱い）。
  // 本番ビルドでは到達経路を出さず、直接この画面になってもタイトルへ戻す。
  if (screen === 'stageSelect') {
    if (!DEV) {
      setScreen('title')
      return null
    }
    return (
      <div className="app">
        <div className="screen-center stage-select">
          <h2>間を選ぶ</h2>
          <p className="hint">選んだ間から始める。膜の摩耗はその時点から数え直す。</p>
          <div className="room-rail">
            {STAGES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`room-chip${i === stageIndex ? ' selected' : ''}`}
                title={s.name}
                onClick={() => {
                  setStageIndex(i)
                  setInstability(0)
                  setStageStartInstability(0)
                  if (runStartMs === null) setRunStartMs(performance.now())
                  setScreen('stageIntro')
                }}
              >
                <span className="room-mark" aria-hidden="true" />
                <span className="room-no">{i + 1}</span>
                <span className="room-name">{s.name}</span>
              </button>
            ))}
          </div>
          <div className="center-actions">
            <button className="btn" onClick={startPractice}>
              試しの間 ― 壁とパリィ
            </button>
            <button className="btn" onClick={() => setGuideOpen(true)}>
              手引き（図解）
            </button>
            <button className="btn" onClick={() => setScreen('endroll')}>
              エンドロールを見る
            </button>
            <button className="btn" onClick={() => setScreen('title')}>
              タイトルへ
            </button>
          </div>
        </div>
        {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}
      </div>
    )
  }
  if (screen === 'prologue') {
    return (
      <div className="app">
        <StoryScreen
          title="序章 ― 古代式の魔導書"
          lines={PROLOGUE}
          onNext={() => {
            setStageIndex(0)
            setScreen('stageIntro')
          }}
          nextLabel="遺跡へ入る"
        />
      </div>
    )
  }
  if (screen === 'stageIntro') {
    const stage = STAGES[stageIndex]
    // 降下トランジション：刻印（古代人の言葉）→ 背景描写（都市の痕跡）→ 導入（story.md）
    const lines = [
      `【刻印】 ${INSCRIPTIONS[stageIndex] ?? ''}`,
      SCENERIES[stageIndex] ?? '',
      ...stage.introText,
    ].filter((l) => l.length > 0)
    return (
      <div className="app">
        <StoryScreen title={stage.name} lines={lines} onNext={startBattle} nextLabel="戦闘開始" />
      </div>
    )
  }
  if (screen === 'stageClear') {
    const stage = STAGES[stageIndex]
    const isLast = stageIndex >= STAGES.length - 1
    return (
      <div className="app">
        <ResultScreen
          title="ステージクリア！"
          lines={stage.clearText}
          time={{ label: '経過タイム', value: formatTime(clearSnapshotMs) }}
          actions={[
            isLast
              ? { label: 'エンディングへ', onClick: () => setScreen('ending'), primary: true }
              : {
                  label: '次のステージへ',
                  primary: true,
                  onClick: () => {
                    // 次ステージのリトライ起点として現在の instability をスナップショット（04b）
                    setStageStartInstability(instability)
                    setStageIndex((i) => i + 1)
                    setScreen('stageIntro')
                  },
                },
          ]}
        />
        {storyOverlayEl}
      </div>
    )
  }
  if (screen === 'gameover') {
    return (
      <div className="app">
        {/* 「崩壊」（膜が破れた）と「全滅」（術者が力尽きた）は別の終わり方として出し分ける */}
        <ResultScreen
          title={collapseGameover ? '崩壊 ― 膜の破れ' : '全滅 ― 術者が力尽きた'}
          lines={
            collapseGameover
              ? GAMEOVER_COLLAPSE
              : [
                  '術者たちは力尽きて倒れた。膜は保たれたが、この間はここまで。',
                  GAMEOVER_TEXT,
                ]
          }
          actions={[
            { label: 'このステージをやり直す', primary: true, onClick: startBattle },
            { label: 'タイトルへ', onClick: () => setScreen('title') },
          ]}
        />
        {storyOverlayEl}
      </div>
    )
  }
  if (screen === 'ending') {
    return (
      <div className="app">
        <ResultScreen
          title="エンディング"
          lines={EPILOGUE}
          time={{ label: 'クリアタイム', value: formatTime(clearSnapshotMs) }}
          actions={[{ label: 'エンドロールへ ▸', primary: true, onClick: () => setScreen('endroll') }]}
        />
      </div>
    )
  }

  if (screen === 'endroll') {
    return (
      <div className="app">
        <Endroll time={formatTime(clearSnapshotMs)} turns={totalTurns} onBack={() => setScreen('title')} />
      </div>
    )
  }

  // ===== バトル画面 =====
  if (!battle) return null
  const composing = battle.phase === 'compose' && !animation
  const activeComposer = composers[activeAllyId]
  const anyCastable = battle.allies.some((a) => a.hp > 0 && !impairedIds.includes(a.id))

  // 敵の予告（ゴースト）・自分の照準・z 場は、作成フェーズなら最初から全部見せる。
  // 「敵公開 → 術式を構える」の 2 段ゲートは廃止（読み出しストリップが役目を引き継ぐ）。
  const showAimPreview = composing

  // ===== 撃つ前に読める値（DC プロトタイプ v3 の読み出し）=====
  // 射線上に何があるか → t=r での z・強度・速度・相性 → 当たれば何点、までを 1 行に畳む。
  const battleObstacles = battle.mechanics.obstacles ? battle.obstacles : []
  const readouts: Record<string, Readout> = {}
  for (const a of battle.allies) {
    const c = composers[a.id]
    if (!c || a.hp <= 0) continue
    readouts[a.id] = computeReadout({
      ally: a,
      composer: c,
      enemies: battle.enemies,
      obstacles: battleObstacles,
      orbits: battle.orbits ?? [],
      rField: battle.rField,
      impaired: impairedIds.includes(a.id),
    })
  }
  const activeReadout = readouts[activeAllyId]

  /** ⟳ 解く：形（式）はそのままに、的の座標を通る θ を数値的に探す。 */
  const solveAngleNow = () => {
    const c = composers[activeAllyId]
    const ally = battle.allies.find((a) => a.id === activeAllyId)
    if (!c || !ally || c.mode !== 'rotate') return
    const alive = battle.enemies.filter((e) => e.hp > 0)
    if (alive.length === 0) return
    const target =
      activeReadout?.ray.pos ??
      alive.reduce((best, e) =>
        Math.hypot(e.pos.x - ally.pos.x, e.pos.y - ally.pos.y) <
        Math.hypot(best.pos.x - ally.pos.x, best.pos.y - ally.pos.y)
          ? e
          : best,
      ).pos
    const hitR = alive[0]?.hitboxRadius ?? 2
    setSolving(true)
    // 全周を舐める重い探索なので、スピナーを 1 フレーム見せてから走らせる
    setTimeout(() => {
      const angle = solveAngle(
        (a) => buildComposerTrajectory({ ...c, angle: a }, ally.pos, battle.rField),
        c.speed,
        target,
        hitR,
        c.angle,
      )
      onChange({ angle })
      setSolving(false)
    }, 0)
  }

  // ===== 見返し（プレイバック）=====
  const replayEntry = replay ? (replays.find((r) => r.turn === replay.turn) ?? null) : null
  const canReplay = composing && replays.length > 0

  const activeZAt = activeComposer ? buildZAt(activeComposer) : null
  const railMenu = (
    <div className="menu-wrap">
      <button
        className="btn small menu-toggle"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        aria-label="メニュー"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span aria-hidden="true">≡</span>
      </button>
      {menuOpen && (
        <>
          <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="menu-pop">
            <button
              className={`btn small sound-toggle${muted ? ' muted' : ''}`}
              onClick={() => {
                ensureAudio()
                setMutedState(toggleMuted())
              }}
            >
              {muted ? '音オフ' : '音オン'}
            </button>
            {DEV && (
              <button
                className="btn small"
                onClick={() => {
                  setMenuOpen(false)
                  setScreen('stageSelect')
                }}
              >
                間を選ぶ（中断・DEV）
              </button>
            )}
            {testPlayActive && (
              <button
                className="btn small"
                onClick={() => {
                  setMenuOpen(false)
                  endTestPlay()
                }}
              >
                <span aria-hidden="true">■</span>{' '}
                {testPlayReturn === 'stageSelect' ? '試しの間をやめる' : 'テストプレイ中断 → エディタへ'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="app">
      <div className="gm-shell">
        {/* ===== 上段レール：間・進行・ターン・味方/敵の合計HP・膜 ===== */}
        <TopRail
          stageLabel={stageLabel || STAGES[battle.stageIndex].name}
          boss={!testPlayActive && STAGES[battle.stageIndex].boss}
          rooms={STAGES.map((st) => st.name)}
          roomIndex={testPlayActive ? -1 : battle.stageIndex}
          sideRoomLabel={
            testPlayActive ? (testPlayReturn === 'stageSelect' ? '試しの間' : 'テストプレイ') : undefined
          }
          turn={battle.turn}
          allies={battle.allies}
          enemies={battle.enemies}
          instability={{ count: instability, visible: collapseSeen }}
          menu={railMenu}
        />

        {/* ===== 読み出しストリップ：いま何が読めているか ===== */}
        {composing && activeReadout ? (
          <ReadoutStrip readout={activeReadout} />
        ) : (
          <div className="readout-strip tone-dim">
            <span className="readout-title">解決中…</span>
            <span className="readout-sub">魔法が進行・解決しています。</span>
          </div>
        )}

        {/* ===== 本体：盤面 ｜ 右レール ===== */}
        <div className="gm-body">
          <div className="gm-board">
            <div className="gm-board-inner">
              {replayEntry && replay ? (
                <BattleCanvas
                  key={`replay-${replay.turn}`}
                  allies={replayEntry.allies}
                  enemies={replayEntry.enemies}
                  obstacles={replayEntry.obstacles}
                  rField={replayEntry.rField}
                  activeAllyId={null}
                  animation={replayEntry.animation}
                  replay
                  playback={{
                    paused: replay.paused,
                    seekMs: replay.seekMs,
                    seekToken: replay.seekToken,
                    rate: replay.rate,
                  }}
                  onPlaybackTick={(posMs, totalMs) =>
                    setReplay((r) =>
                      !r || (Math.abs(r.posMs - posMs) < 24 && r.totalMs === totalMs)
                        ? r
                        : { ...r, posMs, totalMs },
                    )
                  }
                />
              ) : (
                <BattleCanvas
                  key="live"
                  allies={battle.allies}
                  enemies={battle.enemies}
                  obstacles={battle.obstacles}
                  rField={battle.rField}
                  activeAllyId={activeAllyId}
                  playerPaths={showAimPreview ? playerPaths : undefined}
                  misfirePoints={showAimPreview ? misfirePoints : undefined}
                  zField={showAimPreview ? activeZField ?? undefined : undefined}
                  showZField
                  zOfT={activeZAt}
                  standingOrbits={composing ? standingOrbits : undefined}
                  ghostPaths={composing ? ghostPaths : undefined}
                  ghostMisfires={composing ? ghostMisfires : undefined}
                  anomaly={anomalyLevel(instability)}
                  misfireBand={varianceOf(instability) > 0 ? misfireRadiusBand(instability) : undefined}
                  doom={collapseProximity(instability)}
                  collapse={collapsePlaying}
                  onCollapseDone={() => {
                    setCollapsePlaying(false)
                    playSfx('gameover')
                    // テストプレイ中（#67 §7）は結果画面を出さず、そのままエディタへ戻る
                    if (testPlayActive) endTestPlay()
                    else setScreen('gameover')
                  }}
                  animation={animation}
                  onAnimationDone={onAnimationDone}
                  fitPoints={showAimPreview ? fitPoints : undefined}
                  onFieldClick={showAimPreview && fitPickActive ? onFieldClick : undefined}
                  pickMode={showAimPreview && fitPickActive}
                  onAim={showAimPreview && !fitPickActive && activeComposer?.mode === 'rotate' ? aimAt : undefined}
                  aimAngle={activeComposer?.mode === 'rotate' ? activeComposer.angle : undefined}
                  aimEnemyId={activeReadout?.ray.enemyId ?? null}
                />
              )}

              {/* 盤面に重ねる読み（θ と凡例）。ドラッグで射線が回ることをここで伝える */}
              {composing && activeComposer && (
                <div className="board-aim">
                  θ <b>{Math.round((activeComposer.angle * 180) / Math.PI)}°</b>
                  <span className="sep">|</span>
                  {fitPickActive ? '盤面をタップで通過点' : '盤面をドラッグで回転'}
                </div>
              )}
              <div className="board-legend">
                同心円 = z(t)・半径が飛行距離 t
                <br />
                <span className="el-light">金＝光</span> / <span className="el-dark">紫＝闇</span> /
                無色＝中立・濃さ＝強度
              </div>

              {/* 見返し（プレイバック）：解決済みターンをスクラブして経路・命中・削れを追う */}
              {canReplay &&
                (replay ? (
                  <PlaybackBar
                    turns={replays.map((r) => r.turn)}
                    currentTurn={replay.turn}
                    onSelectTurn={(t) =>
                      setReplay({ turn: t, paused: false, seekMs: 0, seekToken: 0, rate: 1, posMs: 0, totalMs: 1 })
                    }
                    posMs={replay.posMs}
                    totalMs={replay.totalMs}
                    paused={replay.paused}
                    rate={replay.rate}
                    onTogglePlay={() =>
                      setReplay((r) => {
                        if (!r) return r
                        // 終端で再生を押したら頭から流し直す
                        const restart = r.paused && r.posMs >= r.totalMs - 16
                        return restart
                          ? { ...r, paused: false, seekMs: 0, seekToken: r.seekToken + 1, posMs: 0 }
                          : { ...r, paused: !r.paused }
                      })
                    }
                    onSeek={(ms) =>
                      setReplay((r) =>
                        r ? { ...r, paused: true, seekMs: ms, seekToken: r.seekToken + 1, posMs: ms } : r,
                      )
                    }
                    onStep={(d) =>
                      setReplay((r) => {
                        if (!r) return r
                        const ms = Math.max(0, Math.min(r.totalMs, r.posMs + d))
                        return { ...r, paused: true, seekMs: ms, seekToken: r.seekToken + 1, posMs: ms }
                      })
                    }
                    onCycleRate={() =>
                      setReplay((r) => (r ? { ...r, rate: r.rate === 1 ? 0.5 : r.rate === 0.5 ? 0.25 : 1 } : r))
                    }
                    onClose={() => setReplay(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn small replay-open"
                    onClick={() => {
                      const last = replays[replays.length - 1]
                      setReplay({
                        turn: last.turn,
                        paused: false,
                        seekMs: 0,
                        seekToken: 0,
                        rate: 1,
                        posMs: 0,
                        totalMs: 1,
                      })
                    }}
                  >
                    ⏮ 見返す
                  </button>
                ))}
            </div>
          </div>

          {/* ===== 右レール：読み取り値・z(t)・術者 ===== */}
          <div className="gm-rail">
            {activeReadout && <ReadoutStats readout={activeReadout} />}
            <ZPlot zAt={activeZAt} rDistance={activeReadout?.ray.d ?? 0} pole={activeReadout?.pole ?? null} />
            <CasterCards
              allies={battle.allies}
              composers={composers}
              readouts={readouts}
              activeAllyId={activeAllyId}
              impairedIds={impairedIds}
              touchedIds={[...touchedAllies]}
              onSelect={switchAlly}
            />
          </div>
        </div>

        {/* ===== 詠唱コンソール ＋ 発射列 ===== */}
        <div className="gm-console">
          {composing && activeComposer && activeReadout ? (
            <>
              <FunctionPanel
                composer={activeComposer}
                onChange={onChange}
                readout={activeReadout}
                focus={consoleFocus}
                onFocusChange={setConsoleFocus}
                onSolveAngle={solveAngleNow}
                solving={solving}
                draftOpen={draftOpen}
                onToggleDraft={() => setDraftOpen((o) => !o)}
                padOpen={padOpen}
              />
              <div className="fire-col">
                <div className="fire-tools">
                  <button type="button" className="btn small" onClick={() => setPadOpen((o) => !o)}>
                    記号盤 {padOpen ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    className="btn small tool-help"
                    aria-label="手引き"
                    onClick={() => setGuideOpen(true)}
                  >
                    ?
                  </button>
                  <button type="button" className="btn small tool-codex" onClick={() => setCodexOpen(true)}>
                    図鑑
                  </button>
                </div>
                <button
                  type="button"
                  className="btn small"
                  onClick={recommendAll}
                  disabled={!anyCastable}
                  title="全員に無難に当たる術式を割り当てる"
                >
                  全員おまかせ
                </button>
                <button
                  type="button"
                  className={`fire-btn${confirmArmed ? ' danger' : ''}`}
                  onClick={() => fireAll()}
                >
                  <span className="fire-label">
                    {confirmArmed ? '⚠ それでも発射' : anyCastable ? '詠唱' : '次のターンへ'}
                  </span>
                  <span className="fire-sub">
                    {confirmArmed ? '崩壊の危険' : anyCastable ? '3人 同時発射 ▸▸' : '▸▸'}
                  </span>
                </button>
              </div>
            </>
          ) : (
            <div className="console-resolving">魔法が進行・解決しています…</div>
          )}
        </div>
      </div>

      {/* 膜の摩耗：赤み・降る塵・亀裂・一瞬のバグりを画面全体へ（残り回数は数字で見せない） */}
      <AnomalyOverlay instability={instability} live={!storyOverlay && !turnResult} />

      {/* 作図台：関数空間の方眼紙。盤面の上に重ねる */}
      {draftOpen && composing && activeComposer && activeReadout && (
        <div className="draft-overlay" onClick={() => setDraftOpen(false)} role="presentation">
          <div onClick={(e) => e.stopPropagation()}>
            <DraftPad
              composer={activeComposer}
              onChange={onChange}
              rDistance={activeReadout.ray.d}
              focus={consoleFocus}
              onClose={() => setDraftOpen(false)}
              boardPick={
                activeComposer.mode === 'rotate' && consoleFocus === 'y'
                  ? {
                      active: fitPickActive,
                      count: fitPoints.length,
                      onToggle: toggleFitPick,
                      onRun: runFit,
                      onClear: clearFit,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {codexOpen && (
        <Codex
          activePresetId={activeComposer?.presetId}
          seenEnemies={seenEnemies}
          onClose={() => setCodexOpen(false)}
        />
      )}
      {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}
      {turnResult && !storyOverlay && (
        <TurnResultOverlay
          turn={turnResult.turn}
          title={turnResult.title}
          lines={turnResult.lines}
          onDismiss={() => setTurnResult(null)}
        />
      )}
      {storyOverlayEl}
    </div>
  )
}
