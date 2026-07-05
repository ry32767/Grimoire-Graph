// ステージエディタのデータモデル（#67・docs/11-stage-editor.md §2〜§3）。
// 障害物ヘルパー（src/data/stageBuilders.ts）を呼び出す「編集可能な op 記述子」で障害物を表し、
// compileObstacles で実際の Obstacle[]（solids/rects）へコンパイルする。
// エディタは開発ビルド専用（App.tsx 側で import.meta.env.DEV により分岐、本番には露出しない）。
import type { BossPhase, Enemy, Mechanics, Obstacle, ObstacleKind, Stage, Vec2 } from '../game/types'
import { FIELD } from '../data/constants'
import { STAGES } from '../data/stages'
import { block, colonnade, pillar, ring, roomWalls, roomWallsOpenEnds, spiralArm, wall } from '../data/stageBuilders'

/** 柱（縦）op のパラメータ。stageBuilders.pillar と1:1対応。 */
export interface PillarParams {
  cx: number
  y0: number
  n: number
  element: Obstacle['element']
  kind?: ObstacleKind
}
/** 矩形ブロック op のパラメータ。stageBuilders.block と1:1対応。 */
export interface BlockParams {
  x0: number
  y0: number
  cols: number
  rows: number
  element: Obstacle['element']
  kind?: ObstacleKind
}
/** 横壁 op のパラメータ。stageBuilders.wall と1:1対応。 */
export interface WallParams {
  x0: number
  x1: number
  y0: number
  rows: number
  element: Obstacle['element']
  kind?: ObstacleKind
}
/** 列柱 op のパラメータ。stageBuilders.colonnade と1:1対応。 */
export interface ColonnadeParams {
  x0: number
  x1: number
  step: number
  y0: number
  n: number
  elems: Obstacle['element'][]
}
/** 螺旋の腕 op のパラメータ。stageBuilders.spiralArm と1:1対応。 */
export interface SpiralArmParams {
  cx: number
  cy: number
  n: number
  turns: number
  phase: number
  element: Obstacle['element']
  r0?: number
}
/** リング op のパラメータ。stageBuilders.ring と1:1対応。 */
export interface RingParams {
  cx: number
  cy: number
  radius: number
  element: Obstacle['element']
  kind?: ObstacleKind
  n?: number
}
/** 部屋の囲い（四方）op のパラメータ。rField は compile 時に EditorStage.rField を渡す（可変）。 */
export interface RoomWallsParams {
  xL: number
  xR: number
  yB: number
  yT: number
  element?: Obstacle['element']
  kind?: ObstacleKind
}
/** 部屋の囲い（左右のみ）op のパラメータ。 */
export interface RoomWallsOpenEndsParams {
  xL: number
  xR: number
}
/** 逆変換が難しい既存障害物をそのまま保持する op（#67：既存ステージの取り込み用）。 */
export interface RawObstaclesParams {
  obstacles: Obstacle[]
}

/** 障害物 op（種別＋パラメータ）。id はエディタ内での選択・ドラッグ・削除の対象特定に使う。 */
export type ObstacleOp =
  | { id: string; kind: 'pillar'; params: PillarParams }
  | { id: string; kind: 'block'; params: BlockParams }
  | { id: string; kind: 'wall'; params: WallParams }
  | { id: string; kind: 'colonnade'; params: ColonnadeParams }
  | { id: string; kind: 'spiralArm'; params: SpiralArmParams }
  | { id: string; kind: 'ring'; params: RingParams }
  | { id: string; kind: 'roomWalls'; params: RoomWallsParams }
  | { id: string; kind: 'roomWallsOpenEnds'; params: RoomWallsOpenEndsParams }
  | { id: string; kind: 'raw'; params: RawObstaclesParams }

/** エディタが編集する1ステージ分の状態（docs/11-stage-editor.md §3）。 */
export interface EditorStage {
  /** 場の半径（06b §5.5）。 */
  rField: number
  mechanics: Mechanics
  /** 新規に敵を追加するときの既定 LVL（06b §2）。既存ステージ復元時はステージ番号を採用する。 */
  level: number
  enemies: Enemy[]
  /** 味方初期位置の上書き（未指定＝party.ts の既定位置・#67 §6.4）。 */
  allyPositions?: Vec2[]
  obstacleOps: ObstacleOp[]
  /**
   * ボスの HP フェーズ（多重詠唱・#67 §6.3・06b §6 第7面）。hpBelow を跨ぐたびに
   * castCount（同時発射数）・cullMinions（眷属間引き）・rField を切り替える。
   * 断末魔（HP≤0での暴発3連）は engine 側で自動発生する固定演出のため、ここでは編集対象にしない
   * （src/game/enemyAI.ts の finaleVariant・src/game/battle.ts の markFinaleIfBossDown を参照）。
   */
  bossPhases?: BossPhase[]
  /** 表示・書き出し用のメタ情報（元ステージの id/name/テキスト等）。編集ロジックには使わない。 */
  meta: {
    stageId: string
    name: string
    introText: string[]
    clearText: string[]
    boss?: boolean
  }
}

