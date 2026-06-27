import { useMemo, useRef, useState } from 'react'
import type { Ally, AllyCast, BattleState, Vec2 } from './game/types'
import { createBattleState, prepareTurn, resolveAllyCasts } from './game/battle'
import { planEnemyShot, enemyFlight } from './game/enemyAI'
import { recommendCast } from './game/recommend'
import { ROTATE_PRESETS, defaultCoeffs } from './game/functions'
import { STAGES } from './data/stages'
import { makeParty } from './data/party'
import { FIELD } from './data/constants'
import { PROLOGUE, EPILOGUE, GAMEOVER_TEXT } from './data/story'
import { type ComposerState, buildComposerTrajectory, computePreview } from './components/composer'
import BattleCanvas, { type ResolveAnimation, type AnimBullet, type AnimOrbit } from './components/BattleCanvas'
import Hud from './components/Hud'
import BattleLog from './components/BattleLog'
import FunctionPanel from './components/FunctionPanel'
import Codex from './components/Codex'
import Guide from './components/Guide'
import { TitleScreen, StoryScreen, ResultScreen } from './components/screens'
import { ensureAudio, playSfx, startMusic, toggleMuted, type SfxKind } from './audio/sound'

type Screen = 'title' | 'prologue' | 'stageIntro' | 'battle' | 'stageClear' | 'gameover' | 'ending'

/** from→to を a 直線で狙う角度。 */
function aimAngle(from: Vec2, to: Vec2, a: number): number {
  return Math.atan2(to.y - from.y, to.x - from.x) - Math.atan(a)
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
  return {
    mode: 'rotate',
    presetId: 'line',
    coeffs,
    angle,
    speed: FIELD.fixedSpeed,
    useFree: false,
    freeExpr: ROTATE_PRESETS[0].toExpr(coeffs),
    freeError: null,
  }
}

