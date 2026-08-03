// 関数パネルの状態 → 軌道・プレビューへの橋渡し（純粋ヘルパー、React 非依存）。
import type { Attribute, Obstacle, Trajectory, Vec2, ZField } from '../game/types'
import {
  ALL_PRESETS,
  ROTATE_PRESETS,
  POLAR_PRESETS,
  parseExpression,
  parseZExpression,
  buildTrajectory,
  type Preset,
} from '../game/functions'
import { findZPreset } from '../game/zfields'
import {
  detectParams,
  detectCoeffs,
  initialValues,
  renderExpr,
  renderWithParams,
  paramDefaults,
  type DetectedParam,
  type ParamSpec,
} from '../game/exprFit'
import { simulateFlight } from '../game/physics'
import { detectMisfire } from '../game/misfire'
import { zfieldAt, attributeOf, strengthOf } from '../game/attribute'
import { classifyTrajectory, type MagicKind } from '../game/loop'
import { buildRing } from '../game/orbit'
import { traverseObstacles } from '../game/turn'
import { dist } from '../game/coords'
import { FIELD } from '../data/constants'

/** 関数パネルの状態（#4：攻防は分けず関数を撃つだけ。z 場は軌道と別入力・#30/#21） */
export interface ComposerState {
  mode: 'rotate' | 'polar'
  presetId: string
  coeffs: Record<string, number>
  angle: number
  speed: number
  useFree: boolean
  freeExpr: string
  freeError: string | null
  /**
   * y 欄にユーザーが打った生のテキスト（`r=` 接頭辞を含む）。freeExpr は係数検出で整形された
   * 「エンジンへ渡す式」なので、入力欄の見た目はこちらを正とする（打鍵ごとに整形されない）。
   */
  yText: string
  /** z 欄にユーザーが打った生のテキスト（変数は t＝術者からの距離）。 */
  zText: string
  /**
   * 自由入力式から自動検出した係数（#46）。射出魔法（回転 y=g(x)）で式中の数値を
   * スライダー化し、通過点フィットの対象にする。fitTemplate は数値を p0,p1,… に置換した式。
   */
  fitTemplate: string
  fitParams: DetectedParam[]
  fitValues: Record<string, number>
  /**
   * z を「術者からの距離 t の関数 z=g(t)」として書くか（DC プロトタイプ v3 の読み方・既定 true）。
   * true のとき zFreeExpr の変数は t で、場としては z(x,y)=g(√(x²+y²))（術者原点）に持ち上げる。
   * false は従来の 2 変数 z=f(x,y)。エンジンへは同じ ZField を渡すだけなのでロジックは不変。
   */
  zRadial: boolean
  /** z 場（属性 z=f(x,y)）の状態（#30/#21） */
  zPresetId: string
  zCoeffs: Record<string, number>
  zUseFree: boolean
  zFreeExpr: string
  zFreeError: string | null
  /** z 場の自動検出係数（#52）：z 式中の数値もスライダー化する（軌道と同じ仕組み） */
  zFitTemplate: string
  zFitParams: DetectedParam[]
  zFitValues: Record<string, number>
}

/**
 * z(t)（t＝術者からの距離）としての 1 次元の読み。zRadial のときだけ得られる。
 * 読み出しストリップ・z プロット・整形スライダーはこれを使う（撃つ前に読める完全情報）。
 */
export function buildZAt(c: ComposerState): ((t: number) => number) | null {
  if (!c.zRadial) return null
  return parseExpression(c.zFreeExpr, 't')
}

/** 状態から z 場（属性 z=f(x,y)）を組み立てる（#30）。組み立てられなければ中立(0)。 */
export function buildZField(c: ComposerState): ZField {
  if (c.zRadial) {
    const g = parseExpression(c.zFreeExpr, 't')
    // 距離場として持ち上げる。origin ぶんのずらしは Trajectory 側（z は術者原点で評価される）
    if (g) return (x, y) => g(Math.hypot(x, y))
    return () => 0
  }
  if (c.zUseFree) {
    const f = parseZExpression(c.zFreeExpr)
    if (f) return f
  }
  const preset = findZPreset(c.zPresetId)
  if (preset) return preset.build(c.zCoeffs)
  return () => 0
}

/** y 欄が `r=` で始まっていれば結界（極座標 r=f(θ)）。 */
export function isBarrierText(text: string): boolean {
  return /^\s*r\s*=/.test(text ?? '')
}

/** `r=…` から式本体だけを取り出す。 */
export function barrierBody(text: string): string {
  return (text ?? '').replace(/^\s*r\s*=/, '')
}

/** θ・π・√ など、入力しやすい記号を mathjs が読める形へ寄せる（極座標の変数は t）。 */
export function normalizeExprInput(text: string): string {
  return (text ?? '').replace(/θ/g, 't').replace(/π/g, 'pi').replace(/√/g, 'sqrt')
}

/** 式（接頭辞なし）から y 欄のテキストを作る。 */
export function yTextOf(expr: string, mode: 'rotate' | 'polar'): string {
  return mode === 'polar' ? `r=${expr}` : expr
}

