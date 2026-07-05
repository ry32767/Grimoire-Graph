// ステージエディタの書き出し（#67・docs/11-stage-editor.md §9）。
// exportToTS：stages.ts に貼り付けられる TS コード片（enemy()/pillar() 等の呼び出し列＋Stage リテラル）。
// exportToJSON：本編 Stage 形（compile 済み）をそのまま JSON 化（差分確認・二次利用向け）。
// どちらも副作用のない純粋関数（クリップボード操作は呼び出し側 ExportBar が行う）。
import type { BossPhase, Enemy, Obstacle } from '../game/types'
import { GAME } from '../data/constants'
import { CAST_SPEED, LVL_SCALE } from '../data/stageBuilders'
import { toStage, type EditorStage, type ObstacleOp } from './model'

/** 数値を小数3桁までに丸めて表示用に整形（ドラッグ操作由来の長い小数を読みやすくする）。 */
function num(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return String(r)
}

/** 文字列リテラル（シングルクォート・コードベースの慣習に合わせる）。 */
function str(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** 任意値を素朴な JS/TS リテラルへ（enemy() opts・colonnade の elems 用）。 */
function jsLiteral(v: unknown): string {
  if (typeof v === 'string') return str(v)
  if (typeof v === 'number') return num(v)
  if (typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.map(jsLiteral).join(', ')}]`
  if (v && typeof v === 'object') return objectLiteral(v as Record<string, unknown>)
  return 'undefined'
}

/** `{ key: value, ... }` 形式のオブジェクトリテラル（キーは未クォート＝コードベースの慣習）。 */
function objectLiteral(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj)
  if (keys.length === 0) return '{}'
  return `{ ${keys.map((k) => `${k}: ${jsLiteral(obj[k])}`).join(', ')} }`
}

/** 障害物ヘルパー呼び出しの引数列（stageBuilders の各シグネチャと1:1）。 */
function opArgs(op: ObstacleOp, rField: number): string[] {
  switch (op.kind) {
    case 'pillar': {
      const p = op.params
      const args = [num(p.cx), num(p.y0), num(p.n), str(p.element)]
      if (p.kind) args.push(str(p.kind))
      return args
    }
    case 'block': {
      const p = op.params
      const args = [num(p.x0), num(p.y0), num(p.cols), num(p.rows), str(p.element)]
      if (p.kind) args.push(str(p.kind))
      return args
    }
    case 'wall': {
      const p = op.params
      const args = [num(p.x0), num(p.x1), num(p.y0), num(p.rows), str(p.element)]
      if (p.kind) args.push(str(p.kind))
      return args
    }
    case 'colonnade': {
      const p = op.params
      return [num(p.x0), num(p.x1), num(p.step), num(p.y0), num(p.n), jsLiteral(p.elems)]
    }
    case 'spiralArm': {
      const p = op.params
      const args = [num(p.cx), num(p.cy), num(p.n), num(p.turns), num(p.phase), str(p.element)]
      if (p.r0 !== undefined) args.push(num(p.r0))
      return args
    }
    case 'ring': {
      const p = op.params
      const args = [num(p.cx), num(p.cy), num(p.radius), str(p.element)]
      if (p.n !== undefined) {
        args.push(p.kind ? str(p.kind) : 'undefined')
        args.push(num(p.n))
      } else if (p.kind) {
        args.push(str(p.kind))
      }
      return args
    }
    case 'roomWalls': {
      const p = op.params
      const args = [num(p.xL), num(p.xR), num(p.yB), num(p.yT), num(rField)]
      if (p.kind) {
        args.push(str(p.element ?? 'neutral'))
        args.push(str(p.kind))
      } else if (p.element) {
        args.push(str(p.element))
      }
      return args
    }
    case 'roomWallsOpenEnds': {
      const p = op.params
      return [num(p.xL), num(p.xR), num(rField)]
    }
    case 'raw':
      return []
  }
}

/** 1件のヘルパー呼び出し（結果が Obstacle[] を返すものはスプレッド `...` を付ける）。 */
const RETURNS_ARRAY = new Set<ObstacleOp['kind']>(['colonnade', 'roomWalls', 'roomWallsOpenEnds'])

function obstacleOpLine(op: ObstacleOp, rField: number): string {
  if (op.kind === 'raw') {
    // 既存ステージ取り込み分（fromStage）は元のヘルパー呼び出しへ逆変換できないため、
    // コンパイル済みの素材をそのまま埋め込む（要・手動でのヘルパー呼び出しへの置き換え）。
    return `...${JSON.stringify(op.params.obstacles)}, // TODO: 既存ステージ取り込み分。pillar/wall 等の呼び出しへ手動で置き換え推奨`
  }
  const call = `${op.kind}(${opArgs(op, rField).join(', ')})`
  return RETURNS_ARRAY.has(op.kind) ? `...${call},` : `${call},`
}

