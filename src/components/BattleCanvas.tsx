import { useEffect, useRef } from 'react'
import type { Enemy, Field, Obstacle, Shield, Vec2, Attribute } from '../game/types'
import { FIELD } from '../data/constants'
import type { Viewport } from '../game/coords'
import { drawScene, drawBullet, drawMisfire, type SceneParams } from '../render/draw'
import { COLORS } from '../render/theme'

const INTERNAL = 480
const VP: Viewport = { width: INTERNAL, height: INTERNAL, unitsRadius: FIELD.rField }

/** 解決アニメーションの指定 */
export interface ResolveAnimation {
  playerPath: Vec2[] | null
  enemyPaths: Vec2[][]
  misfirePos: Vec2 | null
}

interface Props {
  field: Field
  enemies: Enemy[]
  obstacles: Obstacle[]
  shield: Shield | null
  playerPath?: Vec2[] | null
  ghostPaths?: Vec2[][]
  landing?: { pos: Vec2; attr: Attribute } | null
  animation?: ResolveAnimation | null
  onAnimationDone?: () => void
}

const ANIM_MS = 1100

export default function BattleCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const doneRef = useRef(props.onAnimationDone)
  doneRef.current = props.onAnimationDone

  const staticParams: SceneParams = {
    vp: VP,
    field: props.field,
    enemies: props.enemies,
    obstacles: props.obstacles,
    shield: props.shield,
    playerPath: props.playerPath,
    ghostPaths: props.ghostPaths,
    landing: props.landing,
  }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 静的シーン（作成フェーズ）
    if (!props.animation) {
      drawScene(ctx, staticParams)
      return
    }

    // 解決アニメーション
    const anim = props.animation
    let raf = 0
    let finished = false
    const start = performance.now()
    const sampleAt = (path: Vec2[], t: number): Vec2 | null => {
      if (path.length === 0) return null
      const idx = Math.min(path.length - 1, Math.floor(t * (path.length - 1)))
      return path[idx]
    }
    const finish = () => {
      if (finished) return
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      doneRef.current?.()
    }
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ANIM_MS)
      drawScene(ctx, { ...staticParams, landing: null })
      if (anim.playerPath) {
        const p = sampleAt(anim.playerPath, t)
        if (p) drawBullet(ctx, p, COLORS.light2, VP)
      }
      for (const path of anim.enemyPaths) {
        const p = sampleAt(path, t)
        if (p) drawBullet(ctx, p, COLORS.dark1, VP)
      }
      if (anim.misfirePos && t > 0.7) {
        drawMisfire(ctx, anim.misfirePos, (t - 0.7) / 0.3, VP)
      }
      if (t < 1) raf = requestAnimationFrame(frame)
      else finish()
    }
    raf = requestAnimationFrame(frame)
    // rAF が止まる環境（非表示タブ等）でも必ず解決を進めるフォールバック
    const timer = setTimeout(finish, ANIM_MS + 150)
    return () => {
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.animation,
    props.field,
    props.enemies,
    props.obstacles,
    props.shield,
    props.playerPath,
    props.ghostPaths,
    props.landing,
  ])

  return <canvas ref={ref} width={INTERNAL} height={INTERNAL} aria-label="バトルフィールド" />
}
