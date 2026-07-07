// ステージエディタ本体（#67・docs/11-stage-editor.md §2〜§6）。開発ビルド専用のツール。
// キャンバス描画・座標変換は本編の BattleCanvas/coords.ts をそのまま流用し、別レンダラーは作らない。
import { useMemo, useState } from 'react'
import type { BossPhase, Enemy, Obstacle, Stage, Vec2 } from '../game/types'
import { dist } from '../game/coords'
import BattleCanvas from '../components/BattleCanvas'
import { PARTY } from '../data/party'
import { compileObstaclesWithOps, fromStage, toStage, type EditorStage, type ObstacleOp } from './model'
import { roomPresetOp } from './opEditing'
import { detectOverlaps } from './overlap'
import { useEditorPointer } from './useEditorPointer'
import { useEditorKeyboard } from './useEditorKeyboard'
import { useHistory } from './useHistory'
import { useSquareFrame } from './useSquareFrame'
import ObstacleOverlay from './ObstacleOverlay'
import ObstaclePanel from './ObstaclePanel'
import EnemyPanel from './EnemyPanel'
import BossPhasesPanel from './BossPhasesPanel'
import AllyPanel from './AllyPanel'
import CharacterOverlay from './CharacterOverlay'
import StageSettingsPanel from './StageSettingsPanel'
import ExportBar from './ExportBar'
import './StageEditor.css'

const INTERNAL = 520 // BattleCanvas の内部解像度（src/components/BattleCanvas.tsx）と合わせる

interface Props {
  onBack: () => void
  /**
   * テストプレイ開始（#67 §7）：編集中の Stage・instability の初期値・
   * 編集中ステージの元インデックス（App 側の画面表示・図鑑記録に使う）を渡す。
   */
  onTestPlay: (stage: Stage, instability: number, stageIndex: number) => void
}

/** 障害物の素材（円・矩形）が場の境界外に出ているか（簡易判定・#67 土台）。 */
function obstacleOutOfBounds(o: Obstacle, rField: number): boolean {
  const discOut = o.solids.some((d) => dist({ x: d.x, y: d.y }) >= rField)
  const rectOut = (o.rects ?? []).some(
    (r) =>
      dist({ x: r.x, y: r.y }) >= rField ||
      dist({ x: r.x + r.w, y: r.y }) >= rField ||
      dist({ x: r.x, y: r.y + r.h }) >= rField ||
      dist({ x: r.x + r.w, y: r.y + r.h }) >= rField,
  )
  return discOut || rectOut
}

