// 関数パネルの状態 → 軌道・プレビューへの橋渡し（純粋ヘルパー、React 非依存）。
import type { Attribute, Trajectory, Vec2 } from '../game/types'
import {
  ALL_PRESETS,
  ROTATE_PRESETS,
  POLAR_PRESETS,
  parseExpression,
  buildTrajectory,
  type Preset,
} from '../game/functions'
import { simulateFlight } from '../game/physics'
import { detectMisfire } from '../game/misfire'
import { trajectoryZ, attributeOf, strengthOf } from '../game/attribute'
import { dist } from '../game/coords'
import { FIELD } from '../data/constants'

/** 関数パネルの状態 */
export interface ComposerState {
  mode: 'rotate' | 'polar'
  presetId: string
  coeffs: Record<string, number>
  angle: number
  speed: number
  useFree: boolean
  freeExpr: string
  freeError: string | null
  actionKind: 'attack' | 'shield'
  shieldPresetId: string
  shieldElement: 'light' | 'dark'
}

export function findPreset(id: string): Preset | undefined {
  return ALL_PRESETS.find((p) => p.id === id)
}

export function presetsFor(mode: 'rotate' | 'polar'): Preset[] {
  return mode === 'rotate' ? ROTATE_PRESETS : POLAR_PRESETS
}

/** 状態から軌道を組み立てる（origin=術者位置・#14）。組み立てられなければ null。 */
export function buildComposerTrajectory(c: ComposerState, origin?: Vec2): Trajectory | null {
  if (c.actionKind !== 'attack') return null
  if (c.mode === 'rotate') {
    if (c.useFree) {
      const g = parseExpression(c.freeExpr)
      if (!g) return null
      return { mode: 'rotate', g, angle: c.angle, origin }
    }
    const preset = findPreset(c.presetId)
    if (!preset || preset.category !== 'rotate') return null
    return buildTrajectory(preset, c.coeffs, c.angle, origin)
  }
  const preset = findPreset(c.presetId)
  if (!preset || preset.category !== 'polar') return null
  return buildTrajectory(preset, c.coeffs, 0, origin)
}

/** 軌道上の1点（描画で z により色分けする） */
export interface PathPoint {
  pos: Vec2
  z: number
}

/** プレビュー結果 */
export interface Preview {
  /** z つきの予測軌道（描画で属性ごとに色分け） */
  path: PathPoint[]
  landing: { pos: Vec2; attr: Attribute; strength: number } | null
  /** 見込み威力の目安（着弾点・動的なのであくまで目安） */
  powerEstimate: number
  /** 経路で到達しうる最大強度（どれだけ強く帯びられるか） */
  maxStrength: number
  /** 足元で暴発（自爆）の恐れ */
  selfMisfireWarning: boolean
}

/** 軌道からプレビュー（予測軌道・着弾点・属性・威力目安・暴発警告）を計算する。 */
export function computePreview(traj: Trajectory | null, speed: number): Preview {
  if (!traj)
    return { path: [], landing: null, powerEstimate: 0, maxStrength: 0, selfMisfireWarning: false }
  const flight = simulateFlight(traj, speed)
  const path: PathPoint[] = flight.samples.map((s) => ({ pos: s.pos, z: trajectoryZ(traj, s.param) }))
  const last = flight.samples[flight.samples.length - 1]
  const endZ = last ? trajectoryZ(traj, last.param) : 0
  const endSpeed = last ? flight.endSpeed : speed
  const maxStrength = path.reduce((m, p) => Math.max(m, strengthOf(p.z)), 0)

  const mis = detectMisfire(traj)
  const selfMisfireWarning = !!mis && mis.type === 'invalid' && dist(mis.pos) <= FIELD.aoeRadius + 1

  return {
    path,
    landing: last
      ? { pos: last.pos, attr: attributeOf(endZ), strength: strengthOf(endZ) }
      : null,
    powerEstimate: endSpeed * strengthOf(endZ),
    maxStrength,
    selfMisfireWarning,
  }
}
