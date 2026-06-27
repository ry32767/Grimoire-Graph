import { useEffect, useRef } from 'react'
import type { Ally, Attribute, Enemy, Obstacle, Vec2, ZPoint } from '../game/types'
import { FIELD } from '../data/constants'
import type { Viewport } from '../game/coords'
import { drawScene, drawBullet, drawTrail, drawMisfire, strokeZPath, type SceneParams } from '../render/draw'
import { COLORS } from '../render/theme'

const INTERNAL = 520
const VP: Viewport = { width: INTERNAL, height: INTERNAL, unitsRadius: FIELD.rField }

/** 弾の1サンプル（位置・速度・弧長）。速度で演出のペースを物理に一致させる（#7）。 */
export interface AnimSample {
  pos: Vec2
  speed: number
  arcLen: number
}

/** アニメーション用の1発（発射型／敵弾） */
export interface AnimBullet {
  samples: AnimSample[]
  side: 'ally' | 'enemy'
  misfirePos: Vec2 | null
}

/** 軌道型リング */
export interface AnimOrbit {
  ring: ZPoint[]
}

export interface ResolveAnimation {
  bullets: AnimBullet[]
  orbits: AnimOrbit[]
}

interface Props {
  allies: Ally[]
  enemies: Enemy[]
  obstacles: Obstacle[]
  activeAllyId?: string | null
  playerPaths?: (ZPoint[] | null)[]
  ghostPaths?: Vec2[][]
  landings?: ({ pos: Vec2; attr: Attribute } | null)[]
  animation?: ResolveAnimation | null
  onAnimationDone?: () => void
}

const MS_PER_GAMESEC = 360
const MIN_MS = 700
const MAX_MS = 2300
const MIN_SPEED = 0.5

/** 弾サンプルから「各点までの到達ゲーム時間」を積分する（速度の逆数を弧長で積分）。 */
function buildTimeline(samples: AnimSample[]): { tCum: number[]; total: number } {
  const tCum = [0]
  for (let i = 1; i < samples.length; i++) {
    const ds = samples[i].arcLen - samples[i - 1].arcLen
    const v = Math.max(MIN_SPEED, (samples[i].speed + samples[i - 1].speed) / 2)
    tCum.push(tCum[i - 1] + ds / v)
  }
  return { tCum, total: tCum[tCum.length - 1] || 0 }
}

/** ゲーム時間 τ における弾の位置とサンプル index（速度に応じて進む）。 */
function posAtTime(samples: AnimSample[], tCum: number[], total: number, tau: number): { pos: Vec2; idx: number } {
  if (samples.length === 0) return { pos: { x: 0, y: 0 }, idx: 0 }
  if (tau >= total) return { pos: samples[samples.length - 1].pos, idx: samples.length - 1 }
  let j = 0
  while (j < tCum.length - 1 && tCum[j + 1] <= tau) j++
  const a = samples[j]
  const b = samples[Math.min(j + 1, samples.length - 1)]
  const span = tCum[j + 1] - tCum[j]
  const f = span > 0 ? (tau - tCum[j]) / span : 0
  return { pos: { x: a.pos.x + (b.pos.x - a.pos.x) * f, y: a.pos.y + (b.pos.y - a.pos.y) * f }, idx: j }
}

export default function BattleCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const doneRef = useRef(props.onAnimationDone)
  doneRef.current = props.onAnimationDone

  const staticParams: SceneParams = {
    vp: VP,
    allies: props.allies,
    enemies: props.enemies,
    obstacles: props.obstacles,
    activeAllyId: props.activeAllyId,
    playerPaths: props.playerPaths,
    ghostPaths: props.ghostPaths,
    landings: props.landings,
  }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (!props.animation) {
      drawScene(ctx, staticParams)
      return
    }

    const anim = props.animation
    // 各弾の時間軸を構築。最も時間のかかる弾でアニメーション窓を決める（速い弾は先に着く＝#7）
    const timelines = anim.bullets.map((b) => buildTimeline(b.samples))
    const maxTotal = Math.max(0.001, ...timelines.map((t) => t.total))
    const realMs = Math.min(MAX_MS, Math.max(MIN_MS, maxTotal * MS_PER_GAMESEC))

    let raf = 0
    let finished = false
    const start = performance.now()
    const finish = () => {
      if (finished) return
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      doneRef.current?.()
    }
    const frame = (now: number) => {
      const e = Math.min(1, (now - start) / realMs)
      const tau = e * maxTotal
      const phase = e * realMs * 0.02
      drawScene(ctx, { ...staticParams, playerPaths: undefined, landings: undefined })

      // 軌道型リング（脈動＋周回点）
      for (const o of anim.orbits) {
        if (o.ring.length < 2) continue
        ctx.save()
        ctx.globalAlpha = 0.45 + 0.4 * Math.sin(phase)
        strokeZPath(ctx, o.ring, VP)
        ctx.restore()
        const k = Math.floor((e * (o.ring.length - 1) * 3) % o.ring.length)
        drawBullet(ctx, o.ring[k].pos, COLORS.light1, VP, phase)
      }

      // 発射型・敵弾（速度に応じて進む）
      anim.bullets.forEach((b, i) => {
        if (b.samples.length === 0) return
        const tl = timelines[i]
        const { pos, idx } = posAtTime(b.samples, tl.tCum, tl.total, tau)
        const color = b.side === 'ally' ? COLORS.light1 : COLORS.dark1
        const core = b.side === 'ally' ? COLORS.light2 : '#cdbbf2'
        const trail = b.samples.slice(Math.max(0, idx - 9), idx + 1).map((s) => s.pos)
        drawTrail(ctx, trail, color, VP)
        drawBullet(ctx, pos, core, VP, phase)
        // 暴発：弾が終端へ到達したら爆発
        if (b.misfirePos && tau >= tl.total * 0.92) {
          const mp = Math.min(1, (tau - tl.total * 0.92) / Math.max(0.0001, maxTotal - tl.total * 0.92))
          drawMisfire(ctx, b.misfirePos, mp, VP)
        }
      })

      if (e < 1) raf = requestAnimationFrame(frame)
      else finish()
    }
    raf = requestAnimationFrame(frame)
    const timer = setTimeout(finish, realMs + 250)
    return () => {
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.animation,
    props.allies,
    props.enemies,
    props.obstacles,
    props.activeAllyId,
    props.playerPaths,
    props.ghostPaths,
    props.landings,
  ])

  return <canvas ref={ref} width={INTERNAL} height={INTERNAL} aria-label="バトルフィールド" />
}
