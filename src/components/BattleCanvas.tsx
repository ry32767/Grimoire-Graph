import { useEffect, useRef } from 'react'
import type { Ally, Attribute, CarveBurst, Disc, Enemy, Obstacle, Vec2, ZPoint } from '../game/types'
import { FIELD } from '../data/constants'
import type { Viewport } from '../game/coords'
import {
  drawScene,
  drawBullet,
  drawTrail,
  drawWaveTrail,
  drawParticle,
  drawMisfire,
  drawCarveBurst,
  drawClashSpark,
  drawOrbitDissipation,
  strokeZPath,
  powerSizeFrac,
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
  /** 周回が壁に触れて散った点（#34） */
  carves: CarveBurst[]
  /** 壁に当たって霧散したか（#34）。true なら周回せず、一度きり外へ散って消える */
  broken?: boolean
  /** リングの代表速度（#21：威力＝速度×強度で粒の大きさを変える） */
  speed?: number
}

/** 被弾フラッシュの減衰時間（ms）。一瞬赤く光って揺れて戻る（#20） */
const FLASH_MS = 420

/** パリィ／結界の衝突火花の持続（ms）と、弾がその点に到達したと見なす距離（数学ユニット・#20） */
const CLASH_MS = 460
const CLASH_DIST = 1.6

/** 周回が壁/魔法に負けて霧散する演出の持続（ms・#34）。接触の瞬間から散り始める */
const DISSIPATE_MS = 520

export interface ResolveAnimation {
  bullets: AnimBullet[]
  orbits: AnimOrbit[]
  /** 弾・結界の衝突点（#20：パリィ/迎撃の火花） */
  clashes?: Vec2[]
}

