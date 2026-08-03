// 膜の摩耗による「盤面の異常」を画面全体へ出す（DC プロトタイプ v3 の _drawAnomaly）。
// 残り回数は数字で見せず、**画面の異常だけ**で危うさを伝えるのがこの演出の役目。
//   Lv1 異常なし ／ Lv2 塵が降る ／ Lv3-4 それが増える ／ Lv5 亀裂＋一瞬のバグり
// 描画専用（ロジックには一切関与しない）。
import { INSTABILITY } from '../data/constants'

export type AnomalyLevel = 1 | 2 | 3 | 4 | 5

/** 膜の摩耗（instability）から 5 段階の異常レベルへ。 */
export function anomalyStage(count: number): AnomalyLevel {
  const wear = count / Math.max(1, INSTABILITY.misfireLimit)
  if (wear < 0.2) return 1
  if (wear < 0.45) return 2
  if (wear < 0.65) return 3
  if (wear < 0.85) return 4
  return 5
}

/** 画面全体にかける赤みとビネットの CSS（Lv1 は無し）。 */
export function anomalyTint(level: AnomalyLevel): React.CSSProperties {
  const v = level - 1
  if (v <= 0) return { display: 'none' }
  return {
    boxShadow: `inset 0 0 ${46 + v * 40}px rgba(255,72,50,${(0.035 + v * 0.05).toFixed(3)})`,
    background: `rgba(118,12,12,${(0.02 + v * 0.03).toFixed(3)})`,
  }
}

interface Dust {
  x: number
  y: number
  v: number
  r: number
  s: number
}

/** 1 画面ぶんの異常演出の状態（塵の粒とひび）。 */
export interface AnomalyState {
  dust: Dust[]
  cracks: [number, number][][] | null
  glitchUntil: number
}

export function createAnomalyState(): AnomalyState {
  return { dust: [], cracks: null, glitchUntil: 0 }
}

/** 決定的な擬似乱数（ひびの形を毎フレーム変えないため）。 */
function hash(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453
  return x - Math.floor(x)
}

function buildCracks(): [number, number][][] {
  const out: [number, number][][] = []
  for (let c = 0; c < 5; c++) {
    const fromTop = hash(c * 3 + 2) < 0.55
    let x = 0.1 + hash(c * 3 + 1) * 0.8
    let y = fromTop ? 0 : 1
    let ang = (fromTop ? Math.PI / 2 : -Math.PI / 2) + (hash(c * 7) - 0.5) * 1.3
    const len = 0.09 + hash(c * 11) * 0.11
    const pts: [number, number][] = [[x, y]]
    for (let n = 0; n < 7; n++) {
      ang += (hash(c * 13 + n) - 0.5) * 1.0
      x += Math.cos(ang) * len * 0.6
      y += Math.sin(ang) * len
      pts.push([x, y])
    }
    out.push(pts)
  }
  return out
}

/** 異常演出を 1 フレーム描く（ctx は原寸へスケール済みであること）。 */
export function drawAnomaly(
  ctx: CanvasRenderingContext2D,
  state: AnomalyState,
  w: number,
  h: number,
  level: AnomalyLevel,
  nowMs: number,
): void {
  ctx.clearRect(0, 0, w, h)
  if (level < 2) {
    state.dust.length = 0
    return
  }
  const t = nowMs / 1000

  // 上から降る塵
  const want = [0, 0, 26, 46, 72, 104][level] ?? 0
  while (state.dust.length < want) {
    state.dust.push({
      x: Math.random() * w,
      y: Math.random() * h,
      v: 0.25 + Math.random() * 0.95,
      r: 0.5 + Math.random() * 1.4,
      s: Math.random() * 6.28,
    })
  }
  if (state.dust.length > want) state.dust.length = want
  ctx.fillStyle = `rgba(214,198,178,${(0.09 + level * 0.042).toFixed(3)})`
  for (const p of state.dust) {
    p.y += p.v * (0.65 + level * 0.24)
    p.x += Math.sin(t * 1.4 + p.s) * 0.22
    if (p.y > h + 4) {
      p.y = -6
      p.x = Math.random() * w
    }
    ctx.fillRect(p.x, p.y, p.r, p.r * (1.6 + level * 0.3))
  }

  if (level < 5) return

  // 亀裂（形は固定・明滅だけする）
  if (!state.cracks) state.cracks = buildCracks()
  const line = (pts: [number, number][]) => {
    ctx.beginPath()
    pts.forEach((p, i) => {
      const X = p[0] * w
      const Y = p[1] * h
      if (!i) ctx.moveTo(X, Y)
      else ctx.lineTo(X, Y)
    })
    ctx.stroke()
  }
  ctx.lineCap = 'round'
  state.cracks.forEach((pts, ci) => {
    const fl = 0.55 + 0.45 * Math.sin(t * 2.1 + ci * 1.7)
    ctx.strokeStyle = `rgba(255,96,64,${(0.34 * fl).toFixed(3)})`
    ctx.lineWidth = 4.2
    line(pts)
    ctx.strokeStyle = `rgba(255,180,140,${(0.3 * fl).toFixed(3)})`
    ctx.lineWidth = 1.8
    line(pts)
    ctx.strokeStyle = 'rgba(10,2,2,.88)'
    ctx.lineWidth = 1.2
    line(pts)
  })

  // ごくたまに画面が一瞬バグる
  if (nowMs > state.glitchUntil + 520 && Math.random() < 0.011) {
    state.glitchUntil = nowMs + 80 + Math.random() * 90
  }
  if (nowMs < state.glitchUntil) {
    for (let b = 0; b < 8; b++) {
      const y0 = Math.random() * h
      const hh = 3 + Math.random() * 18
      const off = (Math.random() - 0.5) * 34
      ctx.fillStyle =
        (b % 2 ? 'rgba(138,111,214,' : 'rgba(244,196,48,') + (0.1 + Math.random() * 0.2).toFixed(3) + ')'
      ctx.fillRect(off, y0, w, hh)
    }
    ctx.fillStyle = 'rgba(255,255,255,.045)'
    ctx.fillRect(0, 0, w, h)
  }
}
