import { useEffect, useRef } from 'react'
import type { Ally, Attribute, Enemy, Obstacle, Vec2, ZPoint } from '../game/types'
import { FIELD } from '../data/constants'
import type { Viewport } from '../game/coords'
import { drawScene, drawBullet, drawTrail, drawMisfire, strokeZPath, type SceneParams } from '../render/draw'
import { COLORS } from '../render/theme'

const INTERNAL = 520
const VP: Viewport = { width: INTERNAL, height: INTERNAL, unitsRadius: FIELD.rField }

/** アニメーション用の1発（発射型=飛ぶ弾／軌道型=リング）。 */
export interface AnimShot {
  kind: 'projectile' | 'orbit'
  path: Vec2[]
  ring?: ZPoint[] | null
  misfirePos: Vec2 | null
}

/** 解決アニメーションの指定 */
export interface ResolveAnimation {
  allyShots: AnimShot[]
  enemyPaths: Vec2[][]
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

const ANIM_MS = 1200

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

    // 静的シーン（作成フェーズ）
    if (!props.animation) {
      drawScene(ctx, staticParams)
      return
    }

    const anim = props.animation
    let raf = 0
    let finished = false
    const start = performance.now()
    const idxAt = (path: Vec2[], t: number) =>
      Math.min(path.length - 1, Math.floor(t * (path.length - 1)))
    const sampleAt = (path: Vec2[], t: number): Vec2 | null =>
      path.length === 0 ? null : path[idxAt(path, t)]
    const trailAt = (path: Vec2[], t: number, n = 8): Vec2[] =>
      path.length === 0 ? [] : path.slice(Math.max(0, idxAt(path, t) - n), idxAt(path, t) + 1)
    const finish = () => {
      if (finished) return
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      doneRef.current?.()
    }
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ANIM_MS)
      const phase = t * 26
      drawScene(ctx, { ...staticParams, playerPaths: undefined, landings: undefined })

      // 味方の発射
      for (const sh of anim.allyShots) {
        if (sh.kind === 'orbit' && sh.ring && sh.ring.length > 1) {
          // 周回リングを脈動表示
          ctx.save()
          ctx.globalAlpha = 0.5 + 0.4 * Math.sin(phase)
          strokeZPath(ctx, sh.ring, VP)
          ctx.restore()
          // 周回する光点
          const p = sampleAt(sh.ring.map((r) => r.pos), t)
          if (p) drawBullet(ctx, p, COLORS.light1, VP, phase)
        } else if (sh.kind === 'projectile') {
          drawTrail(ctx, trailAt(sh.path, t), COLORS.light1, VP)
          const p = sampleAt(sh.path, t)
          if (p) drawBullet(ctx, p, COLORS.light2, VP, phase)
        }
        if (sh.misfirePos && t > 0.66) drawMisfire(ctx, sh.misfirePos, (t - 0.66) / 0.34, VP)
      }
      // 敵弾
      for (const path of anim.enemyPaths) {
        drawTrail(ctx, trailAt(path, t), COLORS.dark1, VP)
        const p = sampleAt(path, t)
        if (p) drawBullet(ctx, p, COLORS.dark1, VP, phase)
      }

      if (t < 1) raf = requestAnimationFrame(frame)
      else finish()
    }
    raf = requestAnimationFrame(frame)
    // rAF が止まる環境（非表示タブ等）でも必ず解決を進めるフォールバック
    const timer = setTimeout(finish, ANIM_MS + 200)
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