interface Props {
  allies: Ally[]
  enemies: Enemy[]
  obstacles: Obstacle[]
  activeAllyId?: string | null
  playerPaths?: (ZPoint[] | null)[]
  ghostPaths?: Vec2[][]
  landings?: ({ pos: Vec2; attr: Attribute } | null)[]
  /** 前ターンの魔法軌跡（#11） */
  pastTrails?: ZPoint[][]
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
    pastTrails: props.pastTrails,
  }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (!props.animation) {
      // 作成フェーズ：前ターンの軌跡があれば波＋粒を揺らし続ける（#11）。無ければ1回だけ描画。
      if (!props.pastTrails || props.pastTrails.length === 0) {
        drawScene(ctx, staticParams)
        return
      }
      let raf = 0
      const start = performance.now()
      const loop = (now: number) => {
        drawScene(ctx, { ...staticParams, trailPhase: (now - start) * 0.004 })
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(raf)
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
    const hasClash = !!anim.clashes && anim.clashes.length > 0
    const hasBrokenOrbit = anim.orbits.some((o) => o.broken)
    const tailMs = hasMisfire
      ? MISFIRE_TAIL_MS
      : hasBrokenOrbit
        ? Math.max(IMPACT_TAIL_MS, DISSIPATE_MS + 150)
        : hasImpact || hasClash
          ? IMPACT_TAIL_MS
          : 0
    const realMs = flightMs + tailMs

    // 被弾フラッシュ：対象IDごとに「反応を開始した実時刻」を記録し、以後減衰させる（#20）
    const flashStartByTarget: Record<string, number> = {}
    // 衝突火花：clash ごとに「弾がその点へ到達した実時刻」を記録し、その瞬間から弾けさせる（#20）
    const clashStartByIdx: Record<number, number> = {}
    // 霧散：負けた周回ごとに「接触の実時刻」を記録し、その瞬間から散らせる（#34）
    const dissipateStartByIdx: Record<number, number> = {}

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
      // 軌跡の波・粒は実時間でゆっくり流す（作成フェーズと同じ流速。速いとチカチカするため・#11）
      const trailPhase = elapsed * 0.004

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

      // 軌道型リング：ゆっくり周回（#24）。壁/魔法に負けた周回は接触の瞬間から霧散（#34）
      for (let oi = 0; oi < anim.orbits.length; oi++) {
        const o = anim.orbits[oi]
        const ring = o.ring
        const len = ring.length
        if (len < 2) continue

        // 霧散する周回：弾が接触点へ到達した瞬間（接触弾が無ければ既定時刻）から散り始める
        if (o.broken) {
          if (dissipateStartByIdx[oi] === undefined) {
            const cp = o.carves[0]?.pos
            let trig = false
            if (cp) {
              for (const st of states) {
                if (st && Math.hypot(st.pos.x - cp.x, st.pos.y - cp.y) <= CLASH_DIST) {
                  trig = true
                  break
                }
              }
            }
            if (!trig && e >= 0.4) trig = true // 接触弾が無い（壁等）ときの保険
            if (trig) dissipateStartByIdx[oi] = elapsed
          }
          const dStart = dissipateStartByIdx[oi]
          if (dStart !== undefined) {
            // 接触後：周回せず、一度きり外へ散って消える
            const dp = Math.min(0.999, (elapsed - dStart) / DISSIPATE_MS)
            drawOrbitDissipation(ctx, ring, dp, VP)
            for (const cv of o.carves) {
              if (dp < 0.6) drawCarveBurst(ctx, cv.pos, cv.r + 1.2, cv.attr, dp / 0.6, VP)
            }
            continue
          }
          // 接触前：通常どおり周回して見せる（弾の到達を待つ）→ 下の通常描画へ
        }

        // 通常の周回（存続中／霧散前）
        ctx.save()
        ctx.globalAlpha = 0.28
        strokeZPath(ctx, ring, VP)
        ctx.restore()
        // 複数パーティクルを等間隔に並べ、ゆっくり周回する（速いとチカチカするため・#11）
        const N = 18
        const revs = 1.1
        const eClamped = Number.isFinite(e) ? Math.max(0, Math.min(1, e)) : 0
        for (let n = 0; n < N; n++) {
          const frac = (n / N + eClamped * revs) % 1
          // idx は必ず 0..len-1 に収める（NaN/範囲外でも安全・凍結防止）
          let idx = Math.floor(frac * (len - 1))
          if (!Number.isFinite(idx)) idx = 0
          idx = Math.max(0, Math.min(len - 1, idx))
          const pt = ring[idx]
          if (!pt) continue
          const col = zColor(pt.z)
          // 短い尾
          const trail: Vec2[] = []
          for (let t = 4; t >= 0; t--) {
            const tp = ring[(idx - t * 2 + len) % len]
            if (tp) trail.push(tp.pos)
          }
          ctx.globalAlpha = 0.5
          drawTrail(ctx, trail, col, VP)
          ctx.globalAlpha = 1
          // 威力（=リング速度×その点の強度）で粒の大きさを変える（#21）
          const sizeScale = powerSizeFrac(o.speed ?? 0, pt.z)
          drawParticle(ctx, pt.pos, col, VP, trailPhase * 2 + n, sizeScale)
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
        // 暴発：弾が終端へ到達してから余韻いっぱいまで爆発を進める（実時間ベース）
        const arrivalMs = maxTotal > 0 ? (tl.total / maxTotal) * flightMs : 0
        const exploding = b.misfirePos && elapsed >= arrivalMs
        if (!exploding) {
          // 飛んだぶんの軌跡を逆位相の波＋揺れる粒で描く（発射アニメ中も表示・#11）
          const traveled: ZPoint[] = b.samples
            .slice(0, idx + 1)
            .map((s) => ({ pos: s.pos, z: s.z }))
          drawWaveTrail(ctx, traveled, VP, trailPhase, 0.95)
          drawBullet(ctx, pos, z, VP, phase, b.samples[idx]?.speed ?? 0)
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

      // パリィ／結界の衝突火花（#20）：弾がその交差点へ到達した瞬間に弾ける（位置・時刻を弾に合わせる）
      if (anim.clashes && anim.clashes.length > 0) {
        anim.clashes.forEach((pos, ci) => {
          if (clashStartByIdx[ci] === undefined) {
            for (const st of states) {
              if (st && Math.hypot(st.pos.x - pos.x, st.pos.y - pos.y) <= CLASH_DIST) {
                clashStartByIdx[ci] = elapsed
                break
              }
            }
          }
          const start0 = clashStartByIdx[ci]
          if (start0 === undefined) return
          const cp = (elapsed - start0) / CLASH_MS
          if (cp >= 0 && cp < 1) drawClashSpark(ctx, pos, cp, VP)
        })
      }

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
    props.pastTrails,
  ])

  return <canvas ref={ref} width={INTERNAL} height={INTERNAL} aria-label="バトルフィールド" />
}