export function findPreset(id: string): Preset | undefined {
  return ALL_PRESETS.find((p) => p.id === id)
}

/** 係数化フィールドを空にするパッチ（極座標など、係数スライダーを使わない時）。 */
export const NO_FIT: Pick<ComposerState, 'fitTemplate' | 'fitParams' | 'fitValues'> = {
  fitTemplate: '',
  fitParams: [],
  fitValues: {},
}

/** 現在の係数化状態から ParamSpec を組み立てる。 */
export function fitSpecOf(c: ComposerState): ParamSpec {
  return { template: c.fitTemplate, params: c.fitParams, varName: c.mode === 'polar' ? 't' : 'x' }
}

/**
 * 式を係数化（数値リテラル→スライダー）して自由入力モードへ入るパッチを作る（#46）。
 * 検出に失敗したら freeError のみ返す（直前の状態を維持）。
 */
export function parametricPatch(expr: string, varName: 'x' | 't'): Partial<ComposerState> {
  const spec = detectParams(expr, varName)
  if (!spec) return { freeError: '式が正しくありません' }
  const values = initialValues(spec)
  return {
    useFree: true,
    freeError: null,
    freeExpr: renderExpr(spec, values),
    fitTemplate: spec.template,
    fitParams: spec.params,
    fitValues: values,
  }
}

/** 係数1つの値を更新し、自由入力式（freeExpr）を再生成するパッチを作る（#46）。 */
export function setCoeffPatch(c: ComposerState, key: string, value: number): Partial<ComposerState> {
  const values = { ...c.fitValues, [key]: value }
  const expr = renderExpr(fitSpecOf(c), values)
  return {
    fitValues: values,
    freeExpr: expr,
    yText: yTextOf(expr, c.mode),
    useFree: true,
    freeError: null,
  }
}

/**
 * z 場の式を係数化（数値リテラル→スライダー）して自由入力 z 場へ入るパッチを作る（#52）。
 * 軌道と同じ仕組みを z 式（x,y の 2 変数）にも適用する。検出/評価不能なら zFreeError のみ返す。
 */
export function zParametricPatch(expr: string, radial = true): Partial<ComposerState> {
  const d = detectCoeffs(expr)
  if (!d) return { zFreeError: '式が正しくありません' }
  const values = paramDefaults(d.params)
  const rendered = renderWithParams(d.template, d.params, values)
  const ok = radial ? !!parseExpression(rendered, 't') : !!parseZExpression(rendered)
  if (!ok) return { zFreeError: '式が正しくありません' }
  return {
    zUseFree: true,
    zFreeError: null,
    zFreeExpr: rendered,
    zFitTemplate: d.template,
    zFitParams: d.params,
    zFitValues: values,
  }
}

/** z 場の係数1つを更新し、z 自由入力式（zFreeExpr）を再生成するパッチを作る（#52）。 */
export function setZCoeffPatch(c: ComposerState, key: string, value: number): Partial<ComposerState> {
  const values = { ...c.zFitValues, [key]: value }
  const expr = renderWithParams(c.zFitTemplate, c.zFitParams, values)
  return { zFitValues: values, zFreeExpr: expr, zText: expr, zUseFree: true, zFreeError: null }
}

/**
 * y 欄の 1 行テキスト（`r=` で結界）をコンポーザのパッチへ。
 * 式は自由入力のまま保持し、数値リテラルは係数スライダーへ自動検出する（#46 と同じ仕組み）。
 */
export function yTextPatch(text: string): Partial<ComposerState> {
  const barrier = isBarrierText(text)
  const body = normalizeExprInput(barrier ? barrierBody(text) : text)
  const mode: 'rotate' | 'polar' = barrier ? 'polar' : 'rotate'
  const varName = barrier ? 't' : 'x'
  const src = body.trim() === '' ? '0' : body
  const fn = parseExpression(src, varName)
  if (!fn) {
    return { yText: text, mode, useFree: true, freeError: '式が読めません（記号・括弧を確認）' }
  }
  const patch = parametricPatch(src, varName)
  // 係数検出に失敗しても式そのものは通っているので、自由式として受け入れる
  if (patch.freeError) {
    return { yText: text, mode, useFree: true, freeExpr: src, freeError: null, ...NO_FIT }
  }
  return { yText: text, mode, ...patch }
}

/** z 欄の 1 行テキストをコンポーザのパッチへ（変数は t＝術者からの距離）。 */
export function zTextPatch(text: string): Partial<ComposerState> {
  const body = normalizeExprInput(text)
  const src = body.trim() === '' ? '0' : body
  if (!parseExpression(src, 't')) {
    return { zText: text, zUseFree: true, zFreeError: 'z の式が読めません（記号・括弧を確認）' }
  }
  const patch = zParametricPatch(src, true)
  if (patch.zFreeError) {
    return {
      zText: text,
      zUseFree: true,
      zFreeExpr: src,
      zFreeError: null,
      zFitTemplate: '',
      zFitParams: [],
      zFitValues: {},
    }
  }
  return { zText: text, ...patch }
}

