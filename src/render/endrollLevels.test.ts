// エンドロールの LVL 進行（#76）：本編の敵 LVL と同じ 1〜7 まで上がり、
// **LVL が上がるほど壁は硬く・視線を塞ぐ壁が増え・経路が複雑になる**ことを固定する。
// 同時に「進行が止まらない」条件（どの LVL でも回り込める道が残る）も押さえる：
// エンドロールは決着（KO）でしか LVL が進まないので、道が完全に塞がると同じ幕を延々と繰り返す。
import { describe, it, expect } from 'vitest'
import {
  FAMILY_TABLE,
  MAGE_CLEAR,
  MAX_LEVEL,
  MAX_RUPTORS,
  POS_A,
  POS_B,
  SHOTS,
  blockerCount,
  kindPool,
  makeObstacles,
  obstacleCount,
  rolePool,
} from './endroll'
import { buildPlanningEnv } from '../game/enemyPlanning/planningEnv'
import { findRoute } from '../game/enemyPlanning/routeSearch'
import { isSolidAt } from '../game/obstacle'
import { FIELD } from '../data/constants'
import type { Obstacle, Vec2 } from '../game/types'

const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1)
/** 耐久の硬さ順（大きいほど硬い）。 */
const HARDNESS: Record<string, number> = { fragile: 0, normal: 1, tough: 2, unbreakable: 3 }
const meanHardness = (level: number): number => {
  const pool = kindPool(level)
  return pool.reduce((s, k) => s + HARDNESS[k], 0) / pool.length
}

/** A→B の直線が壁に触れるか（＝直進では届かない配置か）。 */
function sightBlocked(obstacles: Obstacle[]): boolean {
  const n = 200
  for (let i = 0; i <= n; i++) {
    const p: Vec2 = { x: POS_A.x + ((POS_B.x - POS_A.x) * i) / n, y: POS_A.y + ((POS_B.y - POS_A.y) * i) / n }
    if (obstacles.some((o) => isSolidAt(o, p))) return true
  }
  return false
}

describe('エンドロール：本編と同じ LVL1〜7 まで上がる（#76）', () => {
  it('LVL ごとの表が最大 LVL まで揃っている（途中で頭打ちにならない）', () => {
    expect(MAX_LEVEL).toBe(7) // 本編の敵 LVL の上限（ENEMY_FIT_COMPLEXITY の最上段）と同じ
    expect(SHOTS).toHaveLength(MAX_LEVEL)
    expect(FAMILY_TABLE).toHaveLength(MAX_LEVEL)
  })

  it('同時発射数は LVL とともに増える（減りはしない）', () => {
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i]).toBeGreaterThanOrEqual(SHOTS[i - 1])
    expect(SHOTS[SHOTS.length - 1]).toBeGreaterThan(SHOTS[0])
  })

  it('暴発型（ruptor）は最上位でも1発まで＝1ターンで相打ちにならない', () => {
    // 暴発のダメージは固定 180（sMax×maxFlightSpeed×opposite）で HP140 を一撃で消し飛ばし、
    // AoE は距離だけで判定するので壁で遮れない。2発持たせると両陣営が初手で相打ちになる
    // （実測：どちらか1ターンKO 73% / 相打ち 48% → 1発化で 32% / 2%）
    for (const lv of LEVELS) {
      for (const side of ['A', 'B'] as const) {
        for (const bout of [0, 1]) {
          const n = rolePool(side, lv, bout).filter((r) => r === 'ruptor').length
          expect(n, `LVL${lv} ${side} bout${bout}`).toBeLessThanOrEqual(MAX_RUPTORS)
        }
      }
    }
    expect(MAX_RUPTORS).toBe(1)
    // 最上位では実際に1発は出る（暴発の振る舞いもエンドロールで一通り見せる）
    expect(rolePool('A', MAX_LEVEL, 0)).toContain('ruptor')
  })

  it('多重サイン（harmonic）は終盤の LVL だけが持つ（05b §2 の解禁順を守る）', () => {
    const hasHarmonic = (lv: number): boolean =>
      [...FAMILY_TABLE[lv - 1].A, ...FAMILY_TABLE[lv - 1].B].includes('harmonic')
    for (const lv of LEVELS) expect(hasHarmonic(lv), `LVL${lv}`).toBe(lv >= 6)
  })
})

