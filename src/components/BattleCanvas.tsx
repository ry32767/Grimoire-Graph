import { useEffect, useRef } from 'react'
import type { Ally, Attribute, CarveBurst, Disc, Enemy, Obstacle, Vec2, ZPoint } from '../game/types'
import { FIELD } from '../data/constants'
import type { Viewport } from '../game/coords'
import {
  drawScene,
  drawBullet,
  drawTrail,
  drawParticle,
  drawMisfire,
  drawCarveBurst,
  strokeZPath,
  bulletColorOf,
  type SceneParams,
} from '../render/draw'
import { COLORS } from '../render/theme'

/** リング点の z（属性）から色を選ぶ。 */
function zColor(z: number): string {
  if (z > FIELD.epsilon) return COLORS.light1
  if (z < -FIELD.epsilon) return COLORS.dark1
  return COLORS.light2
}

const INTERNAL = 520
const VP: Viewport = { width: INTERNAL, height: INTERNAL, unitsRadius: FIELD.rField }

/** 弾の1サンプル（位置・速度・弧長・z）。速度で演出のペースを物理に一致させる（#7）。 */
export interface AnimSample {
  pos: Vec2
  speed: number
  arcLen: number
  /** その点の z（属性の高さ）。発射時の色/形に使う（#21） */
  z: number
}

/** 命中した対象（赤フラッシュ＋揺れ・#20）。弾がこの弧長に達した瞬間に対象が反応する。 */
export interface AnimImpact {
  id: string
  side: 'ally' | 'enemy'
  arcLen: number
}

/** アニメーション用の1発（発射型／敵弾） */
export interface AnimBullet {
  samples: AnimSample[]
  side: 'ally' | 'enemy'
  misfirePos: Vec2 | null
  /** この弾が障害物を削った点（弧長つき。到達時に穴を開示しパーティクルを出す・#11） */
  carves: CarveBurst[]
  /** 命中して対象を反応させる情報（#20。外れ/暴発は null） */
  impact: AnimImpact | null
}

/** 削る瞬間のパーティクルが残る弧長の窓（この距離だけ弾が進む間 破片が舞う） */
const BURST_ARC = 9

/** 暴発の大爆発を見せる余韻（弾の到達後にこの時間だけ爆発を展開・#9/#29） */
const MISFIRE_TAIL_MS = 1000

/** 命中の赤フラッシュ＋揺れを見せる余韻（撃破でも演出を見せてから遷移・#20） */
const IMPACT_TAIL_MS = 450

/** 軌道型リング */
export interface AnimOrbit {
  ring: ZPoint[]
  /** 掃射で当てた敵ID群（赤フラッシュ＋揺れ・#20） */
  hitEnemyIds: string[]
}

/** 被弾フラッシュの減衰時間（ms）。一瞬赤く光って揺れて戻る（#20） */
const FLASH_MS = 420

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

