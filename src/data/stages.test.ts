import { describe, it, expect } from 'vitest'
import { STAGES } from './stages'
import { ROTATE_PRESETS, buildTrajectory } from '../game/functions'
import { createBattleState, prepareTurn, resolveAllyCasts } from '../game/battle'
import { planRuptorShot } from '../game/enemyAI'
import { makeParty, PARTY } from './party'
import { FIELD } from './constants'
import { dist } from '../game/coords'
import { isSolidAt, materialCells } from '../game/obstacle'
import type { Obstacle, Trajectory, Vec2 } from '../game/types'

/** 線分 a→e のどこかが障害物の素材に当たるか（直線で射線が通らない＝壁で遮られる）。 */
function segmentBlocked(a: Vec2, e: Vec2, obstacles: Obstacle[]): boolean {
  const steps = 300
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const p = { x: a.x + (e.x - a.x) * t, y: a.y + (e.y - a.y) * t }
    for (const o of obstacles) if (isSolidAt(o, p)) return true
  }
  return false
}

describe('ステージ定義（機能14・#15）', () => {
  it('3ステージ以上ある', () => {
    expect(STAGES.length).toBeGreaterThanOrEqual(3)
  })

  it('段階的導入：序盤は命中だけ、後半は敵弾・障害物が登場', () => {
    expect(STAGES[0].mechanics).toEqual({ obstacles: false, enemyFire: false })
    const last = STAGES[STAGES.length - 1]
    expect(last.mechanics.enemyFire).toBe(true)
  })

  it('敵・障害物ブロブは場内に配置され、HP/円は正', () => {
    for (const s of STAGES) {
      // 場の半径は面ごとに可変（#49・06b §5.5）。未指定は既定 rField。
      const rField = s.rField ?? FIELD.rField
      expect(s.enemies.length).toBeGreaterThan(0)
      expect(s.introText.length).toBeGreaterThan(0)
      expect(s.clearText.length).toBeGreaterThan(0)
      for (const e of s.enemies) {
        expect(dist(e.pos)).toBeLessThan(rField)
        expect(e.hp).toBeGreaterThan(0)
      }
      for (const o of s.obstacles) {
        const rects = o.rects ?? []
        // 素材は円（solids）か矩形（rects・#56）のどちらかで構成される
        expect(o.solids.length + rects.length).toBeGreaterThan(0)
        expect(o.carves).toEqual([])
        for (const d of o.solids) {
          expect(dist({ x: d.x, y: d.y })).toBeLessThan(rField)
          expect(d.r).toBeGreaterThan(0)
        }
        for (const r of rects) {
          expect(r.w).toBeGreaterThan(0)
          expect(r.h).toBeGreaterThan(0)
          // 翼壁（#50）は境界ぎわの回り込み抜けを塞ぐため、外側の縁を場境界まで（＝わずかに場外へ）
          // 伸ばす必要がある。円形の場では矩形の外側の角が境界円を必ずはみ出すので、翼壁は例外扱い。
          const isWingWall = o.kind === 'unbreakable' && o.element === 'neutral' && Math.max(Math.abs(r.x), Math.abs(r.x + r.w)) > 15
          if (isWingWall) {
            // 翼壁：内側の角は場内、外側の縁は境界へ到達（sealing）していること
            const innerX = Math.abs(r.x) < Math.abs(r.x + r.w) ? r.x : r.x + r.w
            const outerX = Math.abs(r.x) < Math.abs(r.x + r.w) ? r.x + r.w : r.x
            expect(dist({ x: innerX, y: r.y })).toBeLessThan(rField)
            expect(dist({ x: innerX, y: r.y + r.h })).toBeLessThan(rField)
            // 外縁は場境界以上（|x| >= rField）まで伸び、帯の側面を塞ぐ
            expect(Math.abs(outerX)).toBeGreaterThanOrEqual(rField)
          } else {
            // 通常の障害物は四隅とも場内（矩形の全4角）
            expect(dist({ x: r.x, y: r.y })).toBeLessThan(rField)
            expect(dist({ x: r.x + r.w, y: r.y })).toBeLessThan(rField)
            expect(dist({ x: r.x, y: r.y + r.h })).toBeLessThan(rField)
            expect(dist({ x: r.x + r.w, y: r.y + r.h })).toBeLessThan(rField)
          }
        }
      }
    }
  })

  it('障害物ありステージは開始時、全ての味方→敵の直線が壁で遮られる', () => {
    for (const s of STAGES) {
      if (!s.mechanics.obstacles) continue // チュートリアル等は直線可
      // 第4面は包囲構成（#49・敵が全方位）がテーマで「正面の壁」の概念がないため除外（06b §5.6）
      if (s.id === 'stage-4') continue
      for (const a of PARTY) {
        for (const e of s.enemies) {
          // 第6面の崩し手（#63）：封印帯の「前」に放たれた前衛＝意図的に開けた場所に立つ
          // （暴発弾が初手から届き、予告✕を結界で受ける学習をさせる）。遮蔽の不変条件から除外
          if (s.id === 'stage-6' && e.role === 'ruptor') continue
          expect(segmentBlocked(a.pos, e.pos, s.obstacles)).toBe(true)
        }
      }
    }
  })
})