describe('エンドロール：LVL が上がるほど壁が硬くなる（#76）', () => {
  it('耐久の平均は LVL とともに単調に上がり、最上位は最下位より確実に硬い', () => {
    for (let lv = 2; lv <= MAX_LEVEL; lv++) {
      expect(meanHardness(lv), `LVL${lv}`).toBeGreaterThanOrEqual(meanHardness(lv - 1))
    }
    expect(meanHardness(MAX_LEVEL)).toBeGreaterThan(meanHardness(1))
  })

  it('どの LVL でも unbreakable は使わない（削れない壁は進行を止めうる）', () => {
    for (const lv of LEVELS) expect(kindPool(lv)).not.toContain('unbreakable')
  })

  it('最上位は tough だけ＝一撃では抜けない（LVL7 の一撃決着を減らす）', () => {
    expect(kindPool(MAX_LEVEL).every((k) => k === 'tough')).toBe(true)
  })

  it('視線を塞ぐ壁は LVL とともに太くなる（削り半径の上限が小さいので太さ＝耐久）', () => {
    // 配置は乱数なので、A→B 線の近くにある壁の平均半径で比べる
    const avgBlockerR = (lv: number): number => {
      let sum = 0
      let n = 0
      for (let i = 0; i < 20; i++) {
        for (const o of makeObstacles(lv)) {
          const s = o.solids[0]
          const t =
            ((s.x - POS_A.x) * (POS_B.x - POS_A.x) + (s.y - POS_A.y) * (POS_B.y - POS_A.y)) /
            ((POS_B.x - POS_A.x) ** 2 + (POS_B.y - POS_A.y) ** 2)
          if (t < 0.2 || t > 0.8) continue
          const px = POS_A.x + (POS_B.x - POS_A.x) * t
          const py = POS_A.y + (POS_B.y - POS_A.y) * t
          if (Math.hypot(s.x - px, s.y - py) > s.r) continue // 線上に無い＝散らした壁
          sum += s.r
          n++
        }
      }
      return n ? sum / n : 0
    }
    expect(avgBlockerR(MAX_LEVEL)).toBeGreaterThan(avgBlockerR(1))
  })

  it('最上位の視線を塞ぐ壁は「厚い衝立」＝円を重ねて奥行きを持つ（掘り抜くのに発数が要る）', () => {
    // LVL7 では blockerCount 本ぶんが複数円のブロブになる（散らす壁は 1 円のまま）
    const slabs = (lv: number): number => {
      let n = 0
      for (let i = 0; i < 10; i++) n += makeObstacles(lv).filter((o) => o.solids.length > 1).length
      return n / 10
    }
    expect(slabs(MAX_LEVEL)).toBeGreaterThan(0)
    expect(slabs(1)).toBe(0)
  })
})

describe('エンドロール：LVL が上がるほど経路が複雑になる（#76）', () => {
  it('視線を塞ぐ壁の本数が LVL とともに増える（1本→2本→3本）', () => {
    for (let lv = 2; lv <= MAX_LEVEL; lv++) {
      expect(blockerCount(lv), `LVL${lv}`).toBeGreaterThanOrEqual(blockerCount(lv - 1))
    }
    expect(blockerCount(1)).toBe(1)
    expect(blockerCount(MAX_LEVEL)).toBeGreaterThan(blockerCount(1))
  })

  it('壁の本数は LVL とともに増える', () => {
    // 配置は乱数なので、各 LVL を数回引いた平均で比べる（置けなかったぶんのブレを均す）
    const avgCount = (lv: number): number => {
      let sum = 0
      for (let i = 0; i < 12; i++) sum += makeObstacles(lv).length
      return sum / 12
    }
    for (let lv = 2; lv <= MAX_LEVEL; lv++) {
      expect(obstacleCount(lv), `LVL${lv} の名目本数`).toBeGreaterThanOrEqual(obstacleCount(lv - 1))
    }
    // 実配置（置けた本数）でも増えている。名目だけ増やして置けていない、を防ぐ
    expect(avgCount(MAX_LEVEL)).toBeGreaterThan(avgCount(1) + 4)
    expect(avgCount(MAX_LEVEL)).toBeGreaterThan(8)
  })

  it('術者の周囲だけは障害物が少ない（撃ち出しと着弾の周りを埋めない）', () => {
    // 素材の縁までの距離で測る。視線を塞ぐ壁は線上に置く必要があるので余白は控えめ、
    // 散らす壁は大きく空ける＝術者の周りにぽっかり空いた場ができる
    for (const lv of LEVELS) {
      for (let i = 0; i < 5; i++) {
        for (const o of makeObstacles(lv)) {
          for (const s of o.solids) {
            const gap = Math.min(
              Math.hypot(s.x - POS_A.x, s.y - POS_A.y),
              Math.hypot(s.x - POS_B.x, s.y - POS_B.y),
            ) - s.r
            expect(gap, `LVL${lv}: 術者に近すぎる壁 ${o.id}`).toBeGreaterThan(MAGE_CLEAR.blocker - 1e-6)
          }
        }
      }
    }
    expect(MAGE_CLEAR.scatter).toBeGreaterThan(MAGE_CLEAR.blocker)
  })

  it('どの LVL でも直進では届かず、かつ回り込める道は必ず残る（進行が止まらない）', () => {
    for (const lv of LEVELS) {
      for (let i = 0; i < 5; i++) {
        const obstacles = makeObstacles(lv)
        expect(sightBlocked(obstacles), `LVL${lv}: 直線が通ってしまう`).toBe(true)
        const env = buildPlanningEnv(obstacles, FIELD.rField)
        expect(findRoute(env, POS_A, POS_B, 'clean'), `LVL${lv}: 迂回路が無い`).not.toBeNull()
      }
    }
  })
})
