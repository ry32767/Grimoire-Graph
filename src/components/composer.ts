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
  /** z 場（属性 z=f(x,y)）の状態（#30/#21） */
  zPresetId: string
  zCoeffs: Record<string, number>
  zUseFree: boolean
  zFreeExpr: string
  zFreeError: string | null
}

/** 状態から z 場（属性 z=f(x,y)）を組み立てる（#30）。組み立てられなければ中立(0)。 */
export function buildZField(c: ComposerState): ZField {
  if (c.zUseFree) {
    const f = parseZExpression(c.zFreeExpr)
    if (f) return f
  }
  const preset = findZPreset(c.zPresetId)
  if (preset) return preset.build(c.zCoeffs)
  return () => 0
}

export function findPreset(id: string): Preset | undefined {
  return ALL_PRESETS.find((p) => p.id === id)
}

export function presetsFor(mode: 'rotate' | 'polar'): Preset[] {
  return mode === 'rotate' ? ROTATE_PRESETS : POLAR_PRESETS
}

/** 状態から軌道を組み立てる（origin=術者位置・z 場つき・#14/#30）。組み立てられなければ null。 */
export function buildComposerTrajectory(c: ComposerState, origin?: Vec2): Trajectory | null {
  const z = buildZField(c)
  if (c.mode === 'rotate') {
    if (c.useFree) {
      const g = parseExpression(c.freeExpr)
      if (!g) return null
      return { mode: 'rotate', g, angle: c.angle, origin, z }
    }
    const preset = findPreset(c.presetId)
    if (!preset || preset.category !== 'rotate') return null
    return { ...buildTrajectory(preset, c.coeffs, c.angle, origin), z }
  }
  if (c.useFree) {
    const f = parseExpression(c.freeExpr, 't')
    if (!f) return null
    return { mode: 'polar', f, origin, z }
  }
  const preset = findPreset(c.presetId)
  if (!preset || preset.category !== 'polar') return null
  return { ...buildTrajectory(preset, c.coeffs, 0, origin), z }
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
}

const EMPTY_PREVIEW: Preview = {
  kind: 'projectile',
  path: [],
  landing: null,
  powerEstimate: 0,
  maxStrength: 0,
  selfMisfireWarning: false,
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
  }
}