export function presetsFor(mode: 'rotate' | 'polar'): Preset[] {
  return mode === 'rotate' ? ROTATE_PRESETS : POLAR_PRESETS
}

/**
 * 状態から軌道を組み立てる（origin=術者位置・z 場つき・#14/#30）。組み立てられなければ null。
 * fieldR（#49・06b §5.5）を渡すと inField 判定に使う場の半径を軌道へ紐づける（面/フェーズで可変）。
 */
export function buildComposerTrajectory(c: ComposerState, origin?: Vec2, fieldR?: number): Trajectory | null {
  const z = buildZField(c)
  if (c.mode === 'rotate') {
    if (c.useFree) {
      const g = parseExpression(c.freeExpr)
      if (!g) return null
      return { mode: 'rotate', g, angle: c.angle, origin, z, fieldR }
    }
    const preset = findPreset(c.presetId)
    if (!preset || preset.category !== 'rotate') return null
    return { ...buildTrajectory(preset, c.coeffs, c.angle, origin), z, fieldR }
  }
  if (c.useFree) {
    const f = parseExpression(c.freeExpr, 't')
    if (!f) return null
    return { mode: 'polar', f, origin, z, fieldR }
  }
  const preset = findPreset(c.presetId)
  if (!preset || preset.category !== 'polar') return null
  return { ...buildTrajectory(preset, c.coeffs, 0, origin), z, fieldR }
}

/** 軌道上の1点（描画で z により色分けする） */
export interface PathPoint {
  pos: Vec2
  z: number
}

/** プレビュー結果 */
export interface Preview {
  /** 発射型／軌道型（#12） */
  kind: MagicKind
  /** z つきの予測軌道（描画で属性ごとに色分け。軌道型はリング） */
  path: PathPoint[]
  landing: { pos: Vec2; attr: Attribute; strength: number } | null
  /** 見込み威力の目安（着弾点・動的なのであくまで目安） */
  powerEstimate: number
  /** 経路で到達しうる最大強度（どれだけ強く帯びられるか） */
  maxStrength: number
  /** 足元で暴発（自爆）の恐れ */
  selfMisfireWarning: boolean
  /** 関数（軌道 or z 場）がエラーで暴発する点。プレビューで赤く可視化する。エラーが無ければ null */
  misfirePos: Vec2 | null
}

const EMPTY_PREVIEW: Preview = {
  kind: 'projectile',
  path: [],
  landing: null,
  powerEstimate: 0,
  maxStrength: 0,
  selfMisfireWarning: false,
  misfirePos: null,
}

/**
 * 軌道からプレビュー（種別・予測軌道・着弾点・属性・威力目安・暴発警告）を計算する。
 * obstacles を渡すと、発射型は障害物で削れて止まる経路を反映する（予測線が壁を素通りしない）。
 */
export function computePreview(
  traj: Trajectory | null,
  speed: number,
  obstacles: Obstacle[] = [],
): Preview {
  if (!traj) return EMPTY_PREVIEW
  const kind = classifyTrajectory(traj)
  let flight = simulateFlight(traj, speed)
  // 発射型は障害物の削り・停止を予測に反映（壁すり抜け表示を防ぐ）。obstacles は複製して非破壊
  if (kind === 'projectile' && obstacles.length > 0) {
    const cloned = obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
    flight = traverseObstacles(traj, speed, flight, cloned).flight
  }
  // 軌道型は結界リング（場外でも一周する全周）をプレビューに使う（#22）。発射型は飛行軌道。
  const geomPts: Vec2[] =
    kind === 'orbit' ? buildRing(traj).map((r) => r.pos) : flight.samples.map((s) => s.pos)
  // #21：プレビューの canvas では z（属性）を見せない。経路は中立色（z=0）で描く。
  const path: PathPoint[] = geomPts.map((pos) => ({ pos, z: 0 }))
  const last = flight.samples[flight.samples.length - 1]
  const endZ = last ? zfieldAt(traj, last.pos) : 0
  const endSpeed = last ? flight.endSpeed : speed
  // パネルの計算補助用に、実際の z 場での最大強度を求める（canvas には出さない）
  const maxStrength = geomPts.reduce((m, pos) => Math.max(m, strengthOf(zfieldAt(traj, pos))), 0)

  const mis = detectMisfire(traj)
  // エラー暴発（invalid）のみ赤マーカーで可視化する。場外脱出（outOfField＝ただの外れ）は出さない
  const misfirePos = mis && mis.type === 'invalid' ? mis.pos : null
  const selfMisfireWarning = !!mis && mis.type === 'invalid' && dist(mis.pos) <= FIELD.aoeRadius + 1

  return {
    kind,
    path,
    landing: last
      ? { pos: last.pos, attr: attributeOf(endZ), strength: strengthOf(endZ) }
      : null,
    powerEstimate: endSpeed * strengthOf(endZ),
    maxStrength,
    selfMisfireWarning,
    misfirePos,
  }
}
