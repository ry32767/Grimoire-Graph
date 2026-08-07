// 魔法演出のドット絵文法（DESIGN.md §4.5／§6：ピクセル・ハード影・グラデーション禁止）。
//
// 何を変えたか：放射グラデーション（createRadialGradient）・shadowBlur・なめらかなフェードをやめ、
// **整数座標に落とした矩形（ドット）だけ**で威力・属性・時間を語る。ドットの粒度は術者スプライトと
// 同じ 1 ドット幅に揃えるので、魔法とキャラクタが同じピクセル格子に載る。
//
// なぜ 1 か所に集約するか：戦闘アニメ（board.ts / draw.ts）とエンドロール（endroll.ts）が
// 必ず同じ見た目になるよう、粒度・階数・アルファの段は共有する（#74 の trailWidthPx と同じ考え方）。
//
// **描画は一切ロジックを持たない**：弾の大きさは game/collision の当たり半径をそのまま読む（#72）。
import { scaleOf, type Viewport } from '../game/coords'
import { bulletRadius } from '../game/collision'

/**
 * 演出ドットの粒度（画面ピクセル）。術者スプライト（draw.MAGE_ROWS を描く 1 ドット幅）と
 * 同じ `scaleOf(vp) × 0.16` に揃える＝魔法とキャラが同じ格子に載る。
 * 整数に丸めるのは、ドットの継ぎ目に隙間や重なりを出さないため。
 */
export function dotPx(vp: Viewport): number {
  return Math.max(2, Math.round(scaleOf(vp) * 0.16))
}

/**
 * 弾の**外縁**（一番外側のドットの位置＝当たり半径）を半径何ドットで描くかを返す（#72）。
 * **威力ではなく当たり半径（game/collision.bulletRadius）から引く**のが要点。
 * 威力から独立に段（tier = 1 + round(powerFrac×3) 等）を作ると、最大威力の弾ですら
 * 最小の当たり半径より小さく描かれ、「見えている大きさ＝ぶつかる大きさ」が壊れる。
 * bulletRadius 自体が `min + (max-min)×powerFraction` なので、**これでも威力は段として読める**。
 * `drawBullet` はこの tier を外縁の上限として使い、芯・棘・ハローのどのドットもこれを超えて置かない。
 */
export function bulletDotTier(speed: number, z: number, vp: Viewport): number {
  const unit = dotPx(vp)
  return Math.max(1, Math.round((bulletRadius(speed, z) * scaleOf(vp)) / unit))
}

/**
 * アルファを段に落とす（DESIGN.md §6：なめらかなフェード禁止）。
 * 連続的に薄くするとドットが霞んでグローに戻るので、必ず離散段で落とす。
 */
export function quantAlpha(a: number, steps = 4): number {
  if (a <= 0) return 0
  return Math.max(1, Math.ceil(Math.min(1, a) * steps)) / steps
}

/** 整数座標に落としたドット 1 個。演出の唯一の描画プリミティブ。 */
export function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1,
): void {
  const a = quantAlpha(alpha)
  if (a <= 0) return
  const s = Math.max(1, Math.round(size))
  ctx.globalAlpha = a
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s)
}

/**
 * ドットの円盤（弾・粒の本体）。**L1 のひし形（|dx|+|dy|≤tier）ではなく円**で描く：
 * ひし形は対角方向で半径の 0.71 倍しか届かず、円の当たり判定を 3 割方削ってしまう。
 * 行ごとに 1 本の矩形へまとめるので、tier が大きくても fillRect は 2×tier+1 回で済む。
 *
 * @param tier   半径（ドット数）
 * @param edge   縁の色（属性色）
 * @param core   芯の色（白熱）。省略すると単色
 */
export function pixelDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tier: number,
  unit: number,
  edge: string,
  core?: string,
  alpha = 1,
): void {
  const a = quantAlpha(alpha)
  if (a <= 0 || tier < 0) return
  const u = Math.max(1, Math.round(unit))
  const x0 = Math.round(cx - u / 2)
  const y0 = Math.round(cy - u / 2)
  // 芯は半径の 4 割（本体＝威力を覆い隠さない大きさ）
  const inner = core ? Math.floor(tier * 0.4) : -1
  ctx.globalAlpha = a
  for (let dy = -tier; dy <= tier; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, tier * tier - dy * dy)))
    const y = y0 + dy * u
    ctx.fillStyle = edge
    ctx.fillRect(x0 - w * u, y, (2 * w + 1) * u, u)
    if (inner >= 0 && Math.abs(dy) <= inner && core) {
      const iw = Math.floor(Math.sqrt(Math.max(0, inner * inner - dy * dy)))
      ctx.fillStyle = core
      ctx.fillRect(x0 - iw * u, y, (2 * iw + 1) * u, u)
    }
  }
}