/** op 1件を Obstacle[] へコンパイルする（stageBuilders の各ヘルパーへそのまま委譲）。 */
function compileOp(op: ObstacleOp, rField: number): Obstacle[] {
  switch (op.kind) {
    case 'pillar':
      return [pillar(op.params.cx, op.params.y0, op.params.n, op.params.element, op.params.kind)]
    case 'block':
      return [block(op.params.x0, op.params.y0, op.params.cols, op.params.rows, op.params.element, op.params.kind)]
    case 'wall':
      return [wall(op.params.x0, op.params.x1, op.params.y0, op.params.rows, op.params.element, op.params.kind)]
    case 'colonnade':
      return colonnade(op.params.x0, op.params.x1, op.params.step, op.params.y0, op.params.n, op.params.elems)
    case 'spiralArm':
      return [spiralArm(op.params.cx, op.params.cy, op.params.n, op.params.turns, op.params.phase, op.params.element, op.params.r0)]
    case 'ring':
      return [ring(op.params.cx, op.params.cy, op.params.radius, op.params.element, op.params.kind, op.params.n)]
    case 'roomWalls':
      return roomWalls(op.params.xL, op.params.xR, op.params.yB, op.params.yT, rField, op.params.element, op.params.kind)
    case 'roomWallsOpenEnds':
      return roomWallsOpenEnds(op.params.xL, op.params.xR, rField)
    case 'raw':
      return op.params.obstacles
  }
}

/** op 1件をコンパイルした結果（op.id と生成された Obstacle[] の対応。選択・当たり判定に使う）。 */
export interface CompiledOp {
  opId: string
  obstacles: Obstacle[]
}

/** op 列 → op ごとの Obstacle[]（選択・ドラッグでどの op を触っているか特定するための単位）。 */
export function compileObstaclesWithOps(ops: ObstacleOp[], rField: number): CompiledOp[] {
  return ops.map((op) => ({ opId: op.id, obstacles: compileOp(op, rField) }))
}

/** op 列 → Obstacle[]（実際の当たり判定素材）。rField 依存の op（roomWalls系）は現在の rField を使う。 */
export function compileObstacles(ops: ObstacleOp[], rField: number): Obstacle[] {
  return compileObstaclesWithOps(ops, rField).flatMap((c) => c.obstacles)
}

let opSeq = 0
export function nextOpId(): string {
  return `edop${opSeq++}`
}

function cloneEnemy(e: Enemy): Enemy {
  return {
    ...e,
    pos: { ...e.pos },
    statuses: [...e.statuses],
    families: e.families ? [...e.families] : undefined,
    patternPool: e.patternPool ? [...e.patternPool] : undefined,
  }
}

function cloneObstacle(o: Obstacle): Obstacle {
  return {
    ...o,
    solids: o.solids.map((d) => ({ ...d })),
    rects: o.rects ? o.rects.map((r) => ({ ...r })) : undefined,
    carves: o.carves.map((d) => ({ ...d })),
  }
}

function cloneBossPhase(p: BossPhase): BossPhase {
  return { ...p, obstacles: p.obstacles.map(cloneObstacle) }
}

/** 新規のボスフェーズ（既定値）。obstacles は空＝現在のアリーナを据え置く（#67 土台）。 */
export function createDefaultBossPhase(): BossPhase {
  return { hpBelow: 0.5, castCount: 2, obstacles: [] }
}

/**
 * 編集中の EditorStage を本編の Stage 形へ組み立てる（テストプレイ・書き出し共通の土台・#67 §7/§9）。
 * introText/clearText は元ステージのテキストを流用し、空なら簡易ダミーで補う（テストプレイ専用に
 * ゼロから作った場合を想定）。obstacleOps はここで実際の Obstacle[] へコンパイルする。
 */
export function toStage(stage: EditorStage): Stage {
  return {
    id: stage.meta.stageId,
    name: stage.meta.name,
    enemies: stage.enemies.map(cloneEnemy),
    obstacles: compileObstacles(stage.obstacleOps, stage.rField),
    introText: stage.meta.introText.length > 0 ? stage.meta.introText : ['（テストプレイ：エディタからの一時ステージ）'],
    clearText: stage.meta.clearText.length > 0 ? stage.meta.clearText : ['（テストプレイ：クリア）'],
    mechanics: { ...stage.mechanics },
    boss: stage.meta.boss,
    bossPhases: stage.bossPhases?.map(cloneBossPhase),
    rField: stage.rField,
    allyPositions: stage.allyPositions?.map((p) => ({ ...p })),
  }
}

/**
 * 既存 STAGES[stageIndex] から EditorStage を復元する。
 * 障害物ヘルパー呼び出しの引数は stages.ts 側に残っていないため、既存の Obstacle[] はそのまま
 * 'raw' op として保持する（完全な逆変換は行わない＝#67 の土台段階では現実的な妥協）。
 */
export function fromStage(stageIndex: number): EditorStage {
  const stage = STAGES[stageIndex]
  if (!stage) throw new Error(`fromStage: 不明なステージ index=${stageIndex}`)
  const rawOp: ObstacleOp = {
    id: nextOpId(),
    kind: 'raw',
    params: { obstacles: stage.obstacles.map(cloneObstacle) },
  }
  return {
    rField: stage.rField ?? FIELD.rField,
    mechanics: { ...stage.mechanics },
    level: stageIndex + 1,
    enemies: stage.enemies.map(cloneEnemy),
    allyPositions: stage.allyPositions?.map((p) => ({ ...p })),
    obstacleOps: [rawOp],
    bossPhases: stage.bossPhases?.map(cloneBossPhase),
    meta: {
      stageId: stage.id,
      name: stage.name,
      introText: [...stage.introText],
      clearText: [...stage.clearText],
      boss: stage.boss,
    },
  }
}
