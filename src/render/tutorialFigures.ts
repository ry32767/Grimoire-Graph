// 手引き（チュートリアル）の図版（DC プロトタイプ v3 の _drawTut を移植）。
// 8 枚の canvas 図で「y が道／θ で回す／z が属性／強い属性は重い／盤面の輪が z(t)／
// 当たるかは撃つまで分からない／結界とパリィ／壁と暴発」を絵で見せる。
// 描画専用（当たり判定・ロジックには一切関与しない）。値はエンジンの式をそのまま使う。
import { FIELD, SAMPLING } from '../data/constants'
import { strengthOf } from '../game/attribute'
import { acceleration } from '../game/physics'
import { TOKENS } from './palette'

const F = "'DotGothic16', monospace"

/** 属性色（アルファつき）。 */
function col(attr: 'light' | 'dark' | 'neutral', a = 1): string {
  if (attr === 'light') return `rgba(244,196,48,${a})`
  if (attr === 'dark') return `rgba(138,111,214,${a})`
  return `rgba(150,160,180,${a})`
}
export interface TutorialPage {
  title: string
  body: string
}

/** 手引きの本文（DC プロトタイプ v3 の TUT）。 */
export const TUTORIAL_PAGES: TutorialPage[] = [
  {
    title: '① y = f(x) が弾の道',
    body: '式のグラフが、そのまま弾の軌道になる。横軸 x は術者から前へ進んだ距離、縦軸 y はその地点での横ずれ。x² を足せば曲がり、sin を足せば蛇行する。3人ぶんの式を書いて、詠唱で同時に放つ。',
  },
  {
    title: '② θ を回して狙う',
    body: '式は形だけを決める。盤面をドラッグすると、その形のまま射線が回る。⟳ 解く を押せば、いまの式が的の座標を通る θ を数値的に探してくれる。作図台の係数スライダーで形そのものを動かしてもいい。',
  },
  {
    title: '③ z = g(t) が纏う属性',
    body: 'z は飛行距離 t に対する関数。正なら光、負なら闇、0 付近なら無属性。|z| = 5 のとき強度が最大になる。威力は 速度 × 強度 × 相性。反対極なら ×1.5、同極なら ×0.5。',
  },
  {
    title: '④ 強い属性は重い',
    body: '|z| が 2.5 を超えると弾は減速し、0 に近いほど加速する。ずっと最大強度だと失速して消える。中立で加速し、着弾する t だけ強度を尖らせるのが定石。z の式が発散した点では暴発が起きる。',
  },
  {
    title: '⑤ 盤面の輪が z(t)',
    body: '術者を中心とした同心円が z(t) そのもの。半径が飛行距離 t なので、白い破線（的までの距離 r）と明るい強度5の輪を重ねれば最大火力。紫の破線は失速する距離。t₀ ← r でも合わせられる。',
  },
  {
    title: '⑥ 当たるかは撃つまで分からない',
    body: '属性は完全に読めるが、弾道の予測線は出ない。撃った弾の道は盤面に残り、見返しスライダーで前後に追える。敵が次に撃つ軌跡は破線で先に見えるので、そこへ撃ち返せば相殺できる。',
  },
  {
    title: '⑦ 結界とパリィ',
    body: 'y の欄に r= と書くと弾ではなく周回結界を張る。反対極の魔法だけを迎撃し、威力の引き算で必ずどちらかが消える。同極と中立は素通り。輪の明るさと太さがその場の速度。|z|>2.5 だと自分で失速して自滅する。光の結界は内側の味方を毎ターン回復する。',
  },
  {
    title: '⑧ 壁と暴発',
    body: '壁は削り取って進む。当たった点を中心に円をえぐり、威力が高いほど広く削れる。もろい壁はよく崩れ、頑丈な壁は何発もかかり、不壊の壁は弾を止める。暴発は範囲内の壁を吹き飛ばし、味方も巻き込む。暴発を重ねると膜が摩耗し、限界を超えると盤面ごと崩壊する。',
  },
]

/** 'X' のマスだけ塗るドット絵。 */
function pix(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rows: string[], color: string): void {
  ctx.save()
  ctx.fillStyle = color
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    for (let c = 0; c < row.length; c++) if (row[c] === 'X') ctx.fillRect(x + c * s, y + r * s, s + 0.4, s + 0.4)
  }
  ctx.restore()
}

