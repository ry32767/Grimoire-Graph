import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Ally, CarveBurst, DamagePopup, Disc, Enemy, Obstacle, Vec2, ZPoint } from '../game/types'
import { FIELD } from '../data/constants'
import { toScreen, toMath, type Viewport } from '../game/coords'
import {
  drawScene,
  drawBullet,
  drawTrail,
  drawWaveTrail,
  drawParticle,
  drawMisfire,
  drawFallingDebris,
  drawDamageNumber,
  drawCarveBurst,
  drawClashSpark,
  drawOrbitDissipation,
  drawBulletDissipation,
  drawConcealVeil,
  strokeZPath,
  powerSizeFrac,
  type SceneParams,
} from '../render/draw'
import { ringAverageAttr } from '../game/orbit'
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
  /** 速度0で霧散したか（#38：終端で小さくなって散る演出。命中/暴発時は出さない） */
  vanished?: boolean
}

/** 壁を削った破片が散って消えるまでの時間（ms・#45）。弾が壁で止まっても必ずこの時間で消える */
const CARVE_BURST_MS = 480

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
  /** 弾・結界の衝突点と威力（#20/#38：パリィ/迎撃の火花。power で大きさが変わる） */
  clashes?: { pos: Vec2; power: number }[]
  /** ダメージ／回復の数値表示（#42） */
  popups?: DamagePopup[]
}

/** 数値ポップの色（属性色／暴発=白／回復=緑・#42）。 */
function popupColor(kind: DamagePopup['kind']): string {
  if (kind === 'heal') return '#5ad16a'
  if (kind === 'misfire') return '#ffffff'
  if (kind === 'light') return COLORS.light1
  if (kind === 'dark') return '#b483ff'
  return '#e2e2f0' // 中立
}

/** 数値ポップの表示時間（ms・#42）。 */
const POPUP_MS = 950

/** 持続中の周回結界（#39：作成フェーズでも常時表示し、闇は内側を暗くぼかす）。 */
export interface StandingOrbit {
  ring: ZPoint[]
  speed: number
}

