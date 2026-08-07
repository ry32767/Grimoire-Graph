// 魔法演出のドット絵文法の回帰テスト。
// **描いた大きさが当たり判定と一致しているか**を数値で固定する（#72）。見た目のテストは
// 実機でしかできないが、「ドットの階数を威力から別に作って当たり半径から乖離する」種類の
// 事故だけはここで止められる（実際、階数を powerFrac から作ると最大威力の弾ですら
// 最小の当たり半径より小さく描かれる）。
import { describe, expect, it } from 'vitest'
import { bulletDotTier, dotPx, pixelShockwave, quantAlpha, walkPath } from './pixelfx'
import { trailWidthPx } from './board'
import { drawBullet } from './draw'
import { bulletRadius } from '../game/collision'
import { scaleOf, type Viewport } from '../game/coords'
import { COMBAT, FIELD } from '../data/constants'

const VPS: Viewport[] = [
  { width: 900, height: 700, unitsRadius: FIELD.rField },
  { width: 480, height: 480, unitsRadius: FIELD.rField },
  { width: 1600, height: 1000, unitsRadius: FIELD.rField, zoom: 1.6 },
]

/** 威力の代表点：0（静止）〜最大（sMax × maxFlightSpeed）まで */
const CASES = [
  { speed: 0, z: 0 },
  { speed: 6, z: 2 },
  { speed: 12, z: FIELD.zPeak / 2 },
  { speed: FIELD.maxFlightSpeed, z: FIELD.zPeak },
]

describe('弾のドット階数（#72：見えている大きさ＝ぶつかる大きさ）', () => {
  it('描かれる半径は当たり半径と 1/2 ドット以内で一致する', () => {
    for (const vp of VPS) {
      const unit = dotPx(vp)
      for (const c of CASES) {
        const drawn = bulletDotTier(c.speed, c.z, vp) * unit
        const hit = bulletRadius(c.speed, c.z) * scaleOf(vp)
        expect(Math.abs(drawn - hit)).toBeLessThanOrEqual(unit / 2)
      }
    }
  })

  it('最大威力の弾は最小威力の弾より必ず大きく描かれる（威力が段で読める）', () => {
    for (const vp of VPS) {
      const lo = bulletDotTier(0, 0, vp)
      const hi = bulletDotTier(FIELD.maxFlightSpeed, FIELD.zPeak, vp)
      expect(hi).toBeGreaterThan(lo)
    }
  })

  it('どんな弾も 1 ドット以上ある（消えない）', () => {
    for (const vp of VPS) expect(bulletDotTier(0, 0, vp)).toBeGreaterThanOrEqual(1)
  })
})

describe('軌跡の太さ（#74）', () => {
  it('ドット格子の整数倍に丸まる（弾・スプライトと粒度が揃う）', () => {
    for (const vp of VPS) {
      const unit = dotPx(vp)
      for (const z of [0, 1, 2.5, FIELD.zPeak]) {
        expect(trailWidthPx(z, vp) % unit).toBe(0)
      }
    }
  })

  it('量子化しても弾の本体より細い（軌跡を当たり判定と読み違えない）', () => {
    for (const vp of VPS) {
      const thickest = trailWidthPx(FIELD.zPeak, vp)
      const thinnestBullet = 2 * COMBAT.bulletRadiusMin * scaleOf(vp)
      expect(thickest).toBeLessThan(thinnestBullet)
    }
  })

  it('強いほど太い（単調）', () => {
    const vp = VPS[0]
    expect(trailWidthPx(FIELD.zPeak, vp)).toBeGreaterThan(trailWidthPx(0, vp))
  })
})

describe('衝撃波の大きさ（ドット化で演出が縮まない）', () => {
  /** fillRect を記録するだけの偽 ctx。描かれた矩形から実際の到達半径を測る。 */
  const fakeCtx = () => {
    const rects: { x: number; y: number; w: number; h: number }[] = []
    return {
      rects,
      ctx: {
        globalAlpha: 1,
        fillStyle: '',
        fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h }),
      } as unknown as CanvasRenderingContext2D,
    }
  }
  /** 中心 (0,0) からの最大到達距離 */
  const reach = (rects: { x: number; y: number; w: number; h: number }[]) =>
    Math.max(0, ...rects.map((r) => Math.hypot(r.x + r.w / 2, r.y + r.h / 2)))

  it('相殺の輪は元の絶対半径（9+pw×22 → +44+pw×66）どおり広がる', () => {
    // ドット幅が下限 2px に張りつく縮尺でも縮まないこと。
    // 段からピクセル半径を組み立て直す実装ではここが 141px → 16px へ潰れていた。
    const { ctx, rects } = fakeCtx()
    pixelShockwave(ctx, 0, 0, 31, 110, 0.99, 6, 2, '#fff', '#fff', 1)
    expect(reach(rects)).toBeGreaterThan(120)
  })

  it('着弾の輪も同様（6 → 36px）', () => {
    const { ctx, rects } = fakeCtx()
    pixelShockwave(ctx, 0, 0, 6, 30, 0.99, 4, 2, '#fff', '#fff', 1)
    expect(reach(rects)).toBeGreaterThan(28)
  })

  it('半径が伸びても粒が散らばらない（本数が円周に比例する）', () => {
    const small = fakeCtx()
    const big = fakeCtx()
    pixelShockwave(small.ctx, 0, 0, 10, 0, 0.5, 4, 2, '#fff', '#fff', 1)
    pixelShockwave(big.ctx, 0, 0, 140, 0, 0.5, 4, 2, '#fff', '#fff', 1)
    expect(big.rects.length).toBeGreaterThan(small.rects.length * 5)
  })

  it('半径はドット格子の整数倍に丸まり、段で進む（連続的に膨らまない）', () => {
    const seen = new Set<number>()
    for (let i = 0; i <= 40; i++) {
      const { ctx, rects } = fakeCtx()
      pixelShockwave(ctx, 0, 0, 6, 30, i / 41, 4, 2, '#fff', '#fff', 1)
      const r = Math.round(rects[0].x + rects[0].w / 2)
      expect(r % 2).toBe(0)
      seen.add(r)
    }
    expect(seen.size).toBeLessThanOrEqual(4) // 段数どおり（滑らかに変化しない）
  })
})