describe('難易度フレームワーク（06b）', () => {
  it('castInitialSpeed は既定 8 固定（例外は第6面の崩し手=6.5・#63）', () => {
    for (const s of STAGES) {
      for (const e of s.enemies) {
        if (s.id === 'stage-6' && e.role === 'ruptor') {
          // 遅い暴発弾（#63）：予告を見て反対極の結界1枚を張れば確実に受け切れる速度
          expect(e.castInitialSpeed).toBe(6.5)
        } else {
          expect(e.castInitialSpeed).toBe(8)
        }
      }
    }
  })

  it('迂回型・暴発型は line family を持たない（05b §2）', () => {
    for (const s of STAGES) {
      for (const e of s.enemies) {
        const role = e.role ?? 'attacker'
        if (role !== 'attacker' && role !== 'ruptor') continue
        // attacker（迂回型）は line を含んでもよいのは第1面（迂回パターン未解禁）のみ
        if (role === 'ruptor') {
          expect(e.family).not.toBe('line')
          expect(e.families ?? []).not.toContain('line')
        }
      }
    }
  })

  it('第4面に暴発デモ（障害物狙い・低頻度）の崩し手が1体いる', () => {
    const demos = STAGES[3].enemies.filter((e) => e.role === 'ruptor')
    expect(demos).toHaveLength(1)
    expect(demos[0].ruptorTarget).toBe('obstacles')
    expect(demos[0].fireEvery).toBe(2)
    // 1ターン目に必ず撃つ（最低1回は暴発を見せる）
    expect((1 + (demos[0].fireOffset ?? 0)) % (demos[0].fireEvery ?? 1)).toBe(0)
  })

  it('第4面のデモ崩し手は、壁の近傍に暴発点つきの計画を返す（RUPTOR_DEMO）', () => {
    const s4 = STAGES[3]
    const demo = s4.enemies.find((e) => e.role === 'ruptor')!
    const obstacles = s4.obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
    const plan = planRuptorShot(demo, makeParty(), obstacles)
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    // 暴発点はいずれかの壁素材の近く（円・矩形とも・#56）
    const nearWall = obstacles.some((o) =>
      materialCells(o).some((d) => dist({ x: d.x, y: d.y }, plan!.misfirePos!) <= FIELD.aoeRadius + d.r),
    )
    expect(nearWall).toBe(true)
  })

  it('第4面：味方が迎撃しなければ、1ターン目にデモの暴発が解決する', () => {
    const st = createBattleState(STAGES[3], 3, makeParty())
    const prep = prepareTurn(st)
    expect(prep.castingEnemyIds.some((id) => prep.state.enemies.find((e) => e.id === id)?.role === 'ruptor')).toBe(true)
    const { resolution } = resolveAllyCasts(prep.state, [], prep.castingEnemyIds)
    expect(resolution.misfires.filter((m) => m.owner === 'enemy').length).toBeGreaterThanOrEqual(1)
  })

  it('第6面に崩し手3体（低頻度・位相ずらし）と交互張りの守護型がいる', () => {
    const ruptors = STAGES[5].enemies.filter((e) => e.role === 'ruptor')
    expect(ruptors).toHaveLength(3)
    for (const r of ruptors) expect(r.fireEvery).toBe(2)
    expect(new Set(ruptors.map((r) => r.fireOffset)).size).toBeGreaterThan(1) // タイミングが揃わない
    const guardian = STAGES[5].enemies.find((e) => e.role === 'guardian')
    expect(guardian?.alternatingAura).toBe(true)
  })

  it('第7面ボスは多重詠唱（2本→フェーズで3本）と HP フェーズを持つ', () => {
    const s7 = STAGES[6]
    const boss = s7.enemies.find((e) => e.boss)!
    expect(boss.castCount).toBe(2)
    expect(boss.patternPool).toEqual(['breaker', 'attacker'])
    expect(s7.bossPhases).toHaveLength(2)
    expect(s7.bossPhases![0]).toMatchObject({ hpBelow: 0.66, castCount: 2 })
    expect(s7.bossPhases![1]).toMatchObject({ hpBelow: 0.33, castCount: 3, cullMinions: true })
    // 最下層は障害物なし（逃げ場が少ない）
    expect(s7.bossPhases![1].obstacles).toHaveLength(0)
  })
})

