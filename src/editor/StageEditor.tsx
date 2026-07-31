// ステージエディタ本体（#67・docs/11-stage-editor.md §2〜§6／UI設計仕様書 §5）。開発ビルド専用ツール。
// v9 モックアップの CAD 構成：上部リボン（工具/素材パレット）＋左右の定規＋下部ステータスバー＋
// 右カラム（ステージ/オブジェクト/プロパティ）。キャンバス描画・座標変換は本編の BattleCanvas/coords.ts を流用。
import { type CSSProperties, type MouseEvent as ReactMouseEvent, useMemo, useState } from 'react'
import type { BossPhase, Enemy, Obstacle, ObstacleKind, Stage, Vec2 } from '../game/types'
import { dist, toMath } from '../game/coords'
import BattleCanvas from '../components/BattleCanvas'
import { PARTY } from '../data/party'
import { compileObstaclesWithOps, fromStage, nextOpId, toStage, type EditorStage, type ObstacleOp } from './model'
import { hitTestOp, roomPresetOp } from './opEditing'
import { hitTestEnemy } from './enemyEditing'
import { SPECIES_TIERS, createEnemyFromTier } from './enemyTiers'
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

/** CADリボンの工具（v9）。select=選択/移動、wall=矩形、circle=円、carve=削る（未対応）、erase=消去。 */
type Tool = 'select' | 'wall' | 'circle' | 'carve' | 'erase' | 'enemy' | 'ally'