/** enemy() の opts（既定値と異なるものだけを出力し、可読性を保つ）。 */
function enemyOptsLiteral(e: Enemy, level: number): string {
  const scale = LVL_SCALE[level] ?? LVL_SCALE[7]
  const defaultHp = Math.round(100 * scale.hp)
  const opts: Record<string, unknown> = {}
  if (e.hp !== defaultHp) opts.hp = e.hp
  if (e.families && e.families.length > 0) opts.families = e.families
  if (e.role) opts.role = e.role
  if (e.castInitialSpeed !== CAST_SPEED) opts.castInitialSpeed = e.castInitialSpeed
  if (e.hitboxRadius !== GAME.enemyHitbox) opts.hitboxRadius = e.hitboxRadius
  if (e.ruptorTarget) opts.ruptorTarget = e.ruptorTarget
  if (e.fireEvery !== undefined) opts.fireEvery = e.fireEvery
  if (e.fireOffset !== undefined) opts.fireOffset = e.fireOffset
  if (e.castCount !== undefined) opts.castCount = e.castCount
  if (e.patternPool && e.patternPool.length > 0) opts.patternPool = e.patternPool
  if (e.boss) opts.boss = e.boss
  if (e.slipThrough) opts.slipThrough = e.slipThrough
  if (e.alternatingAura) opts.alternatingAura = e.alternatingAura
  if (e.directedAura) opts.directedAura = e.directedAura
  if (e.species) opts.species = e.species
  return objectLiteral(opts)
}

/** 敵1体ぶんの `enemy(...)` 呼び出し（castZField はプリセット式へ逆変換できないため TODO を添える）。 */
function enemyLine(e: Enemy, fallbackLevel: number): string {
  const level = e.level ?? fallbackLevel
  const opts = enemyOptsLiteral(e, level)
  const optsArg = opts === '{}' ? '' : `, ${opts}`
  const pos = `{ x: ${num(e.pos.x)}, y: ${num(e.pos.y)} }`
  let line = `enemy(${str(e.name)}, ${pos}, ${str(e.element)}, ${level}, ${str(e.family)}${optsArg}),`
  if (e.castZField) {
    line += ` // TODO: z場（プリセット式）は自動復元できません。目安 castZ=${num(e.castZ)} で手動設定してください`
  }
  return line
}

/** ボスの HP フェーズ1件ぶんのリテラル（obstacles は素材を JSON でそのまま埋め込む）。 */
function bossPhaseLiteral(p: BossPhase): string {
  const parts = [`hpBelow: ${num(p.hpBelow)}`, `castCount: ${num(p.castCount)}`]
  if (p.cullMinions) parts.push('cullMinions: true')
  if (p.rField !== undefined) parts.push(`rField: ${num(p.rField)}`)
  parts.push(`obstacles: ${JSON.stringify(p.obstacles as Obstacle[])}`)
  return `{ ${parts.join(', ')} }`
}

/**
 * 現在の EditorStage を stages.ts に貼り付け可能な TS コード片へ変換する（#67 §9）。
 * enemy()/pillar()/block()/wall()/colonnade()/spiralArm()/ring()/roomWalls()/roomWallsOpenEnds()
 * の呼び出し列＋Stage リテラルとして出力する（貼り付け後に手直しする前提の補助出力）。
 */
export function exportToTS(stage: EditorStage): string {
  const lines: string[] = []
  lines.push('// ステージエディタからの書き出し（#67 §9）。stages.ts に貼り付けて調整してください。')
  lines.push('const editedStage: Stage = {')
  lines.push(`  id: ${str(stage.meta.stageId)},`)
  lines.push(`  name: ${str(stage.meta.name)},`)
  lines.push(`  rField: ${num(stage.rField)},`)
  if (stage.allyPositions) {
    lines.push(`  allyPositions: [${stage.allyPositions.map((p) => `{ x: ${num(p.x)}, y: ${num(p.y)} }`).join(', ')}],`)
  }
  lines.push('  enemies: [')
  for (const e of stage.enemies) lines.push(`    ${enemyLine(e, stage.level)}`)
  lines.push('  ],')
  lines.push('  obstacles: [')
  for (const op of stage.obstacleOps) lines.push(`    ${obstacleOpLine(op, stage.rField)}`)
  lines.push('  ],')
  lines.push(`  introText: [${stage.meta.introText.map(str).join(', ')}],`)
  lines.push(`  clearText: [${stage.meta.clearText.map(str).join(', ')}],`)
  lines.push(`  mechanics: ${objectLiteral(stage.mechanics as unknown as Record<string, unknown>)},`)
  if (stage.meta.boss) lines.push('  boss: true,')
  if (stage.bossPhases && stage.bossPhases.length > 0) {
    lines.push('  bossPhases: [')
    for (const p of stage.bossPhases) lines.push(`    ${bossPhaseLiteral(p)},`)
    lines.push('  ],')
  }
  lines.push('}')
  return lines.join('\n')
}

/** 現在の EditorStage を本編 Stage 形（compile 済み）で JSON 化する（差分確認・二次利用向け・#67 §9）。 */
export function exportToJSON(stage: EditorStage): string {
  return JSON.stringify(toStage(stage), null, 2)
}