interface Props {
  allies: Ally[]
  enemies: Enemy[]
  obstacles: Obstacle[]
  activeAllyId?: string | null
  playerPaths?: (ZPoint[] | null)[]
  /** 各味方の暴発（関数エラー）点。プレビューで赤い✕として可視化する（#30） */
  misfirePoints?: (Vec2 | null)[]
  ghostPaths?: Vec2[][]
  /** 編集中の z 場（#37）。showZField が真の間（作成フェーズは常時・#55）薄い場として表示する */
  zField?: (x: number, y: number) => number
  /** z 場を薄く表示するか（#37）。作成フェーズ中は常に true（#55） */
  showZField?: boolean
  /** 持続中の周回結界（#39）。作成フェーズで常時描画＋闇は視認性低下の幕をかける */
  standingOrbits?: StandingOrbit[]
  animation?: ResolveAnimation | null
  onAnimationDone?: () => void
  /** 通過点フィットで選んだ点（#46）。作成フェーズで✛として表示する */
  fitPoints?: Vec2[]
  /** フィールドをクリックした時の数学座標を返す（#46：点ピック中だけ渡す） */
  onFieldClick?: (mathPos: Vec2) => void
  /** フィールドをクリック／ドラッグして発射方向を決める（#47：点ピック中でない時だけ渡す） */
  onAim?: (mathPos: Vec2) => void
  /** 発射方向インジケータ用の角度（#47・回転のみ）。active ally から伸ばす矢印を描く */
  aimAngle?: number
  /** 通過点ピック中か（#49）。true の間はドラッグでルーペを出し、離した位置を点にする */
  pickMode?: boolean
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

/**
 * リング各点までの累積「通過時間」(Σ ds/speed) と総時間（#60）。
 * 速度が速い区間ほど通過時間が短い＝粒がそこを素早く抜ける（点ごとの速度を演出に反映）。
 * 速度が未付与/一定なら従来どおり等速で回る。
 */
function ringTimeline(ring: ZPoint[]): { cum: number[]; total: number } {
  const cum = [0]
  for (let i = 1; i < ring.length; i++) {
    const ds = Math.hypot(ring[i].pos.x - ring[i - 1].pos.x, ring[i].pos.y - ring[i - 1].pos.y)
    const v = Math.max(0.2, ((ring[i].speed ?? 0) + (ring[i - 1].speed ?? 0)) / 2)
    cum.push(cum[i - 1] + ds / v)
  }
  return { cum, total: cum[cum.length - 1] || 1 }
}

/** phase∈[0,1) を累積時間で index へ写す（速い区間は素早く通過・#60）。 */
function phaseToIndex(tl: { cum: number[]; total: number }, phase: number): number {
  const target = (((phase % 1) + 1) % 1) * tl.total
  for (let i = 1; i < tl.cum.length; i++) if (tl.cum[i] >= target) return i - 1
  return tl.cum.length - 1
}

/** 粒の大きさに使う速度：その点の速度（#60）。無ければリング代表速度にフォールバック。 */
function ptSpeed(pt: ZPoint, fallback: number): number {
  return pt.speed ?? fallback
}

/** 持続中の周回（#39）：薄いリング＋ゆっくり周回する粒で常時表示する。 */
function drawStandingOrbit(ctx: CanvasRenderingContext2D, o: StandingOrbit, trailPhase: number): void {
  const ring = o.ring
  const len = ring.length
  if (len < 2) return
  ctx.save()
  ctx.globalAlpha = 0.26
  strokeZPath(ctx, ring, VP)
  ctx.restore()
  const tl = ringTimeline(ring) // #60：点ごとの速度で粒の進みを変える
  const N = 16
  for (let n = 0; n < N; n++) {
    const idx = phaseToIndex(tl, n / N + trailPhase * 0.03)
    const pt = ring[idx]
    if (!pt) continue
    drawParticle(ctx, pt.pos, zColor(pt.z), VP, trailPhase * 2 + n, powerSizeFrac(ptSpeed(pt, o.speed), pt.z))
  }
}

export default function BattleCanvas(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const aimingRef = useRef(false)
  // #49：点ピックのルーペ。現在の指位置（数学座標）と、作成フェーズの再描画関数
  const pickPosRef = useRef<Vec2 | null>(null)
  const composeDrawRef = useRef<(() => void) | null>(null)
  const lastTrailRef = useRef(0)
  const doneRef = useRef(props.onAnimationDone)
  doneRef.current = props.onAnimationDone

  const staticParams: SceneParams = {
    vp: VP,
    allies: props.allies,
    enemies: props.enemies,
    obstacles: props.obstacles,
    activeAllyId: props.activeAllyId,
    playerPaths: props.playerPaths,
    misfirePoints: props.misfirePoints,
    ghostPaths: props.ghostPaths,
    zField: props.zField,
    showZField: props.showZField,
  }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (!props.animation) {
      // 作成フェーズ：持続周回があれば粒を回し続ける（#39）。無ければ1回だけ描画（z場プレビュー含む・#37）。
      const standing = props.standingOrbits ?? []
      const drawComposeFrame = (trailPhase: number) => {
        lastTrailRef.current = trailPhase
        drawScene(ctx, { ...staticParams, trailPhase })
        for (const o of standing) drawStandingOrbit(ctx, o, trailPhase)
        // 闇の周回は内側を暗くぼかす（プレイヤー視点の視認性低下・#39）
        for (const o of standing) if (ringAverageAttr(o.ring) === 'dark') drawConcealVeil(ctx, o.ring, VP)
        // 発射方向インジケータ（#47）：active ally から θ 方向へ矢印
        if (props.aimAngle !== undefined && props.activeAllyId) {
          const a = props.allies.find((al) => al.id === props.activeAllyId)
          if (a && a.hp > 0) drawAimArrow(ctx, a.pos, props.aimAngle)
        }
        // 通過点フィットの選択点を✛で表示（#46）
        drawFitPoints(ctx, props.fitPoints)
        // 点ピック中は指の上に拡大鏡（ルーペ）を出す（#49：指で点が隠れない）
        if (pickPosRef.current) drawPickLoupe(ctx, pickPosRef.current)
      }
      // ポインタ移動時に手動で再描画できるよう関数を保持
      composeDrawRef.current = () => drawComposeFrame(lastTrailRef.current)
      if (standing.length === 0) {
        drawComposeFrame(0)
        return () => {
          composeDrawRef.current = null
        }
      }
      let raf = 0
      const start = performance.now()
      const loop = (now: number) => {
        drawComposeFrame((now - start) * 0.004)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)
      return () => {
        composeDrawRef.current = null
        cancelAnimationFrame(raf)
      }
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
    // 発射魔法の霧散（速度0・命中も暴発もしていない弾）にも余韻を確保する（#38）
    const hasVanish = anim.bullets.some((b) => b.vanished && !b.impact && !b.misfirePos)
    const baseTail = hasMisfire
      ? MISFIRE_TAIL_MS
      : hasBrokenOrbit || hasVanish
        ? Math.max(IMPACT_TAIL_MS, DISSIPATE_MS + 150)
        : hasImpact || hasClash
          ? IMPACT_TAIL_MS
          : 0
    // ダメージ／回復の数値を最後まで見せる余韻を確保する（#42）
    const hasPopups = (anim.popups?.length ?? 0) > 0
    const tailMs = hasPopups ? Math.max(baseTail, POPUP_MS + 300) : baseTail
    const realMs = flightMs + tailMs

    // 被弾フラッシュ：対象IDごとに「反応を開始した実時刻」を記録し、以後減衰させる（#20）
    const flashStartByTarget: Record<string, number> = {}
    // 衝突火花：clash ごとに「弾がその点へ到達した実時刻」を記録し、その瞬間から弾けさせる（#20）
    const clashStartByIdx: Record<number, number> = {}
    // 霧散：負けた周回ごとに「接触の実時刻」を記録し、その瞬間から散らせる（#34）
    const dissipateStartByIdx: Record<number, number> = {}
    // 壁を削った破片：carve ごとに「弾が到達した実時刻」を記録し、一定時間で散って消す（#45）。
    // 弧長だけで判定すると弾が壁で止まった地点に破片が永久に残る不具合があった。
    const carveStartByKey: Record<string, number> = {}

    // ダメージ／回復の数値（#42）：同じ対象・契機のポップは縦に積む（重なり防止）
    const popups = anim.popups ?? []
    const popupOrd: number[] = []
    const ordCount: Record<string, number> = {}
    for (const p of popups) {
      const k = `${p.targetId}|${p.trigger}`
      const o = ordCount[k] ?? 0
      ordCount[k] = o + 1
      popupOrd.push(o)
    }
    // 暴発の爆発開始時刻（misfire ポップの基準）
    let misfireArrivalMs = Infinity
    anim.bullets.forEach((b, i) => {
      if (!b.misfirePos) return
      const arr = maxTotal > 0 ? (timelines[i].total / maxTotal) * flightMs : 0
      misfireArrivalMs = Math.min(misfireArrivalMs, arr)
    })

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

      // 暴発のステージ全体演出（#41）：揺れの強さ（爆発直後が最強→減衰）と破片の落下進行
      let mfShake = 0
      let mfProgress = 0
      anim.bullets.forEach((b, i) => {
        if (!b.misfirePos) return
        const tl = timelines[i]
        const arrivalMs = maxTotal > 0 ? (tl.total / maxTotal) * flightMs : 0
        if (elapsed < arrivalMs) return
        const mp = Math.min(1, (elapsed - arrivalMs) / Math.max(1, realMs - arrivalMs))
        if (mp > mfProgress) mfProgress = mp
        const sh = Math.max(0, 1 - mp * 1.6) // 直後が最強
        if (sh > mfShake) mfShake = sh
      })
      // ステージ全体をガタガタ揺らす（ズレで端に隙間が出ないよう、先に背景で塗りつぶす）
      const gAmp = mfShake * 9
      const gx = mfShake > 0 ? Math.sin(elapsed * 0.07) * gAmp : 0
      const gy = mfShake > 0 ? Math.cos(elapsed * 0.085) * gAmp : 0
      if (mfShake > 0) {
        ctx.fillStyle = COLORS.bg
        ctx.fillRect(0, 0, INTERNAL, INTERNAL)
      }
      ctx.save()
      ctx.translate(gx, gy)

      drawScene(ctx, {
        ...staticParams,
        obstacles,
        playerPaths: undefined,
        misfirePoints: undefined,
        showZField: false,
        flash,
        shakePhase: elapsed * 0.05,
      })

      // 闇の周回は内側を暗くぼかす（#39：プレイヤー視点の視認性低下）。霧散した周回は幕を外す
      for (const o of anim.orbits) {
        if (!o.broken && ringAverageAttr(o.ring) === 'dark') drawConcealVeil(ctx, o.ring, VP)
      }

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
        // 複数パーティクルを並べて周回する。点ごとの速度で進みを変える（#60：速い区間は素早く抜ける）
        const N = 18
        const revs = 1.1
        const eClamped = Number.isFinite(e) ? Math.max(0, Math.min(1, e)) : 0
        const tl = ringTimeline(ring)
        for (let n = 0; n < N; n++) {
          const idx = phaseToIndex(tl, n / N + eClamped * revs)
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
          // 威力（=その点のリング速度×強度）で粒の大きさを変える（#21/#60）
          const sizeScale = powerSizeFrac(ptSpeed(pt, o.speed ?? 0), pt.z)
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
        // 霧散：命中も暴発もしていない弾が終端（速度0）に達したら、小さくなって散る（#38）
        const vanishing = b.vanished && !b.impact && !b.misfirePos && elapsed >= arrivalMs
        if (!exploding && !vanishing) {
          // 飛んだぶんの軌跡を逆位相の波＋揺れる粒で描く（発射アニメ中も表示・#11）
          const traveled: ZPoint[] = b.samples
            .slice(0, idx + 1)
            .map((s) => ({ pos: s.pos, z: s.z }))
          drawWaveTrail(ctx, traveled, VP, trailPhase, 0.95)
          drawBullet(ctx, pos, z, VP, phase, b.samples[idx]?.speed ?? 0)
        }
        if (vanishing) {
          const last = b.samples[b.samples.length - 1]
          const traveled: ZPoint[] = b.samples.map((s) => ({ pos: s.pos, z: s.z }))
          drawWaveTrail(ctx, traveled, VP, trailPhase, 0.6)
          const dp = Math.min(0.999, (elapsed - arrivalMs) / DISSIPATE_MS)
          const sizeFrac = Math.max(0.35, powerSizeFrac(0, last?.z ?? 0) || Math.min(1, Math.abs(last?.z ?? 0) / FIELD.sMax))
          drawBulletDissipation(ctx, last?.pos ?? pos, last?.z ?? 0, dp, VP, sizeFrac)
        }
        if (b.misfirePos && exploding) {
          const mp = Math.min(1, (elapsed - arrivalMs) / Math.max(1, realMs - arrivalMs))
          drawMisfire(ctx, b.misfirePos, mp, VP)
        }
      })

      // 障害物を削る瞬間のパーティクル（弾が到達した瞬間から一定時間だけ破片が舞い、必ず消える・#11/#45）。
      // 弧長差で判定すると弾が壁で停止した地点に破片が残り続けるため、到達時刻から実時間で散らす。
      anim.bullets.forEach((b, i) => {
        const st = states[i]
        if (!st) return
        for (let j = 0; j < b.carves.length; j++) {
          const cv = b.carves[j]
          if (st.arcLen < cv.arcLen) continue // まだ弾が届いていない
          const key = `${i}-${j}`
          if (carveStartByKey[key] === undefined) carveStartByKey[key] = elapsed
          const cp = (elapsed - carveStartByKey[key]) / CARVE_BURST_MS
          if (cp >= 0 && cp < 1) drawCarveBurst(ctx, cv.pos, cv.r, cv.attr, cp, VP)
        }
      })

      // パリィ／結界の衝突火花（#20/#38）：弾がその交差点へ到達した瞬間に青い火花が弾ける。
      // 大きさは威力（パリィは2魔法の威力合計）に依存する。
      if (anim.clashes && anim.clashes.length > 0) {
        anim.clashes.forEach((clash, ci) => {
          const pos = clash.pos
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
          const sizeFrac = Math.min(1, clash.power / (FIELD.sMax * FIELD.maxFlightSpeed))
          if (cp >= 0 && cp < 1) drawClashSpark(ctx, pos, cp, VP, sizeFrac)
        })
      }

      // 暴発：上空から遺跡の破片が降ってくる（ステージ全体・揺れの中で・#41）
      if (mfProgress > 0 && mfProgress < 1) drawFallingDebris(ctx, VP, mfProgress)

      ctx.restore() // ステージ全体シェイクの translate を戻す

      // ダメージ／回復の数値（揺れの外＝読みやすい UI として安定表示・#42）
      for (let i = 0; i < popups.length; i++) {
        const p = popups[i]
        let start: number | undefined
        if (p.trigger === 'flash') start = flashStartByTarget[p.targetId]
        else if (p.trigger === 'misfire') start = Number.isFinite(misfireArrivalMs) ? misfireArrivalMs : undefined
        else start = flightMs * 0.5 // 回復は固定タイミング
        if (start === undefined) continue
        start += popupOrd[i] * 110 // 積み重ねは少し遅らせて出す
        const t = (elapsed - start) / POPUP_MS
        if (t < 0 || t >= 1) continue
        const sp = toScreen(p.pos, VP)
        const rise = t * 40 + popupOrd[i] * 6 // 上へ昇る
        const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85 // フェードイン→アウト
        const size = Math.min(40, 14 + p.amount * 0.22) // 大きさは量に依存
        const text = p.kind === 'heal' ? `+${Math.round(p.amount)}` : `${Math.round(p.amount)}`
        drawDamageNumber(ctx, sp.x, sp.y - 16 - rise, text, popupColor(p.kind), size, Math.max(0, alpha))
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
    props.misfirePoints,
    props.ghostPaths,
    props.zField,
    props.showZField,
    props.standingOrbits,
    props.fitPoints,
    props.aimAngle,
  ])