const TOOLS: { id: Tool; icon: string; label: string; disabled?: boolean; title: string }[] = [
  { id: 'select', icon: '▣', label: '選択', title: '選択・移動' },
  { id: 'wall', icon: '▭', label: '壁', title: '矩形の壁を置く（クリック）' },
  { id: 'circle', icon: '●', label: '円', title: '円の壁を置く（クリック）' },
  { id: 'carve', icon: '◐', label: '削る', disabled: true, title: '削る（今後対応）' },
  { id: 'erase', icon: '⌫', label: '消去', title: '壁・敵をクリックで消す' },
]
const MATERIALS: { id: ObstacleKind; label: string; swatch: string }[] = [
  { id: 'normal', label: '通常', swatch: 'mat-normal' },
  { id: 'fragile', label: 'もろい', swatch: 'mat-fragile' },
  { id: 'tough', label: '頑丈', swatch: 'mat-tough' },
  { id: 'unbreakable', label: '不壊', swatch: 'mat-unbreak' },
]
const TOOL_LABEL: Record<Tool, string> = {
  select: '選択', wall: '壁', circle: '円', carve: '削る', erase: '消去', enemy: '敵配置', ally: '味方配置',
}
const MAT_LABEL: Record<ObstacleKind, string> = {
  normal: '通常', fragile: 'もろい', tough: '頑丈', unbreakable: '不壊',
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

interface Props {
  onBack: () => void
  onTestPlay: (stage: Stage, instability: number, stageIndex: number) => void
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
  const [testInstability, setTestInstability] = useState(0)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(false)
  // CADリボンの工具・素材（v9）。工具＝クリック時の挙動、素材＝新規の壁の種別。
  const [tool, setTool] = useState<Tool>('select')
  const [material, setMaterial] = useState<ObstacleKind>('tough')
  // カーソル座標のライブ表示（下部ステータスバー・十字カーソル）。ホバーで盤面座標へ変換。
  const [hover, setHover] = useState<{ xPct: number; yPct: number; mx: number; my: number } | null>(null)

  const compiled = useMemo(
    () => compileObstaclesWithOps(stage.obstacleOps, stage.rField),
    [stage.obstacleOps, stage.rField],
  )
  const obstacles = useMemo(() => compiled.flatMap((c) => c.obstacles), [compiled])
  const overlaps = useMemo(() => detectOverlaps(obstacles), [obstacles])

  const allyPositions = useMemo<Vec2[]>(
    () => stage.allyPositions ?? PARTY.map((a) => ({ ...a.pos })),
    [stage.allyPositions],
  )
  const allies = useMemo(() => PARTY.map((a, i) => ({ ...a, pos: allyPositions[i] ?? a.pos })), [allyPositions])

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

  const setAllyPositions = (positions: Vec2[]) => setStage((s) => ({ ...s, allyPositions: positions }))
  const resetAllyPositions = () => setStage((s) => ({ ...s, allyPositions: undefined }))
  const setBossPhases = (phases: BossPhase[]) => setStage((s) => ({ ...s, bossPhases: phases }))

  const moveAllyTo = (index: number, pos: Vec2) =>
    setStage((s) => {
      const base = s.allyPositions ?? PARTY.map((a) => ({ ...a.pos }))
      return { ...s, allyPositions: base.map((p, i) => (i === index ? pos : p)) }
    })
  const updateOpDrag = (next: ObstacleOp) =>
    setStageDrag((s) => ({ ...s, obstacleOps: s.obstacleOps.map((o) => (o.id === next.id ? next : o)) }))
  const moveEnemyToDrag = (id: string, pos: Vec2) =>
    setStageDrag((s) => ({ ...s, enemies: s.enemies.map((e) => (e.id === id ? { ...e, pos } : e)) }))
  const moveAllyToDrag = (index: number, pos: Vec2) =>
    setStageDrag((s) => {
      const base = s.allyPositions ?? PARTY.map((a) => ({ ...a.pos }))
      return { ...s, allyPositions: base.map((p, i) => (i === index ? pos : p)) }
    })

  // 工具＝クリック配置/消去（v9）。select/ally は選択・ドラッグ、それ以外はペイント。
  const paintMode = tool === 'wall' || tool === 'circle' || tool === 'erase' || tool === 'enemy'
  const paintAt = (pos: Vec2) => {
    const x = Math.round(pos.x)
    const y = Math.round(pos.y)
    if (tool === 'wall') {
      addOp({ id: nextOpId(), kind: 'rect', params: { x: x - 3, y: y - 1, w: 6, h: 2, element: 'neutral', kind: material } })
    } else if (tool === 'circle') {
      addOp({ id: nextOpId(), kind: 'disc', params: { cx: x, cy: y, r: 2, element: 'neutral', kind: material } })
    } else if (tool === 'enemy') {
      const tier = SPECIES_TIERS.proto[0]
      addEnemy(createEnemyFromTier('proto', tier, { x, y }))
    } else if (tool === 'erase') {
      const opId = hitTestOp(compiled, pos)
      if (opId) { deleteOp(opId); return }
      const enId = hitTestEnemy(stage.enemies, pos)
      if (enId) deleteEnemy(enId)
    }
  }

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
    paintMode,
    paintAt,
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

  const { ref: canvasWrapRef, size: frameSize } = useSquareFrame<HTMLDivElement>()

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
  const handleReset = () => {
    resetHistory(fromStage(stageIndex))
    setSelection(null)
    setResetConfirm(false)
  }
  const handleTestPlay = () => onTestPlay(toStage(stage), testInstability, stageIndex)

  // ホバー座標をゲーム座標へ（十字カーソル＋ステータスバーのリードアウト・v9）。
  const onFrameHover = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width || !r.height) return
    const px = ((e.clientX - r.left) / r.width) * INTERNAL
    const py = ((e.clientY - r.top) / r.height) * INTERNAL
    const mm = toMath({ x: px, y: py }, { width: INTERNAL, height: INTERNAL, unitsRadius: stage.rField })
    setHover({
      xPct: ((e.clientX - r.left) / r.width) * 100,
      yPct: ((e.clientY - r.top) / r.height) * 100,
      mx: Math.round(mm.x * 10) / 10,
      my: Math.round(mm.y * 10) / 10,
    })
  }

  // 定規の目盛り（0=中央、両端=±rField・v9）。
  const ruler = [-stage.rField, -stage.rField / 2, 0, stage.rField / 2, stage.rField]
  const selectionLabel =
    selection?.kind === 'obstacle' ? `壁 ${selectedOpId}`
    : selection?.kind === 'enemy' ? (stage.enemies.find((e) => e.id === selectedEnemyId)?.name ?? '敵')
    : selection?.kind === 'ally' ? `味方 #${selection.index + 1}`
    : 'なし'

  return (
    <div className="stage-editor cad">
      {/* ===== リボン（工具/素材/テストプレイ・v9 §5） ===== */}
      <div className="rwin cad-ribbon">
        <div className="cad-group">
          <span className="gl">ツール</span>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool${tool === t.id ? ' on' : ''}`}
              disabled={t.disabled}
              title={t.title}
              onClick={() => setTool(t.id)}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span className="tt">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="cad-group">
          <span className="gl">配置</span>
          <button className={`tool${tool === 'enemy' ? ' on' : ''}`} title="敵をクリックで置く" onClick={() => setTool('enemy')}>
            <span aria-hidden="true">☗</span><span className="tt">敵</span>
          </button>
          <button className={`tool${tool === 'ally' ? ' on' : ''}`} title="味方を選択・移動" onClick={() => setTool('ally')}>
            <span aria-hidden="true">♟</span><span className="tt">味方</span>
          </button>
        </div>
        <div className="cad-group">
          <span className="gl">素材</span>
          {MATERIALS.map((m) => (
            <button
              key={m.id}
              className={`tool${material === m.id ? ' on' : ''}`}
              title={m.label}
              onClick={() => setMaterial(m.id)}
            >
              <span className={`mat-swatch ${m.swatch}`} aria-hidden="true" />
              <span className="tt">{m.label}</span>
            </button>
          ))}
        </div>
        <div className="cad-group">
          <button className="btn small" onClick={undo} disabled={!canUndo} title="元に戻す（Ctrl+Z）">↶</button>
          <button className="btn small" onClick={redo} disabled={!canRedo} title="やり直す（Ctrl+Shift+Z）">↷</button>
          <label className="snap-toggle">
            <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
            スナップ
          </label>
        </div>
        <div className="cad-spacer" />
        <div className="cad-testset">
          <span className="gl2">初期instability</span>
          <input
            type="number"
            min={0}
            value={testInstability}
            onChange={(e) => setTestInstability(Math.max(0, Number(e.target.value) || 0))}
          />
          <button className="btn small primary" onClick={handleTestPlay}>▶ テストプレイ</button>
        </div>
        {resetConfirm ? (
          <span className="reset-confirm">
            元に戻す？
            <button className="btn small" onClick={handleReset}>はい</button>
            <button className="btn small" onClick={() => setResetConfirm(false)}>やめる</button>
          </span>
        ) : (
          <button className="btn small" onClick={() => setResetConfirm(true)}>リセット</button>
        )}
        <button className="btn small" onClick={onBack}>← タイトル</button>
      </div>

      {/* ===== ステージ（左・定規＋キャンバス） ===== */}
      <div className="cad-stage">
        <div className="rwin cad-rulers">
          <div className="cad-corner">x,y</div>
          <div className="ruler top">
            {ruler.map((v, i) => {
              // 端の目盛りは見切れ防止に内側寄せ（左端＝左揃え／右端＝右揃え／中間＝中央）。
              const first = i === 0
              const last = i === ruler.length - 1
              const style: CSSProperties = first
                ? { left: '2px' }
                : last
                  ? { right: '2px' }
                  : { left: `${(i / (ruler.length - 1)) * 100}%`, transform: 'translateX(-50%)' }
              return <span key={i} className="rn" style={style}>{Math.round(v)}</span>
            })}
          </div>
          <div className="ruler left">
            {ruler.map((v, i) => {
              const first = i === 0
              const last = i === ruler.length - 1
              const style: CSSProperties = first
                ? { top: '2px' }
                : last
                  ? { bottom: '2px' }
                  : { top: `${(i / (ruler.length - 1)) * 100}%`, transform: 'translateY(-50%)' }
              return <span key={i} className="rn" style={style}>{Math.round(-v)}</span>
            })}
          </div>
          <div className="cad-canvas" ref={canvasWrapRef}>
            <div
              className="stage-editor-frame"
              style={{ width: frameSize, height: frameSize }}
              onMouseMove={onFrameHover}
              onMouseLeave={() => setHover(null)}
            >
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
              {hover && (
                <>
                  <div className="crosshair-v" style={{ left: `${hover.xPct}%` }} />
                  <div className="crosshair-h" style={{ top: `${hover.yPct}%` }} />
                </>
              )}
            </div>
          </div>
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

      {/* ===== 右カラム（ステージ/オブジェクト/プロパティ） ===== */}
      <div className="cad-right stage-editor-panel">
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
        <ObstaclePanel
          ops={stage.obstacleOps}
          selectedOpId={selectedOpId}
          onSelect={(id) => setSelection(id ? { kind: 'obstacle', id } : null)}
          onAdd={addOp}
          onAddRoomPreset={addRoomPreset}
          onChangeOp={updateOp}
          onDeleteOp={deleteOp}
        />
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
        <AllyPanel positions={allyPositions} onChange={setAllyPositions} onReset={resetAllyPositions} />
        <BossPhasesPanel bossPhases={stage.bossPhases ?? []} onChange={setBossPhases} />
        <ExportBar stage={stage} />
      </div>

      {/* ===== ステータスバー（カーソル座標・スナップ・選択・素材・v9） ===== */}
      <div className="rwin cad-status">
        <span><span className="k">カーソル</span> {hover ? `x:${hover.mx} y:${hover.my}` : 'x:— y:—'}</span>
        <span><span className="k">スナップ</span> {snapEnabled ? 'ON（1.0）' : 'OFF'}</span>
        <span><span className="k">工具</span> {TOOL_LABEL[tool]}</span>
        <span><span className="k">選択</span> {selectionLabel}</span>
        <span><span className="k">素材</span> {MAT_LABEL[material]}</span>
        <div className="spacer" />
        <span><span className="k">rField</span> {stage.rField}</span>
      </div>
    </div>
  )
}
