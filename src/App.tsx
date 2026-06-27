import { useMemo, useState } from 'react'
import type { BattleState, PlayerAction, Vec2 } from './game/types'
import { createBattleState, prepareTurn, resolvePlayerAction } from './game/battle'
import { enemyPath } from './game/turn'
import { ROTATE_PRESETS, defaultCoeffs } from './game/functions'
import { buildShield } from './data/fields'
import { STAGES } from './data/stages'
import { GAME } from './data/constants'
import { PROLOGUE, EPILOGUE, GAMEOVER_TEXT } from './data/story'
import {
  type ComposerState,
  buildComposerTrajectory,
  computePreview,
} from './components/composer'
import BattleCanvas, { type ResolveAnimation } from './components/BattleCanvas'
import Hud from './components/Hud'
import BattleLog from './components/BattleLog'
import FunctionPanel from './components/FunctionPanel'
import Codex from './components/Codex'
import Guide from './components/Guide'
import { TitleScreen, StoryScreen, ResultScreen } from './components/screens'

type Screen = 'title' | 'prologue' | 'stageIntro' | 'battle' | 'stageClear' | 'gameover' | 'ending'

const SHIELD_DURABILITY = 70

function makeInitialComposer(): ComposerState {
  return {
    mode: 'rotate',
    presetId: 'line',
    coeffs: defaultCoeffs(ROTATE_PRESETS[0]),
    angle: 0,
    speed: 6,
    useFree: false,
    freeExpr: '',
    freeError: null,
    actionKind: 'attack',
    shieldPresetId: 'circle-shield',
    shieldElement: 'light',
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('title')
  const [stageIndex, setStageIndex] = useState(0)
  const [battle, setBattle] = useState<BattleState | null>(null)
  const [castingIds, setCastingIds] = useState<string[]>([])
  const [composer, setComposer] = useState<ComposerState>(makeInitialComposer)
  const [animation, setAnimation] = useState<ResolveAnimation | null>(null)
  const [pendingState, setPendingState] = useState<BattleState | null>(null)
  const [codexOpen, setCodexOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideShown, setGuideShown] = useState(false)

  // 軌道とプレビュー（作成フェーズ）
  const trajectory = useMemo(
    () => (battle ? buildComposerTrajectory(composer) : null),
    [composer, battle],
  )
  const preview = useMemo(
    () =>
      battle
        ? computePreview(trajectory, composer.speed, battle.field)
        : { path: [], landing: null, powerEstimate: 0, selfMisfireWarning: false },
    [trajectory, composer.speed, battle],
  )
  const ghostPaths = useMemo<Vec2[][]>(() => {
    if (!battle) return []
    return castingIds
      .map((id) => battle.enemies.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => !!e && e.hp > 0)
      .map((e) => enemyPath(e.pos))
  }, [battle, castingIds])

  const onChange = (patch: Partial<ComposerState>) => setComposer((c) => ({ ...c, ...patch }))

  // ===== 画面遷移 =====
  const startBattle = () => {
    const stage = STAGES[stageIndex]
    const fresh = createBattleState(stage, stageIndex, GAME.playerMaxHp)
    const prep = prepareTurn(fresh)
    setBattle(prep.state)
    setCastingIds(prep.castingEnemyIds)
    setComposer(makeInitialComposer())
    setAnimation(null)
    setPendingState(null)
    setScreen('battle')
    if (stageIndex === 0 && !guideShown) {
      setGuideOpen(true)
      setGuideShown(true)
    }
  }

  const recommend = () => {
    if (!battle) return
    const stage = STAGES[stageIndex]
    const target = battle.enemies.find((e) => e.hp > 0)
    const angle = target ? Math.atan2(target.pos.y, target.pos.x) : 0
    setComposer({
      ...makeInitialComposer(),
      presetId: stage.recommendedPresetId,
      coeffs: stage.recommendedCoeffs ?? defaultCoeffs(ROTATE_PRESETS[0]),
      angle,
      speed: stage.recommendedSpeed ?? 8,
    })
  }

  const fire = () => {
    if (!battle) return
    let action: PlayerAction
    if (composer.actionKind === 'attack') {
      if (!trajectory) return
      action = { kind: 'attack', trajectory, initialSpeed: composer.speed }
    } else {
      action = {
        kind: 'shield',
        shield: buildShield(composer.shieldPresetId, composer.shieldElement, SHIELD_DURABILITY),
      }
    }
    const { state: after, resolution } = resolvePlayerAction(battle, action, castingIds)
    const playerPath = resolution.playerFlight?.samples.map((s) => s.pos) ?? null
    const enemyPaths = resolution.enemyShots.map((s) => s.path)
    const misfirePos = resolution.log.some((l) => l.kind === 'misfire')
      ? (resolution.playerFlight?.endPos ?? null)
      : null
    setBattle({ ...battle, phase: 'resolve' })
    setAnimation({ playerPath, enemyPaths, misfirePos })
    setPendingState(after)
  }

  const onAnimationDone = () => {
    const after = pendingState
    setAnimation(null)
    setPendingState(null)
    if (!after) return
    if (after.outcome === 'cleared') {
      setBattle(after)
      setScreen('stageClear')
      return
    }
    if (after.outcome === 'gameover') {
      setBattle(after)
      setScreen('gameover')
      return
    }
    const prep = prepareTurn(after)
    setBattle(prep.state)
    setCastingIds(prep.castingEnemyIds)
    if (prep.state.outcome === 'cleared') setScreen('stageClear')
    else if (prep.state.outcome === 'gameover') setScreen('gameover')
  }

  // ===== レンダリング =====
  if (screen === 'title') {
    return (
      <div className="app">
        <TitleScreen onStart={() => setScreen('prologue')} onGuide={() => setGuideOpen(true)} />
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
          actions={[{ label: 'タイトルへ戻る', primary: true, onClick: () => setScreen('title') }]}
        />
      </div>
    )
  }

  // ===== バトル画面 =====
  if (!battle) return null
  const composing = battle.phase === 'compose' && !animation

  return (
    <div className="app">
      <div className="battle">
        <div className="battle-left">
          <div className="phase-bar">
            <span>{battle.fieldName}</span>
            <span className="turn">
              ターン {battle.turn}・{composing ? '作成フェーズ' : '解決フェーズ'}
            </span>
          </div>
          <div className="canvas-wrap">
            <BattleCanvas
              field={battle.field}
              enemies={battle.enemies}
              obstacles={battle.obstacles}
              shield={battle.player.shield}
              playerPath={composing && composer.actionKind === 'attack' ? preview.path : null}
              ghostPaths={ghostPaths}
              landing={composing && preview.landing ? { pos: preview.landing.pos, attr: preview.landing.attr } : null}
              animation={animation}
              onAnimationDone={onAnimationDone}
            />
          </div>
          <Hud player={battle.player} enemies={battle.enemies} />
        </div>

        <div className="battle-right">
          {composing ? (
            <FunctionPanel
              composer={composer}
              onChange={onChange}
              preview={preview}
              field={battle.field}
              mechanics={battle.mechanics}
              canFire={composer.actionKind === 'shield' || !!trajectory}
              onFire={fire}
              onRecommend={recommend}
              onOpenCodex={() => setCodexOpen(true)}
            />
          ) : (
            <div className="panel">
              <div className="section-title">解決中…</div>
              <p className="hint">魔法が進行・解決しています。</p>
            </div>
          )}
          <div className="action-row">
            <button className="btn small" onClick={() => setGuideOpen(true)}>
              遊び方
            </button>
            <button className="btn small" onClick={() => setCodexOpen(true)}>
              図鑑
            </button>
          </div>
          <BattleLog log={battle.log} />
        </div>
      </div>

      {codexOpen && <Codex activePresetId={composer.presetId} onClose={() => setCodexOpen(false)} />}
      {guideOpen && <Guide onClose={() => setGuideOpen(false)} />}
    </div>
  )
}