/** パーティ各自の初期コンポーザ（敵陣（上方）へ向ける）。 */
function initComposers(party: Ally[]): Record<string, ComposerState> {
  const m: Record<string, ComposerState> = {}
  for (const a of party) m[a.id] = makeComposer(aimAngle(a.pos, { x: 0, y: 19 }, 1))
  return m
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [stageIndex, setStageIndex] = useState(0)
  const [battle, setBattle] = useState<BattleState | null>(null)
  const [castingIds, setCastingIds] = useState<string[]>([])
  const [impairedIds, setImpairedIds] = useState<string[]>([])
  const [composers, setComposers] = useState<Record<string, ComposerState>>({})
  const [activeAllyId, setActiveAllyId] = useState<string>('')
  const [animation, setAnimation] = useState<ResolveAnimation | null>(null)
  const [pendingState, setPendingState] = useState<BattleState | null>(null)
  const [codexOpen, setCodexOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideShown, setGuideShown] = useState(false)
  // #6：クリアタイム計測
  const [runStartMs, setRunStartMs] = useState<number | null>(null)
  const [clearSnapshotMs, setClearSnapshotMs] = useState(0)
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
      out[a.id] = computePreview(traj, c.speed)
    }
    return out
  }, [battle, composers])

  const playerPaths = useMemo(
    () => aliveAllies.map((a) => previews[a.id]?.path ?? null),
    [aliveAllies, previews],
  )
  const landings = useMemo(
    () =>
      aliveAllies.map((a) => {
        const l = previews[a.id]?.landing
        return l ? { pos: l.pos, attr: l.attr } : null
      }),
    [aliveAllies, previews],
  )
  // 敵の先出し術式を公開（#17：得意関数の形を見せる）
  const ghostPaths = useMemo<Vec2[][]>(() => {
    if (!battle) return []
    return castingIds
      .map((id) => battle.enemies.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => !!e && e.hp > 0)
      .map((e) => {
        const plan = planEnemyShot(e, battle.allies, battle.obstacles)
        return plan ? enemyFlight(plan.trajectory, e.castInitialSpeed, e.castZ).path : []
      })
      .filter((p) => p.length > 0)
  }, [battle, castingIds])

  const onChange = (patch: Partial<ComposerState>) =>
    setComposers((m) => ({ ...m, [activeAllyId]: { ...m[activeAllyId], ...patch } }))

  // ===== 画面遷移 =====
  const startBattle = () => {
    const stage = STAGES[stageIndex]
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
    setScreen('battle')
    if (stageIndex === 0 && !guideShown) {
      setGuideOpen(true)
      setGuideShown(true)
    }
  }

  const recommend = () => {
    if (!battle || !activeAllyId) return
    const ally = battle.allies.find((a) => a.id === activeAllyId)
    const target = battle.enemies.find((e) => e.hp > 0)
    if (!ally || !target) return
    // 障害物の貫通/迂回を込みで「当たる」術式を探す
    const r = recommendCast(ally.pos, target, battle.mechanics.obstacles ? battle.obstacles : [])
    setComposers((m) => ({
      ...m,
      [activeAllyId]: r.line
        ? { ...makeComposer(r.angle), coeffs: { a: r.line.a, b: r.line.b }, freeExpr: `${r.line.a}*x` }
        : { ...makeComposer(r.angle), useFree: true, freeExpr: r.freeExpr ?? '' },
    }))
  }

  const fireAll = () => {
    if (!battle) return
    const casts: AllyCast[] = []
    for (const a of battle.allies) {
      if (a.hp <= 0 || impairedIds.includes(a.id)) continue
      const c = composers[a.id]
      if (!c) continue
      const traj = buildComposerTrajectory(c, a.pos)
      if (!traj) continue
      casts.push({ allyId: a.id, trajectory: traj, initialSpeed: c.speed })
    }
    const { state: after, resolution } = resolveAllyCasts(battle, casts, castingIds)
    const bullets: AnimBullet[] = []
    const orbits: AnimOrbit[] = []
    for (const s of resolution.allyShots) {
      if (s.kind === 'orbit') {
        orbits.push({ ring: s.path })
      } else if (s.flight) {
        bullets.push({
          samples: s.flight.samples.map((x) => ({ pos: x.pos, speed: x.speed, arcLen: x.arcLen })),
          side: 'ally',
          misfirePos: s.misfirePos,
          carves: s.carves,
        })
      }
    }
    for (const es of resolution.enemyShots) {
      bullets.push({
        samples: es.flight.samples.map((x) => ({ pos: x.pos, speed: x.speed, arcLen: x.arcLen })),
        side: 'enemy',
        misfirePos: null,
        carves: es.carves,
      })
    }
    // 着弾時に鳴らす効果音を予約（#10）
    const kinds = new Set(resolution.log.map((l) => l.kind))
    const sfx: SfxKind[] = []
    if (kinds.has('misfire')) sfx.push('misfire')
    if (kinds.has('playerHit')) sfx.push('hit')
    if (kinds.has('orbit')) sfx.push('orbit')
    if (kinds.has('enemyHit')) sfx.push('enemyHit')
    sfxRef.current = sfx
    setBattle({ ...battle, phase: 'resolve' })
    setAnimation({ bullets, orbits })
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
    if (after.outcome === 'cleared') {
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
            setScreen('prologue')
          }}
          onGuide={() => setGuideOpen(true)}
        />
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
    return (
      <div className="app">
        <StoryScreen title={stage.name} lines={stage.introText} onNext={startBattle} nextLabel="戦闘開始" />
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
                    setStageIndex((i) => i + 1)
                    setScreen('stageIntro')
                  },
                },
          ]}
        />
      </div>
    )
  }
  if (screen === 'gameover') {
    return (
      <div className="app">
        <ResultScreen
          title="ゲームオーバー"
          lines={[GAMEOVER_TEXT]}
          actions={[
            { label: 'このステージをやり直す', primary: true, onClick: startBattle },
            { label: 'タイトルへ', onClick: () => setScreen('title') },
          ]}
        />
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
      <div className="battle">
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
              landings={composing ? landings : undefined}
              ghostPaths={ghostPaths}
              animation={animation}
              onAnimationDone={onAnimationDone}
            />
          </div>
          <Hud allies={battle.allies} enemies={battle.enemies} activeAllyId={activeAllyId} />
        </div>

        <div className="battle-right">
          {composing && activeComposer && activePreview ? (
            <>
              <div className="ally-tabs">
                {battle.allies.map((a) => {
                  const impaired = impairedIds.includes(a.id)
                  const dead = a.hp <= 0
                  return (
                    <button
                      key={a.id}
                      className={`btn small ally-tab${a.id === activeAllyId ? ' selected' : ''}${dead ? ' dead' : ''}`}
                      disabled={dead}
                      onClick={() => {
                        playSfx('select')
                        setActiveAllyId(a.id)
                      }}
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
              />
              <div className="action-row">
                <button className="btn primary fire-all" onClick={fireAll}>
                  {anyCastable ? '全員発射' : 'ターンを進める'}
                </button>
                <button className="btn small" onClick={() => setGuideOpen(true)}>
                  遊び方
                </button>
                <button className="btn small" onClick={() => setCodexOpen(true)}>
                  図鑑
                </button>
                <button
                  className="btn small"
                  title="音のオン/オフ"
                  onClick={() => {
                    ensureAudio()
                    setMutedState(toggleMuted())
                  }}
                >
                  {muted ? '🔇' : '🔊'}
                </button>
              </div>
            </>
          ) : (
            <div className="panel">
              <div className="section-title">解決中…</div>
              <p className="hint">魔法が進行・解決しています。</p>
            </div>
          )}
          <BattleLog log={battle.log} />
        </div>
      </div>

      {codexOpen && <Codex activePresetId={activeComposer?.presetId} onClose={() => setCodexOpen(false)} />}
      {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}
    </div>
  )
}