  // ポインタ位置を数学座標へ変換（内部解像度と表示サイズの差を補正）
  const eventToMath = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const canvas = ref.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const px = ((e.clientX - rect.left) * INTERNAL) / rect.width
    const py = ((e.clientY - rect.top) * INTERNAL) / rect.height
    return toMath({ x: px, y: py }, VP)
  }
  const redrawCompose = () => composeDrawRef.current?.()

  // ポインタ操作：点ピック中はルーペ（#49）、それ以外は発射方向ドラッグ（#47）
  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const m = eventToMath(e)
    if (!m) return
    try {
      ref.current?.setPointerCapture(e.pointerId)
    } catch {
      /* 非対応は無視 */
    }
    if (props.pickMode) {
      pickPosRef.current = m
      redrawCompose()
    } else if (props.onAim) {
      aimingRef.current = true
      props.onAim(m)
    }
  }
  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const m = eventToMath(e)
    if (!m) return
    if (props.pickMode && pickPosRef.current) {
      pickPosRef.current = m
      redrawCompose()
    } else if (props.onAim && aimingRef.current) {
      props.onAim(m)
    }
  }
  const handlePointerUp = () => {
    if (props.pickMode && pickPosRef.current) {
      props.onFieldClick?.(pickPosRef.current)
      pickPosRef.current = null
      redrawCompose()
    }
    aimingRef.current = false
  }

  const interactive = !!props.pickMode || !!props.onAim
  return (
    <canvas
      ref={ref}
      width={INTERNAL}
      height={INTERNAL}
      aria-label="バトルフィールド"
      onPointerDown={interactive ? handlePointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? handlePointerUp : undefined}
      onPointerLeave={interactive ? handlePointerUp : undefined}
      style={interactive ? { cursor: 'crosshair', touchAction: 'none' } : undefined}
    />
  )
}