export default function StageEditor({ onBack, onTestPlay }: Props) {
  const [stageIndex, setStageIndex] = useState(0)
  const {
    state: stage,
    set: setStage,
    setWithoutHistory: setStageDrag,
    checkpoint: checkpointHistory,
    undo,
    redo,
    reset: resetHistory,
    canUndo,
    canRedo,
  } = useHistory<EditorStage>(() => fromStage(0))
  // テストプレイ用の instability 初期値（デバッグ入力・§7）とリセットのインライン確認（§8）
  const [testInstability, setTestInstability] = useState(0)
  const [resetConfirm, setResetConfirm] = useState(false)
  // グリッドスナップ（#67 CAD風操作性）：既定OFF。ONだとドラッグの基準点をグリッドへ丸める
  const [snapEnabled, setSnapEnabled] = useState(false)

  const compiled = useMemo(
    () => compileObstaclesWithOps(stage.obstacleOps, stage.rField),
    [stage.obstacleOps, stage.rField],
  )
  const obstacles = useMemo(() => compiled.flatMap((c) => c.obstacles), [compiled])
  const overlaps = useMemo(() => detectOverlaps(obstacles), [obstacles])

  // 味方位置（#67 §6.4）：allyPositions が無ければ party.ts の既定位置を使う。
  const allyPositions = useMemo<Vec2[]>(
    () => stage.allyPositions ?? PARTY.map((a) => ({ ...a.pos })),
    [stage.allyPositions],
  )
  const allies = useMemo(() => PARTY.map((a, i) => ({ ...a, pos: allyPositions[i] ?? a.pos })), [allyPositions])

  // 障害物 op の更新・削除・追加（§4.1/§4.4）。
  const updateOp = (next: ObstacleOp) =>
    setStage((s) => ({ ...s, obstacleOps: s.obstacleOps.map((o) => (o.id === next.id ? next : o)) }))
  const deleteOp = (id: string) => {
    setStage((s) => ({ ...s, obstacleOps: s.obstacleOps.filter((o) => o.id !== id) }))
    setSelection((cur) => (cur?.kind === 'obstacle' && cur.id === id ? null : cur))
  }
  const addOp = (op: ObstacleOp) => {
    setStage((s) => ({ ...s, obstacleOps: [...s.obstacleOps, op] }))
    setSelection({ kind: 'obstacle', id: op.id })
  }
  const addRoomPreset = (openEnds: boolean) => addOp(roomPresetOp(stage.rField, openEnds))

  // 敵の更新・削除・追加（§6.1/§6.2/§6.5）。
  const updateEnemy = (next: Enemy) =>
    setStage((s) => ({ ...s, enemies: s.enemies.map((e) => (e.id === next.id ? next : e)) }))
  const deleteEnemy = (id: string) => {
    setStage((s) => ({ ...s, enemies: s.enemies.filter((e) => e.id !== id) }))
    setSelection((cur) => (cur?.kind === 'enemy' && cur.id === id ? null : cur))
  }
  const addEnemy = (enemy: Enemy) => {
    setStage((s) => ({ ...s, enemies: [...s.enemies, enemy] }))
    setSelection({ kind: 'enemy', id: enemy.id })
  }

  // 味方位置の更新・リセット（§6.4）。
  const setAllyPositions = (positions: Vec2[]) => setStage((s) => ({ ...s, allyPositions: positions }))
  const resetAllyPositions = () => setStage((s) => ({ ...s, allyPositions: undefined }))

  // ボスのHPフェーズ（§6.3）。
  const setBossPhases = (phases: BossPhase[]) => setStage((s) => ({ ...s, bossPhases: phases }))

  // キャンバス上の選択・ドラッグ（障害物・敵・味方を1系統の onAim へ束ねる・#67）。
  const moveAllyTo = (index: number, pos: Vec2) =>
    setStage((s) => {
      const base = s.allyPositions ?? PARTY.map((a) => ({ ...a.pos }))
      return { ...s, allyPositions: base.map((p, i) => (i === index ? pos : p)) }
    })
  // ドラッグ中専用（履歴を積まない版・#67 CAD風操作性）：checkpointHistory がドラッグ開始時に
  // 一度だけ履歴を積むので、ドラッグ中の連続更新はここを通して1操作にまとめる。
  const updateOpDrag = (next: ObstacleOp) =>
    setStageDrag((s) => ({ ...s, obstacleOps: s.obstacleOps.map((o) => (o.id === next.id ? next : o)) }))
  const moveEnemyToDrag = (id: string, pos: Vec2) =>
    setStageDrag((s) => ({ ...s, enemies: s.enemies.map((e) => (e.id === id ? { ...e, pos } : e)) }))
  const moveAllyToDrag = (index: number, pos: Vec2) =>
    setStageDrag((s) => {
      const base = s.allyPositions ?? PARTY.map((a) => ({ ...a.pos }))
      return { ...s, allyPositions: base.map((p, i) => (i === index ? pos : p)) }
    })
  const { selection, setSelection, handleFieldPointer } = useEditorPointer(
    stage.obstacleOps,
    compiled,
    stage.enemies,
    allyPositions,
    updateOpDrag,
    moveEnemyToDrag,
    moveAllyToDrag,
    checkpointHistory,
    snapEnabled,
  )
  const selectedOpId = selection?.kind === 'obstacle' ? selection.id : null
  const selectedEnemyId = selection?.kind === 'enemy' ? selection.id : null

  useEditorKeyboard({
    selection,
    obstacleOps: stage.obstacleOps,
    enemies: stage.enemies,
    allyPositions,
    updateOp,
    deleteOp,
    updateEnemy,
    deleteEnemy,
    moveAllyTo,
    undo,
    redo,
  })

  // キャンバスと同じ正方形になるようオーバーレイの実寸を追従させる（§4.2：警告ハイライト用）。
  const { ref: canvasWrapRef, size: frameSize } = useSquareFrame<HTMLDivElement>()

  // 境界外警告（簡易・#67 土台）：部屋の囲い壁（unbreakable・neutral）は仕様上境界の外まで
  // 意図して伸びる（06b §5.6）ため対象から除く。
  const outOfBoundsEnemies = useMemo(
    () => stage.enemies.filter((e) => dist(e.pos) >= stage.rField).map((e) => e.name),
    [stage.enemies, stage.rField],
  )
  const outOfBoundsObstacleCount = useMemo(
    () =>
      obstacles.filter((o) => !(o.kind === 'unbreakable' && o.element === 'neutral') && obstacleOutOfBounds(o, stage.rField))
        .length,
    [obstacles, stage.rField],
  )

  const selectStage = (i: number) => {
    setStageIndex(i)
    resetHistory(fromStage(i))
    setSelection(null)
    setResetConfirm(false)
  }

  // リセット（§8）：現在の編集内容を、開いている既存ステージの元定義へ巻き戻す
  // （fromStage は STAGES の不変データから毎回同じ内容を再構成する純粋関数＝基準状態そのもの）。
  const handleReset = () => {
    resetHistory(fromStage(stageIndex))
    setSelection(null)
    setResetConfirm(false)
  }

  // テストプレイ（§7）：現在の EditorStage を本編 Stage 形へ組み立てて App 側へ渡す。
  const handleTestPlay = () => onTestPlay(toStage(stage), testInstability, stageIndex)

  return (
    <div className="stage-editor">
      <div className="stage-editor-canvas" ref={canvasWrapRef}>
        <div className="stage-editor-frame" style={{ width: frameSize, height: frameSize }}>
          <BattleCanvas
            allies={allies}
            enemies={stage.enemies}
            obstacles={obstacles}
            rField={stage.rField}
            onAim={handleFieldPointer}
          />
          <ObstacleOverlay
            compiled={compiled}
            obstacleOps={stage.obstacleOps}
            selectedOpId={selectedOpId}
            overlaps={overlaps}
            rField={stage.rField}
            internal={INTERNAL}
          />
          <CharacterOverlay
            enemies={stage.enemies}
            allyPositions={allyPositions}
            selection={selection}
            rField={stage.rField}
            internal={INTERNAL}
          />
        </div>
        {(outOfBoundsEnemies.length > 0 || outOfBoundsObstacleCount > 0 || overlaps.length > 0) && (
          <div className="stage-editor-warning">
            境界外の配置あり：
            {outOfBoundsEnemies.length > 0 && ` 敵=${outOfBoundsEnemies.join('、')}`}
            {outOfBoundsObstacleCount > 0 && ` 障害物=${outOfBoundsObstacleCount}件`}
            {overlaps.length > 0 && ` 壁の重なり=${overlaps.length}箇所`}
          </div>
        )}
      </div>
      <div className="stage-editor-panel">
        <button className="btn small" onClick={onBack}>
          ← タイトルへ戻る
        </button>
        {/* CAD風ツールバー（#67）：Undo/Redo・グリッドスナップ。矢印キーでナッジ・Deleteで削除も可 */}
        <div className="editor-toolbar">
          <button className="btn small" onClick={undo} disabled={!canUndo} title="元に戻す（Ctrl+Z）">
            ↶ 元に戻す
          </button>
          <button className="btn small" onClick={redo} disabled={!canRedo} title="やり直す（Ctrl+Shift+Z）">
            ↷ やり直す
          </button>
          <label className="snap-toggle">
            <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
            グリッドにスナップ
          </label>
        </div>
        <StageSettingsPanel
          stageIndex={stageIndex}
          level={stage.level}
          rField={stage.rField}
          mechanics={stage.mechanics}
          onSelectStage={selectStage}
          onLevelChange={(level) => setStage((s) => ({ ...s, level }))}
          onRFieldChange={(rField) => setStage((s) => ({ ...s, rField }))}
          onMechanicsChange={(mechanics) => setStage((s) => ({ ...s, mechanics }))}
        />
        <AllyPanel positions={allyPositions} onChange={setAllyPositions} onReset={resetAllyPositions} />
        <EnemyPanel
          enemies={stage.enemies}
          stageLevel={stage.level}
          rField={stage.rField}
          selectedId={selectedEnemyId}
          onSelect={(id) => setSelection(id ? { kind: 'enemy', id } : null)}
          onAdd={addEnemy}
          onChangeEnemy={updateEnemy}
          onDeleteEnemy={deleteEnemy}
        />
        <BossPhasesPanel bossPhases={stage.bossPhases ?? []} onChange={setBossPhases} />
        <ObstaclePanel
          ops={stage.obstacleOps}
          selectedOpId={selectedOpId}
          onSelect={(id) => setSelection(id ? { kind: 'obstacle', id } : null)}
          onAdd={addOp}
          onAddRoomPreset={addRoomPreset}
          onChangeOp={updateOp}
          onDeleteOp={deleteOp}
        />
      </div>
      <div className="stage-editor-bottombar">
        <div className="testplay-controls">
          <label>
            instability 初期値
            <input
              type="number"
              min={0}
              value={testInstability}
              onChange={(e) => setTestInstability(Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
          <button className="btn primary" onClick={handleTestPlay}>
            テストプレイ
          </button>
        </div>
        {resetConfirm ? (
          <div className="reset-confirm">
            <span>編集内容を元の定義に戻しますか？</span>
            <button className="btn small" onClick={handleReset}>
              はい、戻す
            </button>
            <button className="btn small" onClick={() => setResetConfirm(false)}>
              やめる
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => setResetConfirm(true)}>
            リセット
          </button>
        )}
        <ExportBar stage={stage} />
      </div>
    </div>
  )
}
