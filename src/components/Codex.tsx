import { useEffect, useRef } from 'react'
import { ROTATE_PRESETS, POLAR_PRESETS, defaultCoeffs, buildTrajectory, type Preset } from '../game/functions'
import { sampleTrajectory, validPrefix } from '../game/coords'
import { COLORS } from '../render/theme'
import { STAGES } from '../data/stages'
import type { Enemy } from '../game/types'

/** 敵の得意関数（系統）ラベル（#23） */
const FAMILY_LABEL: Record<Enemy['family'], string> = {
  line: '直進',
  arc: '弧',
  wave: '波',
  spiral: '渦',
  exp: '昇り',
  poly34: '捻れ',
}

/** 図鑑の敵カタログ：全ステージの敵を名前で一意化（出現順）。 */
interface EnemyEntry {
  name: string
  element: Enemy['element']
  family: Enemy['family']
  maxHp: number
  role?: Enemy['role']
}
const ENEMY_CATALOG: EnemyEntry[] = (() => {
  const seen = new Set<string>()
  const out: EnemyEntry[] = []
  for (const s of STAGES) {
    for (const e of s.enemies) {
      if (seen.has(e.name)) continue
      seen.add(e.name)
      out.push({ name: e.name, element: e.element, family: e.family, maxHp: e.maxHp, role: e.role })
    }
  }
  return out
})()

function elementLabel(el: Enemy['element']): string {
  return el === 'light' ? '光' : el === 'dark' ? '闇' : '無'
}

/** 戦い方ロールのラベル（#28/#42） */
function roleLabel(role: Enemy['role']): string {
  return role === 'guardian' ? '守護' : role === 'breaker' ? '破壊' : role === 'ruptor' ? '崩し' : '攻撃'
}

/** 敵カード：遭遇済みは詳細、未遭遇は「？」で伏せる（#23）。 */
function EnemyCard({ entry, seen }: { entry: EnemyEntry; seen: boolean }) {
  if (!seen) {
    return (
      <div className="codex-card enemy-card unseen">
        <div className="enemy-qmark">？</div>
        <div className="desc">未遭遇の敵</div>
      </div>
    )
  }
  return (
    <div className={`codex-card enemy-card ${entry.element}`}>
      <div>
        <strong>{entry.name}</strong>
      </div>
      <div className="desc">
        属性：{elementLabel(entry.element)}／得意：{FAMILY_LABEL[entry.family]}／戦：
        {roleLabel(entry.role)}／HP {entry.maxHp}
      </div>
    </div>
  )
}

const W = 230
const H = 110

/** プリセットの既定曲線を自動フィットで描く小プレビュー。 */
function CurvePreview({ preset }: { preset: Preset }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, W, H)
    const traj = buildTrajectory(preset, defaultCoeffs(preset), 0)
    const pts = validPrefix(sampleTrajectory(traj)).map((s) => s.pos)
    if (pts.length < 2) return
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    minX = Math.min(minX, 0); maxX = Math.max(maxX, 0)
    minY = Math.min(minY, 0); maxY = Math.max(maxY, 0)
    const pad = 12
    const sx = (W - pad * 2) / (maxX - minX || 1)
    const sy = (H - pad * 2) / (maxY - minY || 1)
    const s = Math.min(sx, sy)
    const map = (p: { x: number; y: number }) => ({
      x: pad + (p.x - minX) * s,
      y: H - pad - (p.y - minY) * s,
    })
    // 原点
    const o = map({ x: 0, y: 0 })
    ctx.fillStyle = COLORS.caster
    ctx.beginPath()
    ctx.arc(o.x, o.y, 3, 0, Math.PI * 2)
    ctx.fill()
    // 曲線
    ctx.strokeStyle = COLORS.light1
    ctx.lineWidth = 2
    ctx.beginPath()
    const p0 = map(pts[0])
    ctx.moveTo(p0.x, p0.y)
    for (const p of pts.slice(1)) {
      const m = map(p)
      ctx.lineTo(m.x, m.y)
    }
    ctx.stroke()
  }, [preset])
  return <canvas ref={ref} width={W} height={H} />
}

function Card({ preset, active }: { preset: Preset; active: boolean }) {
  return (
    <div className={`codex-card${active ? ' active' : ''}`}>
      <div>
        <strong>{preset.name}</strong> <span className="formula">{preset.formula}</span>
      </div>
      <CurvePreview preset={preset} />
      <div className="desc">{preset.description}</div>
    </div>
  )
}

interface Props {
  activePresetId?: string
  seenEnemies?: Set<string>
  onClose: () => void
}

export default function Codex({ activePresetId, seenEnemies, onClose }: Props) {
  const seen = seenEnemies ?? new Set<string>()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>関数図鑑（古代式一覧）</h2>
          <button className="btn small" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="section-title">A. 回転 y=g(x)（狙う角度θで回転）</div>
        <div className="codex-grid">
          {ROTATE_PRESETS.map((p) => (
            <Card key={p.id} preset={p} active={p.id === activePresetId} />
          ))}
        </div>
        <div className="section-title">B. 極座標 r=f(θ)（全方向）</div>
        <div className="codex-grid">
          {POLAR_PRESETS.map((p) => (
            <Card key={p.id} preset={p} active={p.id === activePresetId} />
          ))}
        </div>
        <div className="section-title">
          C. 敵図鑑（{[...ENEMY_CATALOG].filter((e) => seen.has(e.name)).length}/{ENEMY_CATALOG.length}）
        </div>
        <div className="codex-grid">
          {ENEMY_CATALOG.map((e) => (
            <EnemyCard key={e.name} entry={e} seen={seen.has(e.name)} />
          ))}
        </div>
      </div>
    </div>
  )
}