describe('drawBullet（描かれる外縁が当たり半径ちょうどに一致する・#72 追加検証）', () => {
  /** fillRect を記録するだけの偽 ctx（save/restore は no-op）。 */
  const fakeCtx = () => {
    const rects: { x: number; y: number; w: number; h: number }[] = []
    return {
      rects,
      ctx: {
        save: () => {},
        restore: () => {},
        globalAlpha: 1,
        fillStyle: '',
        fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h }),
      } as unknown as CanvasRenderingContext2D,
    }
  }

  const BULLET_CASES = [
    { speed: 0, z: 0 }, // 弱い弾
    { speed: FIELD.maxFlightSpeed, z: FIELD.zPeak }, // 強い弾
  ]
  const BULLET_VPS: Viewport[] = [
    { width: 480, height: 480, unitsRadius: FIELD.rField }, // 小さい canvas
    { width: 1600, height: 1000, unitsRadius: FIELD.rField, zoom: 1.6 }, // 大きい canvas
  ]

  it('描かれる全ドットの四隅が当たり半径＋1ドット以内に収まる', () => {
    for (const vp of BULLET_VPS) {
      const unit = dotPx(vp)
      const cx = vp.width / 2
      const cy = vp.height / 2
      for (const c of BULLET_CASES) {
        const { ctx, rects } = fakeCtx()
        drawBullet(ctx, { x: 0, y: 0 }, c.z, vp, 1.0, c.speed)
        // tier の丸め（±unit/2）＋ドットの対角オフセット（unit×√2/2）を許容する
        const limit = bulletRadius(c.speed, c.z) * scaleOf(vp) + unit * 1.25
        for (const r of rects) {
          const corners = [
            { x: r.x, y: r.y },
            { x: r.x + r.w, y: r.y },
            { x: r.x, y: r.y + r.h },
            { x: r.x + r.w, y: r.y + r.h },
          ]
          for (const p of corners) {
            expect(Math.hypot(p.x - cx, p.y - cy)).toBeLessThanOrEqual(limit)
          }
        }
      }
    }
  })

  it('強い弾ほど描画の外縁が大きい（威力が段で読める）', () => {
    for (const vp of BULLET_VPS) {
      const cx = vp.width / 2
      const cy = vp.height / 2
      const reachOf = (c: { speed: number; z: number }) => {
        const { ctx, rects } = fakeCtx()
        drawBullet(ctx, { x: 0, y: 0 }, c.z, vp, 1.0, c.speed)
        return Math.max(
          0,
          ...rects.flatMap((r) => [
            Math.hypot(r.x - cx, r.y - cy),
            Math.hypot(r.x + r.w - cx, r.y + r.h - cy),
          ]),
        )
      }
      expect(reachOf(BULLET_CASES[1])).toBeGreaterThanOrEqual(reachOf(BULLET_CASES[0]))
    }
  })
})

describe('quantAlpha（なめらかなフェードを禁じる）', () => {
  it('段の数だけの値しか返さない', () => {
    const seen = new Set<number>()
    for (let i = 0; i <= 100; i++) seen.add(quantAlpha(i / 100, 4))
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('わずかでも残っている濃さは 0 に潰さない（粒が消えない）', () => {
    expect(quantAlpha(0.01)).toBeGreaterThan(0)
    expect(quantAlpha(0)).toBe(0)
  })
})

describe('walkPath（軌跡を弧長で等間隔に打ち直す）', () => {
  const line = [
    { pos: { x: 0, y: 0 } },
    { pos: { x: 10, y: 0 } },
    // 速い区間＝サンプルが粗い（ここで密度が落ちないことを見る）
    { pos: { x: 100, y: 0 } },
  ]

  it('サンプル間隔がばらついても歩幅どおりの等間隔で打つ', () => {
    const xs: number[] = []
    walkPath(line, 2, (p) => p.pos, 10, (x) => xs.push(x))
    expect(xs).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  })

  it('headFrac は 0（撃った所）→1（弾の頭）へ進む', () => {
    const fr: number[] = []
    walkPath(line, 2, (p) => p.pos, 25, (_x, _y, _s, _i, h) => fr.push(h))
    expect(fr[0]).toBe(0)
    expect(fr[fr.length - 1]).toBeCloseTo(1, 6)
    for (let i = 1; i < fr.length; i++) expect(fr[i]).toBeGreaterThan(fr[i - 1])
  })

  it('点が 1 個以下なら何も打たない', () => {
    let n = 0
    walkPath([{ pos: { x: 0, y: 0 } }], 0, (p) => p.pos, 4, () => n++)
    expect(n).toBe(0)
  })
})