/** 点ピック中の拡大鏡（ルーペ・#49）。指の少し上に、指の下の盤面を拡大して見せる。 */
function drawPickLoupe(ctx: CanvasRenderingContext2D, pos: Vec2): void {
  const fs = toScreen(pos, VP)
  const R = 70
  const zoom = 2.6
  const gap = 40
  let cx = fs.x
  let cy = fs.y - R - gap
  if (cy - R < 4) cy = fs.y + R + gap // 上が見切れるなら下に出す
  cx = Math.max(R + 4, Math.min(INTERNAL - R - 4, cx))
  cy = Math.max(R + 4, Math.min(INTERNAL - R - 4, cy))
  const half = R / zoom
  ctx.save()
  // 指→ルーペの接続線
  ctx.strokeStyle = 'rgba(90, 209, 255, 0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(fs.x, fs.y)
  ctx.lineTo(cx, cy)
  ctx.stroke()
  // ルーペ円の内側に、指の下の領域を拡大して描く
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#0d0b14'
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(ctx.canvas, fs.x - half, fs.y - half, half * 2, half * 2, cx - R, cy - R, R * 2, R * 2)
  // 中心のクロスヘア
  ctx.strokeStyle = '#5ad1ff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - 12, cy)
  ctx.lineTo(cx + 12, cy)
  ctx.moveTo(cx, cy - 12)
  ctx.lineTo(cx, cy + 12)
  ctx.stroke()
  ctx.restore() // クリップ解除
  // 枠
  ctx.strokeStyle = '#5ad1ff'
  ctx.lineWidth = 3
  ctx.shadowColor = '#5ad1ff'
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.shadowBlur = 0
  // 実際に点が置かれる位置に小さな✛
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(fs.x - 7, fs.y)
  ctx.lineTo(fs.x + 7, fs.y)
  ctx.moveTo(fs.x, fs.y - 7)
  ctx.lineTo(fs.x, fs.y + 7)
  ctx.stroke()
  ctx.restore()
}