/**
 * ドットの輪（衝撃波・発射閃光・霧散の共通語彙）。半径 rPx の円周に n 個のドットを置く。
 * 角度は 1/n 刻みに固定なので、フレームごとに粒が跳ねない。
 */
export function pixelRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rPx: number,
  n: number,
  size: number,
  color: string,
  alpha = 1,
  phase = 0,
): void {
  const a = quantAlpha(alpha)
  if (a <= 0 || n <= 0) return
  const s = Math.max(1, Math.round(size))
  ctx.globalAlpha = a
  ctx.fillStyle = color
  for (let i = 0; i < n; i++) {
    const ang = ((i + phase) / n) * Math.PI * 2
    const x = cx + Math.cos(ang) * rPx
    const y = cy + Math.sin(ang) * rPx
    ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s)
  }
}

/**
 * ドットの衝撃波リング（着弾・相殺・発射閃光の共通語彙）。
 *
 * **半径は元の絶対ピクセル式（r0 + span）のまま**にして、進み方だけを段にし、格子へ丸める。
 * 段数からピクセル半径を組み立て直す（`半径 = 段 × ドット幅 × 1.6`）と、ドット幅が下限 2px に
 * 張りつく盤面の縮尺で輪が数分の一に縮む（相殺の輪が 141px → 16px になり「必ず目に入る」
 * 演出が消える）。ドット絵にしたいのは**進み方と粒**であって、演出の大きさではない。
 *
 * 粒の数は円周に比例させる（固定本数だと半径が伸びたとき点が散らばって輪に見えない）。
 *
 * @param r0    進行 0 のときの半径（画面px）
 * @param span  進行 1 までに広がる幅（画面px）
 * @param steps 何段で広がるか（威力で増やす）
 */
export function pixelShockwave(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r0: number,
  span: number,
  progress: number,
  steps: number,
  unit: number,
  colorA: string,
  colorB: string,
  alpha: number,
): void {
  if (progress < 0 || progress >= 1) return
  const a = quantAlpha(alpha)
  if (a <= 0) return
  const u = Math.max(1, Math.round(unit))
  const q = Math.floor(progress * Math.max(1, steps)) / Math.max(1, steps) // 段で進む（補間しない）
  const r = Math.max(u, Math.round((r0 + q * span) / u) * u)
  const n = Math.max(8, Math.round((2 * Math.PI * r) / (u * 2)))
  ctx.globalAlpha = a
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB
    ctx.fillRect(
      Math.round(cx + Math.cos(ang) * r - u / 2),
      Math.round(cy + Math.sin(ang) * r - u / 2),
      u,
      u,
    )
  }
}

/**
 * 角度を 16 方位へスナップする。回転する棘・破片が「なめらかに回る」のを防ぎ、
 * ドット絵らしいカクついた回転にする（DESIGN.md §6）。
 */
export function snapAngle(rad: number, dirs = 16): number {
  const step = (Math.PI * 2) / dirs
  return Math.round(rad / step) * step
}

/**
 * 画面座標のポリラインを歩幅 stepPx で歩き、等間隔の位置を返す（軌跡のドット化に使う）。
 * サンプル間隔は速度でばらつく（速い所ほど粗い）ので、**弧長で歩き直さないと**
 * ドットの密度が速度で変わってしまう。区間の属性（z・速度）は始点のものをそのまま使う
 * ＝区間ごとに一定＝ピクセルらしい階段状の色分けになる。
 */
export function walkPath<T>(
  pts: T[],
  upto: number,
  toPx: (p: T) => { x: number; y: number },
  stepPx: number,
  cb: (x: number, y: number, src: T, index: number, headFrac: number) => void,
): void {
  const end = Math.min(upto, pts.length - 1)
  if (end < 1) return
  const step = Math.max(1, stepPx)
  const px: { x: number; y: number }[] = []
  for (let i = 0; i <= end; i++) px.push(toPx(pts[i]))
  let total = 0
  for (let i = 1; i <= end; i++) total += Math.hypot(px[i].x - px[i - 1].x, px[i].y - px[i - 1].y)
  if (total <= 0) {
    cb(px[0].x, px[0].y, pts[0], 0, 1)
    return
  }
  let acc = 0 // px[i-1] までの累積距離
  let next = 0 // 次にドットを置く距離
  for (let i = 1; i <= end; i++) {
    const ax = px[i - 1].x
    const ay = px[i - 1].y
    const dx = px[i].x - ax
    const dy = px[i].y - ay
    const seg = Math.hypot(dx, dy)
    if (seg <= 0) continue
    while (next <= acc + seg) {
      const t = (next - acc) / seg
      // headFrac：0=撃った所（古い）／1=弾の頭（新しい）
      cb(ax + dx * t, ay + dy * t, pts[i - 1], i - 1, next / total)
      next += step
    }
    acc += seg
  }
}
