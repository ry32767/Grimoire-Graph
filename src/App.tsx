import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ally, AllyCast, BattleState, Vec2 } from './game/types'
import { createBattleState, prepareTurn, resolveAllyCasts } from './game/battle'
import { planEnemyShots, enemyFlight } from './game/enemyAI'
import { zfieldAt } from './game/attribute'
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
  NO_FIT,
} from './components/composer'
import { fitToPoints, renderExpr } from './game/exprFit'
import BattleCanvas, { type ResolveAnimation, type AnimBullet, type AnimOrbit } from './components/BattleCanvas'
import Hud from './components/Hud'
import BattleLog from './components/BattleLog'
import FunctionPanel from './components/FunctionPanel'
import ZFieldControls from './components/ZFieldControls'
import Codex from './components/Codex'
import Guide from './components/Guide'
import { TitleScreen, StoryScreen, ResultScreen } from './components/screens'
import { ensureAudio, playSfx, startMusic, toggleMuted, type SfxKind } from './audio/sound'

type Screen = 'title' | 'prologue' | 'stageIntro' | 'battle' | 'stageClear' | 'gameover' | 'ending'

/** 開発時のみ：URL の ?stage=N（1始まり）で指定ステージへ直行（通常プレイ＝本番ビルドでは無効・#33）。 */
const DEV = import.meta.env.DEV
function devStageFromUrl(): number | null {
  if (!DEV || typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('stage')
  if (!raw) return null
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 1 && n <= STAGES.length ? n - 1 : null
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

function makeComposer(angle: number): ComposerState {
  const coeffs = defaultCoeffs(ROTATE_PRESETS[0])
  const zPreset = ZFIELD_PRESETS[0] // 一定（const）
  const zCoeffs = defaultZCoeffs(zPreset)
  const expr = ROTATE_PRESETS[0].toExpr(coeffs)
  const zExpr = zPreset.toExpr(zCoeffs)
  const base: ComposerState = {
    mode: 'rotate',
    presetId: 'line',
    coeffs,
    angle,
    speed: FIELD.fixedSpeed,
    useFree: false,
    freeExpr: expr,
    freeError: null,
    ...NO_FIT,
    zPresetId: zPreset.id,
    zCoeffs,
    zUseFree: false,
    zFreeExpr: zExpr,
    zFreeError: null,
    zFitTemplate: '',
    zFitParams: [],
    zFitValues: {},
  }
  // 射出（回転）も z 場も、既定で係数化フロー：式中の数値をスライダー化する（#46/#52）
  return { ...base, ...parametricPatch(expr, 'x'), ...zParametricPatch(zExpr) }
}

/** パーティ各自の初期コンポーザ（敵陣（上方）へ向ける）。 */
function initComposers(party: Ally[]): Record<string, ComposerState> {
  const m: Record<string, ComposerState> = {}
  for (const a of party) m[a.id] = makeComposer(aimAngle(a.pos, { x: 0, y: 19 }, 1))
  return m
}

export default function App() {
  const devStage = devStageFromUrl()
  const [screen, setScreen] = useState<Screen>(devStage !== null ? 'stageIntro' : 'title')
  const [stageIndex, setStageIndex] = useState(devStage ?? 0)
  const [battle, setBattle] = useState<BattleState | null>(null)
  const [castingIds, setCastingIds] = useState<string[]>([])
  const [impairedIds, setImpairedIds] = useState<string[]>([])
  const [composers, setComposers] = useState<Record<string, ComposerState>>({})
  const [activeAllyId, setActiveAllyId] = useState<string>('')
  const [animation, setAnimation] = useState<ResolveAnimation | null>(null)
  const [pendingState, setPendingState] = useState<BattleState | null>(null)
  // #46：通過点フィット。点ピック中フラグと、選んだ通過点（数学座標）
  const [fitPickActive, setFitPickActive] = useState(false)
  const [fitPoints, setFitPoints] = useState<Vec2[]>([])
  // #54：スマホで属性 z 場を盤面（全画面）を見ながら調整するモード
  const [zAdjustMode, setZAdjustMode] = useState(false)
  // #48：スマホ向けの画面切替（盤面 ⇄ キャラ関数編集）。PC は CSS で常に両方表示
  const [view, setView] = useState<'stage' | 'edit'>('stage')
  // #48：ボタンを減らすためのメニュー（遊び方/図鑑/音）開閉
  const [menuOpen, setMenuOpen] = useState(false)
  // #49：このターンで術式を設定/変更した味方ID（準備状況の✓・発射前確認）
  const [touchedAllies, setTouchedAllies] = useState<Set<string>>(new Set())
  // #49：未設定の味方がいる時の発射確認オーバーレイ
  const [confirmFire, setConfirmFire] = useState(false)
  const [codexOpen, setCodexOpen] = useState(false)
  // #23：図鑑用に「遭遇した敵」を記録（セッション内・永続化しない）
  const [seenEnemies, setSeenEnemies] = useState<Set<string>>(new Set())
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideShown, setGuideShown] = useState(false)
  // #6：クリアタイム計測
  const [runStartMs, setRunStartMs] = useState<number | null>(null)
  const [clearSnapshotMs, setClearSnapshotMs] = useState(0)
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
  // 物語オーバーレイ（RUPTOR_DEMO／COLLAPSE_FIRST）：戦闘の上に一度だけ挟む
  const [storyOverlay, setStoryOverlay] = useState<{ title: string; lines: string[] } | null>(null)
  // 確認ゲート（04b §4b.2）：崩壊につながる暴発を含む発射は、一度警告してから撃つ
  const [confirmArmed, setConfirmArmed] = useState(false)
  // このターンの解決で起きたことを onAnimationDone へ引き継ぐ
  const pendingEventsRef = useRef<{ gained: number; enemyMisfired: boolean } | null>(null)
  // #10：音
  const sfxRef = useRef<SfxKind[]>([])
  const [muted, setMutedState] = useState(false)

  const aliveAllies = useMemo(() => battle?.allies.filter((a) => a.hp > 0) ?? [], [battle])

  // 各味方の軌道・プレビュー（作成フェーズ）
  const previews = useMemo(() => {
    if (!battle) return {} as Record<string, ReturnType<typeof computePreview>>
    const out: Record<string, ReturnType<typeof computePreview>> = {}
    for (const a of battle.allies) {
      if (a.hp <= 0) continue
      const c = composers[a.id]
      if (!c) continue
      const traj = buildComposerTrajectory(c, a.pos)
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
    // 遭遇した敵を図鑑に記録（#23）
    setSeenEnemies((prev) => new Set([...prev, ...stage.enemies.map((e) => e.name)]))
    // instability はステージ開始時点へ巻き戻す（リトライ対応・ラン全体では持ち越し・04b）
    setInstability(stageStartInstability)
    setStageMisfires(0)
    setCollapseGameover(false)
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
    setView('stage')
    setTouchedAllies(new Set())
    setScreen('battle')
    if (stageIndex === 0 && !guideShown) {
      setGuideOpen(true)
      setGuideShown(true)
    }
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
    const r = recommendCast(ally.pos, target, battle?.mechanics.obstacles ? battle.obstacles : [])
    // z 場は敵の反対極を最強で当てる一定値（#21）。係数化フローに乗せる（#52）
    const zPatch = { zPresetId: 'const', zCoeffs: { c: r.zConst }, ...zParametricPatch(`${r.zConst}`) }
    const expr = r.line ? `${r.line.a}*x` : (r.freeExpr ?? '')
    return { ...makeComposer(r.angle), ...parametricPatch(expr, 'x'), ...zPatch } as ComposerState
  }
  const recommend = () => {
    if (!battle || !activeAllyId) return
    const ally = battle.allies.find((a) => a.id === activeAllyId)
    if (!ally) return
    const c = recommendFor(ally)
    if (!c) return
    setComposers((m) => ({ ...m, [activeAllyId]: c }))
    markTouched(activeAllyId)
    vibrate(12)
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
      if (next) {
        setZAdjustMode(false)
        setView('stage') // 盤面へ移動して、そのまま点を選択→フィットできる（#54）
        vibrate(8)
      }
      return next
    })
  }
  // #54：点だけクリア（ピックは続ける）。盤面のフィットバー用
  const clearFitPoints = () => setFitPoints([])
  const onFieldClick = (p: Vec2) => {
    if (!fitPickActive) return
    setFitPoints((prev) => [...prev, p])
    vibrate(8)
  }
  // #54：スマホで盤面（全画面）を見ながら z 場を調整するモードへ入る
  const adjustZOnStage = () => {
    setFitPickActive(false)
    setZAdjustMode(true)
    setView('stage')
    vibrate(8)
  }
  const endZAdjust = () => {
    setZAdjustMode(false)
    setView('edit') // 調整を終えたら関数編集へ戻る
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
    onChange({ fitValues: values, freeExpr: renderExpr(spec, values), angle, useFree: true, freeError: null })
    // 点は残したまま（曲線が点に近づいた結果を確認できる）。ピックは抜ける。クリアは手動。
    setFitPickActive(false)
    vibrate(14)
  }
  // 別の味方に切り替えたらピック状態は破棄する。スマホではそのキャラの編集画面へ（#48）
  const switchAlly = (id: string) => {
    clearFit()
    setZAdjustMode(false)
    playSfx('select')
    vibrate(8)
    setActiveAllyId(id)
    setView('edit')
  }

  const fireAll = (force = false) => {
    if (!battle) return
    // #49：撃てる味方がいるのに未設定の味方がいたら、一度だけ確認する
    const castable = battle.allies.filter((a) => a.hp > 0 && !impairedIds.includes(a.id))
    const unset = castable.filter((a) => !touchedAllies.has(a.id))
    if (!force && castable.length > 0 && unset.length > 0) {
      setConfirmFire(true)
      return
    }
    setConfirmFire(false)
    clearFit()
    setZAdjustMode(false)
    setView('stage') // 発射＝盤面（ステージ）画面へ（#48）
    setMenuOpen(false)
    vibrate([18, 40, 18])
    const casts: AllyCast[] = []
    for (const a of battle.allies) {
      if (a.hp <= 0 || impairedIds.includes(a.id)) continue
      const c = composers[a.id]
      if (!c) continue
      const traj = buildComposerTrajectory(c, a.pos)
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
          impact: s.hitEnemyId ? { id: s.hitEnemyId, side: 'enemy', arcLen: s.hitArcLen } : null,
          vanished: s.flight?.end === 'vanished', // 速度0で霧散（#38）
        })
      }
    }
    // guardian 敵の防御結界も周回として描く（#28）。壁/弾に負けたら霧散（#34）
    for (const er of resolution.enemyRings) {
      orbits.push({ ring: er.ring, hitEnemyIds: [], carves: [], broken: er.broken, speed: er.ringSpeed })
    }
    // 持続周回（#39）：前ターンから残っている結界も回転表示。今ターン相殺で消えたら霧散させる
    const prevOrbits = battle.orbits ?? []
    for (const po of prevOrbits) {
      const survived = resolution.orbits.some((o) => o.id === po.id)
      orbits.push({ ring: po.ring, hitEnemyIds: [], carves: [], broken: !survived, speed: po.ringSpeed })
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
        impact: es.hitAllyId ? { id: es.hitAllyId, side: 'ally', arcLen: es.hitArcLen } : null,
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
    setBattle({ ...battle, phase: 'resolve' })
    setAnimation({ bullets, orbits, clashes: resolution.clashes, popups: resolution.popups })
    setPendingState(after)
    playSfx('fire')
  }

  const snapshotTime = () => setClearSnapshotMs(performance.now() - (runStartMs ?? performance.now()))

  const onAnimationDone = () => {
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
      // 破局（致死期・04b §4b.2）：初回崩壊済みで上限到達＝ステージ全体暴発。勝敗に関わらずゲームオーバー
      if (collapseSeen && isLethal(count)) {
        setCollapseGameover(true)
        playSfx('gameover')
        setBattle(after)
        setScreen('gameover')
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

    if (after.outcome === 'cleared') {
      // 暴発ゼロでクリアしたら膜がわずかに落ち着く（04b §4b.1・任意の緩和）
      setInstability(applyStageClearRelief(count, stageMisfires + (ev?.gained ?? 0)))
      playSfx('clear')
      snapshotTime()
      setBattle(after)
      setScreen('stageClear')
      return
    }
    if (after.outcome === 'gameover') {
      playSfx('gameover')
      setBattle(after)
      setScreen('gameover')
      return
    }
    const prep = prepareTurn(after)
    setBattle(prep.state)
    setCastingIds(prep.castingEnemyIds)
    setImpairedIds(prep.impairedAllyIds)
    setView('stage') // 次ターンは盤面（ステージ）画面から始める（#48）
    setTouchedAllies(new Set()) // #49：準備状況は毎ターンリセット
    const stillActive = prep.state.allies.find((a) => a.id === activeAllyId)
    if (!stillActive || stillActive.hp <= 0) {
      const firstAlive = prep.state.allies.find((a) => a.hp > 0)
      if (firstAlive) setActiveAllyId(firstAlive.id)
    }
    if (prep.state.outcome === 'cleared') {
      playSfx('clear')
      snapshotTime()
      setScreen('stageClear')
    } else if (prep.state.outcome === 'gameover') {
      playSfx('gameover')
      setScreen('gameover')
    }
  }

  // ===== 全画面（タイトル/物語/結果） =====
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
            setCollapseSeen(false)
            setDemoSeen(false)
            setCollapseGameover(false)
            setStoryOverlay(null)
            setScreen('prologue')
          }}
          onGuide={() => setGuideOpen(true)}
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
          </div>
        )}
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
        <ResultScreen
          title={collapseGameover ? '崩壊 ― 膜の破れ' : 'ゲームオーバー'}
          lines={collapseGameover ? GAMEOVER_COLLAPSE : [GAMEOVER_TEXT]}
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
          actions={[{ label: 'タイトルへ戻る', primary: true, onClick: () => setScreen('title') }]}
        />
      </div>
    )
  }

  // ===== バトル画面 =====
  if (!battle) return null
  const composing = battle.phase === 'compose' && !animation
  const activeComposer = composers[activeAllyId]
  const activePreview = previews[activeAllyId]
  const anyCastable = battle.allies.some((a) => a.hp > 0 && !impairedIds.includes(a.id))

  return (
    <div className="app">
      <div className="battle" data-view={view}>
        <div className="battle-left">
          <div className="phase-bar">
            <span>
              {STAGES[battle.stageIndex].name}
              {STAGES[battle.stageIndex].boss && <span className="boss-tag">BOSS</span>}
            </span>
            <span className="turn">
              ターン {battle.turn}・{composing ? '作成フェーズ' : '解決フェーズ'}
            </span>
          </div>
          <div className="canvas-wrap">
            <BattleCanvas
              allies={battle.allies}
              enemies={battle.enemies}
              obstacles={battle.obstacles}
              activeAllyId={composing ? activeAllyId : null}
              playerPaths={composing ? playerPaths : undefined}
              misfirePoints={composing ? misfirePoints : undefined}
              zField={composing ? activeZField ?? undefined : undefined}
              showZField={composing}
              standingOrbits={composing ? standingOrbits : undefined}
              ghostPaths={composing ? ghostPaths : undefined}
              ghostMisfires={composing ? ghostMisfires : undefined}
              anomaly={anomalyLevel(instability)}
              misfireBand={varianceOf(instability) > 0 ? misfireRadiusBand(instability) : undefined}
              animation={animation}
              onAnimationDone={onAnimationDone}
              fitPoints={composing ? fitPoints : undefined}
              onFieldClick={composing && fitPickActive ? onFieldClick : undefined}
              pickMode={composing && fitPickActive}
              onAim={composing && !fitPickActive && activeComposer?.mode === 'rotate' ? aimAt : undefined}
              aimAngle={composing && activeComposer?.mode === 'rotate' ? activeComposer.angle : undefined}
            />
          </div>

          {/* 盤面（ステージ）側：HP・キャラ選択・発射・メニュー（スマホは view=stage で表示） */}
          <div
            className="stage-pane show-stage"
            data-mode={composing && fitPickActive ? 'fit' : composing && zAdjustMode ? 'z' : 'normal'}
          >
            <Hud
              allies={battle.allies}
              enemies={battle.enemies}
              activeAllyId={activeAllyId}
              instability={{ count: instability, visible: collapseSeen }}
              onSelectAlly={composing ? switchAlly : undefined}
              impairedIds={impairedIds}
              touchedIds={[...touchedAllies]}
            />

            {/* スマホ：盤面で点を選んでそのままフィット（#54） */}
            {composing && fitPickActive && (
              <div className="stage-bar fit-bar show-mobile">
                <div className="hint">
                  通したい点を<strong>盤面にタップ</strong> → フィットで曲線を合わせる。
                </div>
                <div className="action-row">
                  <button className="btn primary" disabled={fitPoints.length < 1} onClick={runFit}>
                    フィット（{fitPoints.length}）
                  </button>
                  <button className="btn" disabled={fitPoints.length < 1} onClick={clearFitPoints}>
                    クリア
                  </button>
                  <button className="btn" onClick={() => setFitPickActive(false)}>
                    やめる
                  </button>
                </div>
              </div>
            )}

            {/* スマホ：盤面の属性場を見ながら z を調整（#54） */}
            {composing && zAdjustMode && activeComposer && (
              <div className="stage-bar z-bar show-mobile">
                <div className="section-title">属性の高さ z = f(x,y)（場を見ながら調整）</div>
                <ZFieldControls composer={activeComposer} onChange={onChange} />
                <button className="btn primary" onClick={endZAdjust}>
                  ✓ 調整を終える
                </button>
              </div>
            )}

            <div className="stage-normal">
              {composing && anyCastable && (
                <button className="btn おまかせ batch-recommend" onClick={recommendAll}>
                  ✨ 全員おまかせ（当たる術式を自動設定）
                </button>
              )}
              <div className="stage-actions">
                <button className={`btn primary fire-all${confirmArmed ? ' danger' : ''}`} onClick={() => fireAll()}>
                  {confirmArmed
                    ? '⚠ 崩壊の危険 ― それでも発射'
                    : anyCastable
                      ? '全員発射'
                      : '次のターンへ'}
                </button>
                <div className="menu-wrap">
                <button
                  className="btn small menu-toggle"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  ≡ メニュー
                </button>
                {menuOpen && (
                  <>
                    <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
                    <div className="menu-pop">
                      <button className="btn small" onClick={() => { setGuideOpen(true); setMenuOpen(false) }}>遊び方</button>
                      <button className="btn small" onClick={() => { setCodexOpen(true); setMenuOpen(false) }}>図鑑</button>
                      <button
                        className="btn small"
                        onClick={() => { ensureAudio(); setMutedState(toggleMuted()) }}
                      >
                        {muted ? '🔇 音オフ' : '🔊 音オン'}
                      </button>
                    </div>
                  </>
                )}
              </div>
              </div>
            </div>
            <BattleLog log={battle.log} />
          </div>
        </div>

        {/* 編集側：選んだキャラの関数を組む（スマホは view=edit で表示） */}
        <div className="battle-right show-edit">
          {composing && activeComposer && activePreview ? (
            <>
              <div className="ally-tabs">
                <button className="btn small show-mobile back-to-stage" onClick={() => setView('stage')}>
                  ← 盤面へ
                </button>
                {battle.allies.map((a) => {
                  const impaired = impairedIds.includes(a.id)
                  const dead = a.hp <= 0
                  return (
                    <button
                      key={a.id}
                      className={`btn small ally-tab${a.id === activeAllyId ? ' selected' : ''}${dead ? ' dead' : ''}`}
                      disabled={dead}
                      onClick={() => switchAlly(a.id)}
                    >
                      {a.name}
                      {impaired && !dead ? '（ひるみ）' : ''}
                    </button>
                  )
                })}
              </div>
              <FunctionPanel
                allyName={battle.allies.find((a) => a.id === activeAllyId)?.name ?? ''}
                composer={activeComposer}
                onChange={onChange}
                preview={activePreview}
                onRecommend={recommend}
                onOpenCodex={() => setCodexOpen(true)}
                fitPickActive={fitPickActive}
                fitPointCount={fitPoints.length}
                onToggleFitPick={toggleFitPick}
                onRunFit={runFit}
                onClearFitPoints={clearFit}
                onAdjustZOnStage={adjustZOnStage}
              />
              <div className="action-row show-mobile">
                <button className={`btn primary fire-all${confirmArmed ? ' danger' : ''}`} onClick={() => fireAll()}>
                  {confirmArmed
                    ? '⚠ 崩壊の危険 ― それでも発射'
                    : anyCastable
                      ? '全員発射'
                      : '次のターンへ'}
                </button>
                <button className="btn small" onClick={() => setView('stage')}>
                  盤面へ戻る
                </button>
              </div>
            </>
          ) : (
            <div className="panel">
              <div className="section-title">解決中…</div>
              <p className="hint">魔法が進行・解決しています。</p>
            </div>
          )}
        </div>
      </div>

      {confirmFire && (
        <div className="overlay" onClick={() => setConfirmFire(false)}>
          <div className="confirm-card panel" onClick={(e) => e.stopPropagation()}>
            <div className="section-title">未設定の味方がいます</div>
            <p className="hint">
              {battle.allies
                .filter((a) => a.hp > 0 && !impairedIds.includes(a.id) && !touchedAllies.has(a.id))
                .map((a) => a.name)
                .join('・')}{' '}
              はまだ術式を設定していません（既定のまま）。このまま発射しますか？
            </p>
            <div className="action-row">
              <button className="btn primary" onClick={() => fireAll(true)}>
                このまま発射
              </button>
              <button className="btn" onClick={() => setConfirmFire(false)}>
                戻って設定
              </button>
            </div>
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
      {storyOverlayEl}
    </div>
  )
}
