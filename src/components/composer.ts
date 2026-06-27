// 関数パネルの状態 → 軌道・プレビューへの橋渡し（純粋ヘルパー、React 非依存）。
import type { Attribute, Field, Trajectory, Vec2 } from '../game/types'
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
import { evalField, attributeOf, strengthOf } from '../game/attribute'
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

/** 状態から軌道を組み立てる。組み立てられなければ null（不正な自由式など）。 */
export function buildComposerTrajectory(c: ComposerState): Trajectory | null {
  if (c.actionKind !== 'attack') return null
  if (c.mode === 'rotate') {
    if (c.useFree) {
      const g = parseExpression(c.freeExpr)
      if (!g) return null
      return { mode: 'rotate', g, angle: c.angle }
    }
    const preset = findPreset(c.presetId)
    if (!preset || preset.category !== 'rotate') return null
    return buildTrajectory(preset, c.coeffs, c.angle)
  }
  const preset = findPreset(c.presetId)
  if (!preset || preset.category !== 'polar') return null
  return buildTrajectory(preset, c.coeffs, 0)
}

/** プレビュー結果 */
export interface Preview {
  path: Vec2[]
  landing: { pos: Vec2; attr: Attribute; strength: number } | null
  /** 見込み威力の目安（命中時・動的なのであくまで目安） */
  powerEstimate: number
  /** 足元で暴発（自爆）の恐れ */
  selfMisfireWarning: boolean
}

/** 軌道と場からプレビュー（予測軌道・着弾点・属性・威力目安・暴発警告）を計算する。 */
export function computePreview(traj: Trajectory | null, speed: number, field: Field): Preview {
  if (!traj) return { path: [], landing: null, powerEstimate: 0, selfMisfireWarning: false }
  const flight = simulateFlight(traj, speed, field)
  const path = flight.samples.map((s) => s.pos)
  const z = evalField(field, flight.endPos)
  const attr = attributeOf(z)
  const strength = strengthOf(z)
  const endSpeed = flight.samples.length > 0 ? flight.endSpeed : speed

  // 足元で暴発：原点近傍で発散・未定義になる軌道
  const mis = detectMisfire(traj)
  const selfMisfireWarning = !!mis && mis.type === 'invalid' && dist(mis.pos) <= FIELD.aoeRadius + 1

  return {
    path,
    landing: flight.samples.length > 0 ? { pos: flight.endPos, attr, strength } : null,
    powerEstimate: endSpeed * strength,
    selfMisfireWarning,
  }
}