/** ゲーム時間 τ における弾の位置・サンプル index・弧長（速度に応じて進む）。 */
function posAtTime(
  samples: AnimSample[],
  tCum: number[],
  total: number,
  tau: number,
): { pos: Vec2; idx: number; arcLen: number } {
  if (samples.length === 0) return { pos: { x: 0, y: 0 }, idx: 0, arcLen: 0 }
  if (tau >= total) {
    const last = samples[samples.length - 1]
    return { pos: last.pos, idx: samples.length - 1, arcLen: last.arcLen }
  }
  let j = 0
  while (j < tCum.length - 1 && tCum[j + 1] <= tau) j++
  const a = samples[j]
  const b = samples[Math.min(j + 1, samples.length - 1)]
  const span = tCum[j + 1] - tCum[j]
  const f = span > 0 ? (tau - tCum[j]) / span : 0
  return {
    pos: { x: a.pos.x + (b.pos.x - a.pos.x) * f, y: a.pos.y + (b.pos.y - a.pos.y) * f },
    idx: j,
    arcLen: a.arcLen + (b.arcLen - a.arcLen) * f,
  }
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
    // 軌道型がある時は周回が見えるよう窓を長めに確保（#24）
    const hasOrbit = anim.orbits.length > 0
    const floorMs = hasOrbit ? 1600 : MIN_MS
    const flightMs = Math.min(MAX_MS, Math.max(floorMs, maxTotal * MS_PER_GAMESEC))
    // 弾の到達後に演出を見せる余韻：暴発は大きく、命中は短く確保する（#9/#29/#20）
    const hasMisfire = anim.bullets.some((b) => b.misfirePos)
    const hasImpact =
      anim.bullets.some((b) => b.impact) || anim.orbits.some((o) => o.hitEnemyIds.length > 0)
    const tailMs = hasMisfire ? MISFIRE_TAIL_MS : hasImpact ? IMPACT_TAIL_MS : 0
    const realMs = flightMs + tailMs

    // 被弾フラッシュ：対象IDごとに「反応を開始した実時刻」を記録し、以後減衰させる（#20）
    const flashStartByTarget: Record<string, number> = {}

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
      const elapsed = now - start
      // 飛行は flightMs で進み切る。余韻（暴発）中は弾は終端で静止する。
      const e = Math.min(1, elapsed / flightMs)
      const tau = e * maxTotal
      const phase = e * flightMs * 0.02

      // 各弾の現在位置・弧長を先に計算（穴の開示・削るパーティクルに使う）
      const states = anim.bullets.map((b, i) =>
        b.samples.length ? posAtTime(b.samples, timelines[i].tCum, timelines[i].total, tau) : null,
      )

      // 障害物の穴を進行に応じて開示：弾が到達した（弧長を越えた）carve だけ反映する
      const revealed: Record<string, Disc[]> = {}
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st) return
        for (const cv of b.carves) {
          if (cv.arcLen > st.arcLen) continue
          if (!revealed[cv.obstacleId]) revealed[cv.obstacleId] = []
          revealed[cv.obstacleId].push({ x: cv.pos.x, y: cv.pos.y, r: cv.r })
        }
      })
      const obstacles = props.obstacles.map((o) =>
        revealed[o.id] ? { ...o, carves: [...o.carves, ...revealed[o.id]] } : o,
      )

      // 被弾の検出：弾が命中弧長に達したら対象の反応を開始（#20）
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st || !b.impact) return
        if (st.arcLen >= b.impact.arcLen && flashStartByTarget[b.impact.id] === undefined) {
          flashStartByTarget[b.impact.id] = elapsed
        }
      })
      // 軌道型の掃射ヒットは周回が一巡した中盤で反応
      if (e >= 0.55) {
        for (const o of anim.orbits) {
          for (const id of o.hitEnemyIds) {
            if (flashStartByTarget[id] === undefined) flashStartByTarget[id] = elapsed
          }
        }
      }
      // 各対象の現在のフラッシュ強度（1→0へ減衰）
      const flash: Record<string, number> = {}
      for (const id in flashStartByTarget) {
        const t = (elapsed - flashStartByTarget[id]) / FLASH_MS
        if (t >= 0 && t < 1) flash[id] = 1 - t
      }

      drawScene(ctx, {
        ...staticParams,
        obstacles,
        playerPaths: undefined,
        landings: undefined,
        flash,
        shakePhase: elapsed * 0.05,
      })

      // 軌道型リング：パーティクルがぐるぐる周回する（#24）
      for (const o of anim.orbits) {
        const ring = o.ring
        const len = ring.length
        if (len < 2) continue
        // 薄いリング本体
        ctx.save()
        ctx.globalAlpha = 0.28
        strokeZPath(ctx, ring, VP)
        ctx.restore()
        // 複数パーティクルを等間隔に並べ、複数周ぐるぐる回す
        const N = 18
        const revs = 2.6
        for (let n = 0; n < N; n++) {
          const frac = (n / N + e * revs) % 1
          const idx = Math.min(len - 1, Math.floor(frac * (len - 1)))
          const pt = ring[idx]
          const col = zColor(pt.z)
          // 短い尾
          const trail: Vec2[] = []
          for (let t = 4; t >= 0; t--) trail.push(ring[(idx - t * 2 + len) % len].pos)
          ctx.globalAlpha = 0.5
          drawTrail(ctx, trail, col, VP)
          ctx.globalAlpha = 1
          drawParticle(ctx, pt.pos, col, VP, phase + n)
        }
      }

      // 発射型・敵弾（速度に応じて進む）
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st) return
        const tl = timelines[i]
        const { pos, idx } = st
        // 発射されたら z 場の値で色/形が決まる（#21）。属性で色、強度で大きさ・棘。
        const z = b.samples[idx]?.z ?? 0
        const color = bulletColorOf(z)
        // 暴発：弾が終端へ到達してから余韻いっぱいまで爆発を進める（実時間ベース）
        const arrivalMs = maxTotal > 0 ? (tl.total / maxTotal) * flightMs : 0
        const exploding = b.misfirePos && elapsed >= arrivalMs
        if (!exploding) {
          const trail = b.samples.slice(Math.max(0, idx - 9), idx + 1).map((s) => s.pos)
          drawTrail(ctx, trail, color, VP)
          drawBullet(ctx, pos, z, VP, phase)
        }
        if (b.misfirePos && exploding) {
          const mp = Math.min(1, (elapsed - arrivalMs) / Math.max(1, realMs - arrivalMs))
          drawMisfire(ctx, b.misfirePos, mp, VP)
        }
      })

      // 障害物を削る瞬間のパーティクル（弾が通り過ぎた直後だけ破片が舞う・#11）
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st) return
        for (const cv of b.carves) {
          const d = st.arcLen - cv.arcLen
          if (d >= 0 && d < BURST_ARC) drawCarveBurst(ctx, cv.pos, cv.r, cv.attr, d / BURST_ARC, VP)
        }
      })

      if (elapsed < realMs) raf = requestAnimationFrame(frame)
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