/**
 * 手引きの図版を 1 枚描く。time は秒（アニメーションの位相）。
 * ctx は呼び出し側で clear 済み・原寸（w×h の CSS ピクセル）にスケール済みであること。
 */
export function drawTutorialFigure(
  ctx: CanvasRenderingContext2D,
  index: number,
  w: number,
  h: number,
  time: number,
): void {
  ctx.save()
  ctx.fillStyle = TOKENS.bg
  ctx.fillRect(0, 0, w, h)

  const lab = (s: string, x: number, y: number, c: string, sz = 10, al: CanvasTextAlign = 'left') => {
    ctx.fillStyle = c
    ctx.font = `${sz}px ${F}`
    ctx.textAlign = al
    ctx.fillText(s, x, y)
  }
  const arrow = (x1: number, y1: number, x2: number, y2: number, c: string, lw = 1.4) => {
    ctx.strokeStyle = c
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    const a = Math.atan2(y2 - y1, x2 - x1)
    ctx.fillStyle = c
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - Math.cos(a - 0.42) * 7, y2 - Math.sin(a - 0.42) * 7)
    ctx.lineTo(x2 - Math.cos(a + 0.42) * 7, y2 - Math.sin(a + 0.42) * 7)
    ctx.closePath()
    ctx.fill()
  }
  const mage = (x: number, y: number) =>
    pix(ctx, x - 9, y - 11, 3, ['  XX  ', ' XXXX ', 'XX XX X', 'XXXXXXX', ' XXXXX', ' X  X '], TOKENS.lightSoft)
  const foe = (x: number, y: number) => {
    pix(ctx, x - 11, y - 12, 3.2, ['XXXXXXX', 'X     X', 'X O O X', 'X     X', 'X XXX X', 'XXXXXXX'], '#6a6f88')
    ctx.fillStyle = col('dark', 0.95)
    ctx.fillRect(x - 5, y - 6, 3, 3)
    ctx.fillRect(x + 1, y - 6, 3, 3)
  }
  const gridBg = (x0: number, y0: number, x1: number, y1: number, gx: number) => {
    ctx.strokeStyle = 'rgba(125,143,196,.09)'
    ctx.lineWidth = 1
    for (let x = x0; x <= x1; x += gx) {
      ctx.beginPath()
      ctx.moveTo(x, y0)
      ctx.lineTo(x, y1)
      ctx.stroke()
    }
    for (let y = y0; y <= y1; y += gx) {
      ctx.beginPath()
      ctx.moveTo(x0, y)
      ctx.lineTo(x1, y)
      ctx.stroke()
    }
  }
  const DIM = 'rgba(139,143,174,.85)'

  if (index === 0) {
    // y = f(x) が弾の道
    const ox = 54
    const oy = h * 0.66
    const sx = (w - 100) / 40
    const sy = Math.min(7, (h * 0.5) / 8)
    gridBg(ox - 14, 18, w - 24, h - 18, 16)
    ctx.strokeStyle = 'rgba(125,143,196,.5)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(ox, oy)
    ctx.lineTo(w - 30, oy)
    ctx.stroke()
    arrow(ox, oy, ox, oy - h * 0.42, 'rgba(125,143,196,.5)')
    lab('x  前へ進んだ距離', w - 32, oy + 18, DIM, 10, 'right')
    lab('y  横ずれ', ox + 6, 26, DIM, 10)
    ctx.strokeStyle = col('light', 0.95)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let x = 0; x <= 40; x += 0.4) {
      const y = 0.05 * x * x
      const px = ox + x * sx
      const py = oy - y * sy
      if (!x) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    for (let x = 10; x <= 40; x += 10) {
      const y = 0.05 * x * x
      const px = ox + x * sx
      const py = oy - y * sy
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = col('light', 0.35)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(px, oy)
      ctx.lineTo(px, py)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = TOKENS.lightSoft
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5)
      lab(`x=${x}`, px, oy + 15, DIM, 9, 'center')
    }
    const bx = (time * 9) % 40
    const by = 0.05 * bx * bx
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(ox + bx * sx, oy - by * sy, 4, 0, Math.PI * 2)
    ctx.fill()
    mage(ox - 4, oy - 2)
    lab('y = 0.05x²', w - 32, 34, TOKENS.lightSoft, 13, 'right')
  } else if (index === 1) {
    // θ を回して狙う
    const cx = 64
    const cy = h - 40
    const L = Math.min(w - 120, h * 1.5)
    const sx = L / 40
    gridBg(20, 18, w - 20, h - 18, 16)
    const layers: [number, number][] = [
      [18, 0.22],
      [46, 0.34],
      [72, 0.95],
    ]
    layers.forEach(([deg, al], k) => {
      const a = (deg * Math.PI) / 180
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      ctx.strokeStyle = col('light', al)
      ctx.lineWidth = k === 2 ? 2.4 : 1.6
      ctx.beginPath()
      for (let x = 0; x <= 40; x += 0.4) {
        const y = 0.05 * x * x
        const px = cx + (x * ca - y * sa) * sx
        const py = cy - (x * sa + y * ca) * sx
        if (!x) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      if (k === 2) {
        ctx.setLineDash([3, 4])
        ctx.strokeStyle = col('light', 0.4)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + 40 * ca * sx, cy - 40 * sa * sx)
        ctx.stroke()
        ctx.setLineDash([])
      }
    })
    ctx.strokeStyle = 'rgba(125,143,196,.45)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + 120, cy)
    ctx.stroke()
    ctx.strokeStyle = col('light', 0.7)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(cx, cy, 44, (-72 * Math.PI) / 180, 0)
    ctx.stroke()
    lab('θ', cx + 52, cy - 24, TOKENS.lightSoft, 13)
    lab('式は同じ / 角度だけ変える', cx + 16, 30, DIM, 11)
    mage(cx, cy)
    foe(w - 58, 44)
  } else if (index === 2) {
    // z = g(t) が纏う属性
    const L = 44
    const Rp = 110
    const Tp = 26
    const Bp = 30
    const PW = w - L - Rp
    const PH = h - Tp - Bp
    const zmax = 6.5
    const X = (t: number) => L + (PW * t) / 44
    const Y = (z: number) => Tp + PH / 2 - (z / zmax) * (PH / 2)
    ctx.fillStyle = 'rgba(150,160,180,.12)'
    ctx.fillRect(L, Y(FIELD.epsilon), PW, Y(-FIELD.epsilon) - Y(FIELD.epsilon))
    ;([
      [FIELD.zPeak, col('light', 0.35)],
      [-FIELD.zPeak, col('dark', 0.35)],
    ] as [number, string][]).forEach(([g, c]) => {
      ctx.strokeStyle = c
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(L, Y(g))
      ctx.lineTo(L + PW, Y(g))
      ctx.stroke()
      ctx.setLineDash([])
    })
    ctx.strokeStyle = 'rgba(125,143,196,.45)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(L, Y(0))
    ctx.lineTo(L + PW, Y(0))
    ctx.moveTo(L, Tp)
    ctx.lineTo(L, Tp + PH)
    ctx.stroke()
    const gz = (t: number) => 5 * Math.exp(-Math.pow((t - 27) / 6, 2))
    for (let t = 0; t < 44; t += 0.5) {
      const z = gz(t)
      const z2 = gz(t + 0.5)
      ctx.fillStyle = col('light', 0.08 + (strengthOf((z + z2) / 2) / FIELD.sMax) * 0.3)
      ctx.beginPath()
      ctx.moveTo(X(t), Y(0))
      ctx.lineTo(X(t), Y(z))
      ctx.lineTo(X(t + 0.5), Y(z2))
      ctx.lineTo(X(t + 0.5), Y(0))
      ctx.closePath()
      ctx.fill()
    }
    ctx.strokeStyle = col('light', 0.95)
    ctx.lineWidth = 2.2
    ctx.beginPath()
    for (let t = 0; t <= 44; t += 0.5) {
      const px = X(t)
      const py = Y(gz(t))
      if (!t) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.strokeStyle = col('dark', 0.55)
    ctx.lineWidth = 1.6
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    for (let t = 0; t <= 44; t += 0.5) {
      const px = X(t)
      const py = Y(-gz(t))
      if (!t) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.setLineDash([])
    lab('+5', L - 6, Y(5) + 4, col('light', 0.8), 10, 'right')
    lab('0', L - 6, Y(0) + 4, DIM, 10, 'right')
    lab('-5', L - 6, Y(-5) + 4, col('dark', 0.85), 10, 'right')
    lab('t  飛行距離', L + PW, Tp + PH + 18, DIM, 10, 'right')
    lab('z > 0  光', L + PW + 14, Y(4.4), TOKENS.lightSoft, 12)
    lab('強度 5 で最大', L + PW + 14, Y(4.4) + 15, DIM, 10)
    lab('|z| < 0.35  中立', L + PW + 14, Y(0) + 4, TOKENS.text, 11)
    lab('z < 0  闇', L + PW + 14, Y(-4.4), TOKENS.dark, 12)
    lab('敵が闇 → ×0.5', L + PW + 14, Y(-4.4) + 15, DIM, 10)
  } else if (index === 3) {
    // 強い属性は重い（z=5 ずっと vs 尖峰）
    const panel = (x0: number, pw: number, title: string, zf: (t: number) => number, c: string) => {
      const Tp = 44
      const Bp = 34
      const PH = h - Tp - Bp
      const X = (t: number) => x0 + (pw * t) / 44
      lab(title, x0, 30, c, 12)
      ctx.strokeStyle = 'rgba(125,143,196,.3)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, Tp + PH * 0.42)
      ctx.lineTo(x0 + pw, Tp + PH * 0.42)
      ctx.stroke()
      ctx.strokeStyle = c
      ctx.lineWidth = 1.8
      ctx.beginPath()
      for (let t = 0; t <= 44; t += 0.5) {
        const py = Tp + PH * 0.42 - (zf(t) / 6) * (PH * 0.36)
        if (!t) ctx.moveTo(X(t), py)
        else ctx.lineTo(X(t), py)
      }
      ctx.stroke()
      lab('z', x0 - 11, Tp + PH * 0.16, DIM, 10)
      let A = 0
      let dead: number | null = null
      const vs: { t: number; sp: number }[] = []
      for (let t = 0; t <= 44; t += 0.5) {
        A += acceleration(zf(t)) * 0.5
        const sp = Math.min(FIELD.maxFlightSpeed, Math.sqrt(Math.max(0, FIELD.fixedSpeed ** 2 + 2 * A)))
        vs.push({ t, sp })
        if (dead === null && sp <= 0.35) dead = t
      }
      const vy = (sp: number) => Tp + PH - (sp / FIELD.maxFlightSpeed) * (PH * 0.4)
      ctx.strokeStyle = 'rgba(238,240,251,.85)'
      ctx.lineWidth = 1.8
      ctx.beginPath()
      vs.forEach((p, k) => {
        if (dead !== null && p.t > dead) return
        const px = X(p.t)
        const py = vy(p.sp)
        if (!k) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
      ctx.stroke()
      lab('v', x0 - 11, Tp + PH - 6, 'rgba(238,240,251,.7)', 10)
      const rx = X(27)
      ctx.strokeStyle = 'rgba(255,255,255,.4)'
      ctx.setLineDash([2, 4])
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.moveTo(rx, Tp)
      ctx.lineTo(rx, Tp + PH)
      ctx.stroke()
      ctx.setLineDash([])
      lab('t=r', rx, h - 14, DIM, 9, 'center')
      if (dead !== null && dead < 27) {
        const dx = X(dead)
        ctx.strokeStyle = TOKENS.hpLow
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(dx - 5, vy(2) - 5)
        ctx.lineTo(dx + 5, vy(2) + 5)
        ctx.moveTo(dx + 5, vy(2) - 5)
        ctx.lineTo(dx - 5, vy(2) + 5)
        ctx.stroke()
        lab('失速', dx, vy(2) - 13, TOKENS.hpLow, 10, 'center')
      } else {
        const sp = vs[54]?.sp ?? 12
        ctx.fillStyle = TOKENS.lightSoft
        ctx.beginPath()
        ctx.arc(rx, vy(sp), 4.5, 0, Math.PI * 2)
        ctx.fill()
        lab('命中', rx + 9, vy(sp) - 6, TOKENS.lightSoft, 10)
      }
    }
    const half = (w - 70) / 2
    panel(46, half, 'z = 5（ずっと最大強度）', () => 5, col('light', 0.9))
    ctx.strokeStyle = 'rgba(125,143,196,.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(46 + half + 18, 24)
    ctx.lineTo(46 + half + 18, h - 24)
    ctx.stroke()
    panel(46 + half + 36, half - 14, 'z = 5e^(-((t-27)/6)²)', (t) => 5 * Math.exp(-Math.pow((t - 27) / 6, 2)), col('light', 0.9))
  } else if (index === 4) {
    // 盤面の同心円が z(t)
    const cx = 70
    const cy = h / 2
    const u = Math.min((w - 150) / 30, (h - 40) / 22)
    const gz = (t: number) => 5 * Math.exp(-Math.pow((t - 24) / 6, 2))
    for (let t = 2; t <= 30; t += 2) {
      const z = gz(t)
      const st = strengthOf(z)
      if (Math.abs(z) < FIELD.epsilon) continue
      ctx.strokeStyle = col('light', 0.1 + (st / FIELD.sMax) * 0.34)
      ctx.lineWidth = 0.8 + (st / FIELD.sMax) * 2.2
      ctx.beginPath()
      ctx.arc(cx, cy, t * u, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.strokeStyle = col('light', 0.85)
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.arc(cx, cy, 24 * u, 0, Math.PI * 2)
    ctx.stroke()
    lab('強度5 の輪', cx + 24 * u + 8, cy - 10 * u, TOKENS.lightSoft, 11)
    ctx.strokeStyle = 'rgba(255,255,255,.55)'
    ctx.setLineDash([2, 5])
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(cx, cy, 24 * u, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    const ang = -0.32
    const ex = cx + Math.cos(ang) * 24 * u
    const ey = cy + Math.sin(ang) * 24 * u
    foe(ex, ey)
    lab('t = r  的の円', ex + 16, ey + 22, TOKENS.text, 11)
    mage(cx, cy)
    lab('同心円 = z(t)  半径が t', 24, 24, DIM, 11)
    const pull = Math.sin(time * 1.5) * 10
    arrow(cx + 18 * u, cy + 7 * u + pull, cx + 23 * u, cy + 3.4 * u + pull, col('light', 0.9), 1.6)
    lab('t₀ を動かして重ねる', cx + 9 * u, cy + 10 * u + 22, TOKENS.lightSoft, 10)
  } else if (index === 5) {
    // 当たるかは撃つまで分からない
    const cx = 58
    const cy = h - 38
    const u = Math.min((w - 130) / 34, (h - 70) / 16)
    gridBg(20, 18, w - 20, h - 14, 16)
    const ex = cx + 27 * u
    const ey = cy - 11 * u
    const ghosts: [number, string][] = [
      [0.02, 'rgba(125,143,196,.3)'],
      [0.075, 'rgba(125,143,196,.22)'],
      [-0.03, 'rgba(125,143,196,.16)'],
    ]
    ghosts.forEach(([k, c]) => {
      ctx.strokeStyle = c
      ctx.lineWidth = 1.4
      ctx.beginPath()
      const a = 0.38
      for (let x = 0; x <= 34; x += 0.4) {
        const y = k * x * x
        const px = cx + (x * Math.cos(a) - y * Math.sin(a)) * u
        const py = cy - (x * Math.sin(a) + y * Math.cos(a)) * u
        if (!x) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    })
    ctx.strokeStyle = col('light', 0.95)
    ctx.lineWidth = 2.4
    ctx.beginPath()
    const a2 = 0.4
    for (let x = 0; x <= 34; x += 0.4) {
      const y = 0.048 * x * x
      const px = cx + (x * Math.cos(a2) - y * Math.sin(a2)) * u
      const py = cy - (x * Math.sin(a2) + y * Math.cos(a2)) * u
      if (!x) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    const nx = cx + 21 * u
    const ny = cy - 8.4 * u
    ctx.strokeStyle = 'rgba(125,143,196,.85)'
    ctx.setLineDash([2, 3])
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(nx, ny)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    ctx.setLineDash([])
    lab('最接近 d = 4.2', nx - 6, ny + 18, TOKENS.text, 10, 'right')
    foe(ex, ey)
    mage(cx, cy)
    lab('外れた弾は残像として残る', 24, 28, DIM, 11)
    lab('撃つ前に、敵の軌跡は破線で見えている', 24, h - 16, TOKENS.lightSoft, 11)
  } else if (index === 6) {
    // 結界とパリィ
    const cx = w * 0.4
    const cy = h * 0.55
    const rr = Math.min(w, h) * 0.26
    gridBg(18, 18, w - 18, h - 18, 16)
    const N = 72
    const ring: { x: number; y: number; sp: number }[] = []
    for (let n = 0; n < N; n++) {
      const a = (n / N) * Math.PI * 2
      ring.push({
        x: cx + Math.cos(a) * rr,
        y: cy + Math.sin(a) * rr,
        sp: 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a * 2 - time)),
      })
    }
    ctx.lineCap = 'round'
    for (let n = 0; n < N; n++) {
      const p = ring[n]
      const q = ring[(n + 1) % N]
      ctx.strokeStyle = col('light', 0.12 + p.sp * 0.7)
      ctx.lineWidth = 1 + p.sp * 3.2
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }
    for (let m = 0; m < 10; m++) {
      const n = Math.floor(time * 26 + (m * N) / 10) % N
      const p = ring[n]
      ctx.fillStyle = TOKENS.lightSoft
      ctx.beginPath()
      ctx.arc(p.x, p.y, 1.4 + p.sp * 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    mage(cx, cy)
    // 反対極の弾が結界の縁で必ず相殺する（到達点を決め打ちして毎周同じ絵にする）
    const hitX = cx + rr * 0.86
    const hitY = cy - rr * 0.52
    const startX = w - 30
    const LP = 3.2
    const ph = (time % LP) / LP
    const fly = Math.min(1, ph / 0.62)
    const ix = startX + (hitX - startX) * fly
    if (fly < 1) {
      ctx.strokeStyle = col('dark', 0.5)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(Math.min(startX, ix + 74), hitY)
      ctx.lineTo(ix, hitY)
      ctx.stroke()
      ctx.fillStyle = '#e2daff'
      ctx.beginPath()
      ctx.arc(ix, hitY, 4, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const pr = Math.min(1, (ph - 0.62) / 0.3)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let s = 0; s < 2; s++) {
        const q = Math.min(1, Math.max(0, (pr - s * 0.18) / 0.82))
        if (q <= 0) continue
        ctx.strokeStyle = `rgba(255,246,224,${((1 - q) * (1 - q) * 0.95).toFixed(3)})`
        ctx.lineWidth = (4 - s * 2) * (1 - q) + 0.8
        ctx.beginPath()
        ctx.arc(hitX, hitY, 7 + q * 34, 0, Math.PI * 2)
        ctx.stroke()
      }
      for (let s = 0; s < 12; s++) {
        const a = (s / 12) * Math.PI * 2 + 0.3
        const len = 8 + 30 * Math.pow(pr, 0.55)
        ctx.strokeStyle = col(s % 2 ? 'light' : 'dark', 0.85 * (1 - pr))
        ctx.lineWidth = 2.2 * (1 - pr) + 0.5
        ctx.beginPath()
        ctx.moveTo(hitX + Math.cos(a) * len * 0.35, hitY + Math.sin(a) * len * 0.35)
        ctx.lineTo(hitX + Math.cos(a) * len, hitY + Math.sin(a) * len)
        ctx.stroke()
      }
      ctx.restore()
      if (pr < 0.7) lab('相殺', hitX, hitY - 24, `rgba(255,246,224,${(1 - pr / 0.7).toFixed(2)})`, 11, 'center')
    }
    lab('r = 6 + 1.6cos(3θ) のように書くと結界', 24, 28, DIM, 11)
    lab('反対極だけ迎撃 ・ 威力の引き算でどちらかが消える', 24, h - 16, TOKENS.lightSoft, 11)
  } else {
    // 壁と暴発（削り・減速・停止を縮尺して再現する）
    gridBg(18, 18, w - 18, h - 18, 16)
    const bx0 = w * 0.13
    const by0 = h * 0.76
    const trajY = (x: number) => by0 - (x - bx0) * 0.24 - Math.pow((x - bx0) / w, 2) * 54
    const walls = [
      { x: w * 0.37, r: 27, c: '#4a4f66', l: 'もろい', cr: 0.42, loss: 0.055 },
      { x: w * 0.59, r: 24, c: '#5c6076', l: '頑丈', cr: 0.14, loss: 0.034 },
      { x: w * 0.81, r: 20, c: '#2a2d3c', l: '不壊', cr: 0, loss: 1 },
    ]
    const STEP = 2.4
    const holes: { x: number; y: number; r: number; t: number }[] = []
    const marks: { x: number; y: number; t: number; sp: number }[] = []
    let sp = 1
    let tAcc = 0
    let stopAt: { x: number; y: number; t: number } | null = null
    let hitWall: (typeof walls)[number] | null = null
    for (let x = bx0; x <= w - 16; x += STEP) {
      const y = trajY(x)
      tAcc += STEP / Math.max(0.14, sp)
      marks.push({ x, y, t: tAcc, sp })
      const q = walls.find((q0) => Math.hypot(x - q0.x, y - trajY(q0.x)) < q0.r)
      if (!q) continue
      if (holes.some((hh) => Math.hypot(x - hh.x, y - hh.y) < hh.r)) continue // 開けた穴の中は素通り
      if (q.cr === 0) {
        stopAt = { x, y, t: tAcc }
        hitWall = q
        break
      }
      holes.push({ x, y, r: q.r * q.cr, t: tAcc })
      sp = Math.max(0, sp - q.loss)
      if (sp <= 0) {
        stopAt = { x, y, t: tAcc }
        hitWall = q
        break
      }
    }
    const total = (stopAt ? stopAt.t : (marks[marks.length - 1]?.t ?? 1)) || 1
    const LP = 6.4
    const ph = (time % LP) / LP
    const run = Math.min(1, ph / 0.7) * total
    let cur = marks[0]
    for (const m of marks) {
      if (m.t <= run) cur = m
      else break
    }
    for (const q of walls) {
      const qy = trajY(q.x)
      ctx.save()
      ctx.fillStyle = q.c
      ctx.beginPath()
      ctx.arc(q.x, qy, q.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(125,143,196,.3)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalCompositeOperation = 'destination-out'
      for (const hh of holes) {
        if (hh.t > run) continue
        if (Math.hypot(hh.x - q.x, hh.y - qy) > q.r + hh.r) continue
        ctx.beginPath()
        ctx.arc(hh.x, hh.y, hh.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      lab(q.l, q.x, qy + q.r + 14, DIM, 9, 'center')
    }
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const hh of holes) {
      if (hh.t > run) continue
      const age = Math.min(1, (run - hh.t) / 9)
      ctx.strokeStyle = col('light', 0.42 * (1 - age))
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(hh.x, hh.y, hh.r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    ctx.save()
    ctx.lineCap = 'round'
    for (let n = 1; n < marks.length; n++) {
      const m = marks[n]
      if (m.t > run) break
      ctx.strokeStyle = col('light', 0.14 + marks[n - 1].sp * 0.42)
      ctx.lineWidth = 1.1 + marks[n - 1].sp * 1.8
      ctx.beginPath()
      ctx.moveTo(marks[n - 1].x, marks[n - 1].y)
      ctx.lineTo(m.x, m.y)
      ctx.stroke()
    }
    ctx.restore()
    const stopped = stopAt && run >= stopAt.t
    if (!stopped) {
      ctx.fillStyle = TOKENS.lightSoft
      ctx.beginPath()
      ctx.arc(cur.x, cur.y, 2.4 + cur.sp * 2.4, 0, Math.PI * 2)
      ctx.fill()
      lab(`v ${cur.sp.toFixed(2)}`, cur.x, cur.y - 14, col('light', 0.9), 9, 'center')
    } else if (stopAt) {
      const pr = Math.min(1, (run - stopAt.t) / (total * 0.2) + 0.001)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      for (let s = 0; s < 9; s++) {
        const a = Math.PI * 0.55 + (s / 9) * Math.PI * 0.9
        const len = 6 + 16 * Math.pow(pr, 0.5)
        ctx.strokeStyle = `rgba(255,240,210,${(0.85 * (1 - pr)).toFixed(3)})`
        ctx.lineWidth = 1.8 * (1 - pr) + 0.4
        ctx.beginPath()
        ctx.moveTo(stopAt.x, stopAt.y)
        ctx.lineTo(stopAt.x + Math.cos(a) * len, stopAt.y + Math.sin(a) * len)
        ctx.stroke()
      }
      ctx.restore()
      lab(
        hitWall && hitWall.cr === 0 ? '不壊 — 弾は全速度を失って停止' : '削り切れず壁の中で消滅',
        stopAt.x,
        stopAt.y - 20,
        TOKENS.warn,
        10,
        'center',
      )
    }
    mage(bx0, by0)
    lab('触れた点を中心に円を引き算 → 穴の中は素通り → 再突入でまた削る', 24, 28, DIM, 11)
    lab('もろい＝一噛みが大きい ／ 頑丈＝小刻みで失速が重い ／ 不壊＝削れず弾を止める', 24, h - 16, TOKENS.warn, 11)
  }
  ctx.restore()
}

/** 手引きで使う最大 t（図の横軸）。SAMPLING と揃える。 */
export const TUT_TMAX = SAMPLING.rotateXMax
