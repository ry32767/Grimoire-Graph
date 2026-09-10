// 正典v3の二重輪・白熱芯・属性破片を、pixelfxの整数ドットへ落とす。
import { SPELL_VFX as FX } from '../data/spellVfx'
import { attributeOf } from '../game/attribute'
import { toScreen, type Viewport } from '../game/coords'
import type { Vec2 } from '../game/types'
import { dot, dotPx, pixelRing, pixelShockwave, snapAngle } from './pixelfx'

const TAU = Math.PI * 2
const live = (progress: number) => Number.isFinite(progress) && progress >= 0 && progress < 1
const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

/** 短い光条も線描画を使わず、同じ格子のドットで刻む。 */
function ray(ctx: CanvasRenderingContext2D, p: Vec2, angle: number, start: number, end: number,
  unit: number, color: string, alpha: number): void {
  for (let r = start; r <= end; r += unit * 2) {
    dot(ctx, p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r, unit, color, alpha)
  }
}

/** 呼び出し側の260msに収まる、収束→解放の二重魔法陣。 */
export function drawCastSigil(ctx: CanvasRenderingContext2D, vp: Viewport, pos: Vec2,
  z: number, progress: number): void {
  if (!live(progress)) return
  const p = toScreen(pos, vp), unit = dotPx(vp), attr = attributeOf(z), color = FX.colors[attr]
  const q = Math.floor(progress * FX.cast.steps) / FX.cast.steps
  const release = Math.max(0, (q - FX.cast.gatherEnd) / (1 - FX.cast.gatherEnd))
  const radius = release > 0 ? 12 + release * 20 : FX.cast.radius - q / FX.cast.gatherEnd * 14
  const alpha = (1 - progress) * (attr === 'neutral' ? 0.6 : 1)
  const rotation = attr === 'dark' ? snapAngle(q * 2) : 0
  ctx.save()
  for (let ring = 0; ring < 2; ring++) {
    const r = radius * (ring ? FX.cast.innerRatio : 1)
    for (let sector = 0; sector < FX.cast.sectors; sector++) {
      for (let d = 0; d < FX.cast.dotsPerSector; d++) {
        const a = sector / FX.cast.sectors * TAU + d * 0.12 + rotation * (ring ? -1 : 1)
        dot(ctx, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, unit, color, alpha * (ring ? 0.65 : 1))
      }
      const a = sector / FX.cast.sectors * TAU + rotation
      if (!ring) {
        ray(ctx, p, a, r + unit * 2, r + unit * 4, unit, color, alpha)
        // 交互の短い横刻みで、文字ではないルーン状の輪郭を作る。
        const c = { x: p.x + Math.cos(a) * (r + unit * 3), y: p.y + Math.sin(a) * (r + unit * 3) }
        ray(ctx, c, a + Math.PI / 2, 0, unit * (sector % 2 + 1), unit, color, alpha)
      }
    }
  }
  if (attr === 'light') {
    for (let i = 0; i < 4; i++) ray(ctx, p, i * Math.PI / 2, 0, 4 + release * 22, unit, FX.colors.core, alpha)
  } else if (attr === 'dark') {
    pixelRing(ctx, p.x, p.y, unit * 3, 12, unit, color, alpha)
  } else dot(ctx, p.x, p.y, unit * 2, color, alpha)
  ctx.restore()
}

/** 呼び出し側の420msに収まる着弾。輪の外径は威力に従い36～55px。 */
export function drawSpellImpact(ctx: CanvasRenderingContext2D, vp: Viewport, pos: Vec2,
  progress: number, z = 0, powerFrac = 0.5): void {
  if (!live(progress)) return
  const p = toScreen(pos, vp), unit = dotPx(vp), attr = attributeOf(z), color = FX.colors[attr]
  const power = clamp(powerFrac), radius = FX.impact.minRadius + power * (FX.impact.maxRadius - FX.impact.minRadius)
  const q = Math.floor(progress * FX.impact.steps) / FX.impact.steps
  const alpha = (1 - progress) * (attr === 'neutral' ? 0.7 : 1)
  ctx.save()
  for (let ring = 0; ring < 2; ring++) {
    const t = (progress - ring * FX.impact.echoDelay) / (1 - ring * FX.impact.echoDelay)
    if (t < 0) continue
    pixelShockwave(ctx, p.x, p.y, 4, radius * (ring ? 0.75 : 1) - 4,
      t, FX.impact.steps, unit, color, ring ? color : FX.colors.core, alpha * (ring ? 0.6 : 0.8))
  }
  const count = attr === 'neutral' ? 6 : FX.impact.fragments
  for (let i = 0; i < count; i++) {
    const a = snapAngle(i / count * TAU + (attr === 'dark' ? q * 2 : 0))
    const reach = (6 + q * (radius - 10)) * (i % 2 ? 0.85 : 1)
    if (attr === 'light') ray(ctx, p, a, reach * 0.65, reach, unit, i % 3 ? color : FX.colors.core, alpha)
    else {
      const c = { x: p.x + Math.cos(a) * reach, y: p.y + Math.sin(a) * reach }
      dot(ctx, c.x, c.y, unit * (i % 3 === 0 ? 2 : 1), color, alpha)
      if (attr === 'dark') ray(ctx, c, a + Math.PI / 2, unit * 2, unit * 3, unit, color, alpha * 0.6)
    }
  }
  if (progress < FX.impact.coreEnd) {
    const core = (1 - progress / FX.impact.coreEnd) * (4 + power * 6)
    for (let i = 0; i < 4; i++) ray(ctx, p, i * Math.PI / 2, 0, core, unit, FX.colors.core, 1 - progress)
  }
  ctx.restore()
}

/** 現在位置以前の実サンプルだけを使う短い尾。粒は毎回算出し蓄積しない。 */
export function drawSpellWake(ctx: CanvasRenderingContext2D, vp: Viewport,
  pts: { pos: Vec2; z: number }[], idx: number, phase: number, powerFrac: number): void {
  const power = clamp(powerFrac)
  if (power <= FX.wake.minPower || !Number.isFinite(idx) || idx < 1 || !Number.isFinite(phase)) return
  const end = Math.min(Math.floor(idx), pts.length - 1), unit = dotPx(vp)
  const tick = Math.floor(phase * FX.wake.phaseSteps)
  ctx.save()
  for (let s = 0; s < FX.wake.count; s++) {
    const j = end - 1 - s * FX.wake.stride
    if (j < 1) break
    const b = pts[j], p = toScreen(b.pos, vp), prev = toScreen(pts[j - 1].pos, vp)
    const angle = Math.atan2(p.y - prev.y, p.x - prev.x), attr = attributeOf(b.z), color = FX.colors[attr]
    const alpha = (1 - s / FX.wake.count) * power * 0.7
    if (attr === 'light') ray(ctx, p, angle + Math.PI, 0, unit * (4 - Math.floor(s / 3)), unit, color, alpha)
    else if (attr === 'dark') {
      const side = s % 2 ? 1 : -1, spin = snapAngle((tick + s) * 0.45)
      const c = { x: p.x + Math.cos(angle + Math.PI / 2) * side * unit * 2,
        y: p.y + Math.sin(angle + Math.PI / 2) * side * unit * 2 }
      for (let k = 0; k < 3; k++) dot(ctx, c.x + Math.cos(spin + k * 0.6) * unit * 2,
        c.y + Math.sin(spin + k * 0.6) * unit * 2, unit, color, alpha)
    } else if (s < 3) dot(ctx, p.x, p.y, unit, color, alpha * 0.6)
  }
  ctx.restore()
}