describe('フィールド半径 rField（#49・06b §5.5）', () => {
  it('面ごとに rField が設定される（高難度面ほど広め）', () => {
    // 1面は既定（未指定＝FIELD.rField）、2〜3面はやや広め、5〜6面は広め、7面上層はさらに広い
    expect(STAGES[0].rField ?? FIELD.rField).toBe(FIELD.rField)
    expect(STAGES[1].rField).toBe(32)
    expect(STAGES[2].rField).toBe(34)
    expect(STAGES[3].rField).toBe(32)
    expect(STAGES[4].rField).toBe(36)
    expect(STAGES[5].rField).toBe(36)
    expect(STAGES[6].rField).toBe(35)
  })

  it('第7面 bossPhases で rField が段階的に縮小する（床崩落）', () => {
    const phases = STAGES[6].bossPhases!
    expect(phases[0].rField).toBe(28)
    expect(phases[1].rField).toBe(24)
    // 縮小してもボス（y=23）は場内に残る（dist 23 < 24）
    const boss = STAGES[6].enemies.find((e) => e.boss)!
    expect(dist(boss.pos)).toBeLessThan(phases[1].rField!)
  })
})

describe('翼壁（#50・06b §5.6）', () => {
  /** 帯の外側〜境界の間（側面帯）の点が、いずれかの unbreakable 素材で塞がれているか。 */
  function sideBandBlocked(s: (typeof STAGES)[number], sideX: number): boolean {
    const rField = s.rField ?? FIELD.rField
    // 帯の端（|x|=18〜19）より外側で、場内に収まる y をいくつか試す
    for (let y = -8; y <= 12; y += 1) {
      const x = sideX
      if (dist({ x, y }) >= rField) continue
      const blocked = s.obstacles.some((o) => isSolidAt(o, { x, y }))
      if (blocked) return true
    }
    return false
  }

  it.each([
    ['第2面', 1],
    ['第3面', 2],
    ['第5面', 4],
    ['第6面', 5],
  ])('%s：帯の外側の側面帯が素材で塞がれている（両側）', (_name, idx) => {
    const s = STAGES[idx]
    // 帯（x∈[-18,18]）の外側 x=22（右）/ x=-22（左）に翼壁の素材があること
    expect(sideBandBlocked(s, 22)).toBe(true)
    expect(sideBandBlocked(s, -22)).toBe(true)
  })

  it('翼壁は unbreakable（削って抜けられない・§5.6）', () => {
    // 第2面の x≈24 付近の壁素材を含む障害物は unbreakable であること
    const s2 = STAGES[1]
    const wing = s2.obstacles.find((o) => isSolidAt(o, { x: 24, y: 2 }))
    expect(wing).toBeDefined()
    expect(wing!.kind).toBe('unbreakable')
  })
})