/** 発射方向（θ）の矢印を active ally から伸ばす（#47）。 */
function drawAimArrow(ctx: CanvasRenderingContext2D, from: Vec2, angle: number): void {
  const LEN = 7 // 数学ユニット
  const tip = { x: from.x + Math.cos(angle) * LEN, y: from.y + Math.sin(angle) * LEN }
  const a = toScreen(from, VP)
  const b = toScreen(tip, VP)
  ctx.save()
  ctx.strokeStyle = '#ffd56b'
  ctx.fillStyle = '#ffd56b'
  ctx.globalAlpha = 0.85
  ctx.lineWidth = 2.5
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.setLineDash([])
  // 矢じり
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const h = 9
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(b.x - h * Math.cos(ang - 0.4), b.y - h * Math.sin(ang - 0.4))
  ctx.lineTo(b.x - h * Math.cos(ang + 0.4), b.y - h * Math.sin(ang + 0.4))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** 通過点フィットで選んだ点を✛＋連番で表示する（#46）。 */
function drawFitPoints(ctx: CanvasRenderingContext2D, points?: Vec2[]): void {
  if (!points || points.length === 0) return
  ctx.save()
  for (let i = 0; i < points.length; i++) {
    const s = toScreen(points[i], VP)
    ctx.strokeStyle = '#5ad1ff'
    ctx.lineWidth = 2
    ctx.shadowColor = '#5ad1ff'
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.moveTo(s.x - 6, s.y)
    ctx.lineTo(s.x + 6, s.y)
    ctx.moveTo(s.x, s.y - 6)
    ctx.lineTo(s.x, s.y + 6)
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#cdeffd'
    ctx.font = '11px sans-serif'
    ctx.fillText(String(i + 1), s.x + 8, s.y - 8)
  }
  ctx.restore()
}