describe('図鑑（05c）との整合', () => {
  it('図鑑のHP値と一致する', () => {
    const hpOf = (idx: number, name: string) =>
      STAGES[idx].enemies.find((e) => e.name === name)!.hp
    expect(hpOf(1, '回廊の衛士')).toBe(110)
    expect(hpOf(1, '影の射手')).toBe(105)
    expect(hpOf(2, '祭壇の影')).toBe(110)
    expect(hpOf(2, '白の祭司')).toBe(130)
    expect(hpOf(3, '坑道の弓手')).toBe(125)
    expect(hpOf(3, '渦の番兵')).toBe(140)
    expect(hpOf(4, '鏡像の衛士（光）')).toBe(125)
    expect(hpOf(4, '鏡像の射手（闇）')).toBe(120)
    expect(hpOf(5, '封印の番人')).toBe(180)
    expect(STAGES[6].enemies.find((e) => e.name === '守護者の眷属（迂回）')!.hp).toBe(130)
    expect(STAGES[6].enemies.find((e) => e.boss)!.hp).toBe(380)
  })

  it('第5面に鏡守のゴーレム（守護型・方向づけ場・単色）がいる', () => {
    const golem = STAGES[4].enemies.find((e) => e.name === '鏡守のゴーレム')
    expect(golem).toBeDefined()
    expect(golem!.role).toBe('guardian')
    expect(golem!.directedAura).toBe(true)
    expect(golem!.species).toBe('golem')
    // 中難度：LVL5 並のHP（150〜165 で決めてよい）
    expect(golem!.hp).toBeGreaterThanOrEqual(150)
    expect(golem!.hp).toBeLessThanOrEqual(165)
  })

  it('第6面の崩し手3体は abs/arc/poly34 を各体で分けて持つ（#46）', () => {
    const ruptors = STAGES[5].enemies.filter((e) => e.role === 'ruptor')
    const fams = ruptors.map((r) => r.family)
    expect(new Set(fams)).toEqual(new Set(['abs', 'arc', 'poly34']))
    // 迂回型・暴発型の制約：wave/exp/line/spiral を含まない
    for (const r of ruptors) {
      expect(['abs', 'arc', 'poly34']).toContain(r.family)
    }
  })

  it('第6面の封印の番人は交互張り＋方向づけ併用（最上位ゴーレム）', () => {
    const guardian = STAGES[5].enemies.find((e) => e.role === 'guardian')!
    expect(guardian.alternatingAura).toBe(true)
    expect(guardian.directedAura).toBe(true)
  })

  it('石像の番人以外は species を持ち、原型は proto', () => {
    expect(STAGES[0].enemies[0].species).toBe('proto')
    // 非ボスの敵はすべて species が付く（ボスは未設定でよい）
    for (const s of STAGES) {
      for (const e of s.enemies) {
        if (e.boss) continue
        expect(e.species).toBeDefined()
      }
    }
  })
})

describe('エンジンとの結線（スモーク）', () => {
  it('ステージ1でおすすめ光線を敵に当てるとHPが減る', () => {
    const stage = STAGES[0]
    const target = stage.enemies[0]
    const party = makeParty()
    const caster = party[1] // 中央の術者
    // おすすめ：敵の反対極を作る直線 g(x)=a·x（闇の敵→光 a=1）
    const a = target.element === 'light' ? -1 : 1
    const line = ROTATE_PRESETS[0]
    const angle = Math.atan2(target.pos.y - caster.pos.y, target.pos.x - caster.pos.x) - Math.atan(a)
    // 属性は z 場で別指定（#30）：敵の反対極を、減速しない zRef で当てる（#31：zPeak は失速して届かない）
    const zConst = target.element === 'light' ? -FIELD.zRef : FIELD.zRef
    const trajectory: Trajectory = { ...buildTrajectory(line, { a, b: 0 }, angle, caster.pos), z: () => zConst }

    let s = createBattleState(stage, 0, party)
    const prep = prepareTurn(s)
    const out = resolveAllyCasts(prep.state, [{ allyId: caster.id, trajectory, initialSpeed: FIELD.fixedSpeed }], prep.castingEnemyIds)
    s = out.state
    expect(s.enemies[0].hp).toBeLessThan(target.maxHp)
  })
})
