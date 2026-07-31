import { describe, it, expect } from 'vitest'
import { STAGES } from './stages'
import { ROTATE_PRESETS, buildTrajectory } from '../game/functions'
import { createBattleState, prepareTurn, resolveAllyCasts } from '../game/battle'
import { planRuptorShot } from '../game/enemyAI'
import { buildPlanningEnv } from '../game/enemyPlanning/planningEnv'
import { findRoute } from '../game/enemyPlanning/routeSearch'
import { makeParty } from './party'
import { FIELD, GAME } from './constants'
import { dist } from '../game/coords'
import { isSolidAt, materialCells } from '../game/obstacle'
import type { Obstacle, Stage, Trajectory, Vec2 } from '../game/types'

/** 面の味方初期位置（未指定なら PARTY の既定位置）。 */
const alliesOf = (s: Stage): Vec2[] => s.allyPositions ?? makeParty().map((a) => a.pos)

/** 線分 a→b が素材（障害物）に一度でも触れるか。 */
function blockedLine(obstacles: Obstacle[], a: Vec2, b: Vec2, kinds?: (string | undefined)[]): boolean {
  const L = dist(a, b)
  if (L < 1e-9) return false
  for (let d = 0; d <= L; d += 0.25) {
    const p = { x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L }
    if (obstacles.some((o) => (!kinds || kinds.includes(o.kind)) && isSolidAt(o, p))) return true
  }
  return false
}

describe('ステージ定義（機能14・#15）', () => {
  it('想定プレイ時間 15〜30 分に収まる 5 面構成（#69）', () => {
    expect(STAGES).toHaveLength(5)
    expect(STAGES[STAGES.length - 1].boss).toBe(true)
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
        // 部屋の囲い（roomWalls/chamber）は「四方を壁で囲う」ため境界の外まで伸ばして密封する
        // （unbreakable の中立壁）。円形の場では外縁が境界円を必ず超えるので、この種の囲い壁は
        // 厳密な四隅在場内の制約を免除する（内部障害物のみ場内を要求）。
        const isSealWall = o.kind === 'unbreakable' && o.element === 'neutral'
        for (const r of rects) {
          expect(r.w).toBeGreaterThan(0)
          expect(r.h).toBeGreaterThan(0)
          if (isSealWall) continue
          expect(dist({ x: r.x, y: r.y })).toBeLessThan(rField)
          expect(dist({ x: r.x + r.w, y: r.y })).toBeLessThan(rField)
          expect(dist({ x: r.x, y: r.y + r.h })).toBeLessThan(rField)
          expect(dist({ x: r.x + r.w, y: r.y + r.h })).toBeLessThan(rField)
        }
      }
    }
  })

  it('全ステージが四方を壁で囲われている（部屋型・回り込み不可）', () => {
    for (const s of STAGES) {
      const rField = s.rField ?? FIELD.rField
      let sealed = 0
      const N = 72
      for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2
        const p = { x: (rField - 1.5) * Math.cos(th), y: (rField - 1.5) * Math.sin(th) }
        if (s.obstacles.some((o) => isSolidAt(o, p))) sealed++
      }
      expect(sealed).toBeGreaterThan(N / 2)
    }
  })

  it('部屋の囲い壁は unbreakable（削って部屋の外へ抜けられない）', () => {
    for (const s of STAGES) {
      const rField = s.rField ?? FIELD.rField
      const hasSeal = s.obstacles.some(
        (o) =>
          o.kind === 'unbreakable' &&
          o.element === 'neutral' &&
          (o.rects ?? []).some(
            (r) =>
              Math.max(Math.abs(r.x), Math.abs(r.x + r.w)) >= rField ||
              Math.max(Math.abs(r.y), Math.abs(r.y + r.h)) >= rField,
          ),
      )
      expect(hasSeal).toBe(true)
    }
  })
})

// ===== #69：新レイアウトの一般則（面ごとの決め打ちでなく、全面へ機械的に課す条件） =====
describe('レイアウトの一般則（#69）', () => {
  it('第1面以外：味方から敵への直線は必ず遮蔽で塞がれている', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const s = STAGES[i]
      for (const a of alliesOf(s)) {
        for (const e of s.enemies) {
          expect(blockedLine(s.obstacles, a, e.pos), `${s.name} / ${e.name}`).toBe(true)
        }
      }
    }
  })

  it('第1面は直線で届く（命中だけを学ぶチュートリアル）', () => {
    // 障害物の当たり判定自体が無効な面（装飾の部屋枠のみ）
    expect(STAGES[0].mechanics.obstacles).toBe(false)
  })

  it('味方は面ごとに散開している（横幅・相互距離とも十分に離す）', () => {
    for (const s of STAGES) {
      const allies = alliesOf(s)
      let minD = Infinity
      for (let a = 0; a < allies.length; a++) {
        for (let b = a + 1; b < allies.length; b++) minD = Math.min(minD, dist(allies[a], allies[b]))
      }
      const width = Math.max(...allies.map((p) => p.x)) - Math.min(...allies.map((p) => p.x))
      const depth = Math.max(...allies.map((p) => p.y)) - Math.min(...allies.map((p) => p.y))
      expect(minD, `${s.name} の味方間隔`).toBeGreaterThanOrEqual(10)
      expect(width, `${s.name} の横幅`).toBeGreaterThanOrEqual(18)
      expect(depth, `${s.name} の前後差`).toBeGreaterThan(2) // 横一列に並べない
    }
  })

  it('味方も敵も素材に埋まっていない', () => {
    for (const s of STAGES) {
      for (const p of alliesOf(s)) expect(s.obstacles.some((o) => isSolidAt(o, p))).toBe(false)
      for (const e of s.enemies) {
        expect(s.obstacles.some((o) => isSolidAt(o, e.pos)), `${s.name} / ${e.name}`).toBe(false)
      }
    }
  })

  it('味方は自分の周りに結界（半径7.5）を張れるだけの余地を持つ（#69）', () => {
    // 結界は壁に触れると霧散する（#34）。散開させた各味方が「自分を守る」選択を取れることを
    // レイアウトの成立条件として固定する（敵の守護型と同じ半径7の結界＋余裕。
    // 第1面は障害物の当たり判定が無いので対象外）。
    for (let i = 1; i < STAGES.length; i++) {
      const s = STAGES[i]
      for (const p of alliesOf(s)) {
        for (let k = 0; k < 48; k++) {
          const t = (k / 48) * Math.PI * 2
          const q = { x: p.x + 7.5 * Math.cos(t), y: p.y + 7.5 * Math.sin(t) }
          expect(s.obstacles.some((o) => isSolidAt(o, q)), `${s.name} (${p.x},${p.y})`).toBe(false)
        }
      }
    }
  })

  it('迂回型（attacker）は最寄り味方への直射線が遮蔽で塞がれている＝陰に隠れて曲射する', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const s = STAGES[i]
      const allies = alliesOf(s)
      for (const e of s.enemies) {
        const role = e.role ?? 'attacker'
        if (role !== 'attacker') continue
        const nearest = allies.reduce((b, p) => (dist(e.pos, p) < dist(e.pos, b) ? p : b))
        expect(blockedLine(s.obstacles, e.pos, nearest), `${s.name} / ${e.name}`).toBe(true)
      }
    }
  })

  it('火力型（breaker）は守護型／ボスの結界の内側にいる＝守られながら壁を割る', () => {
    for (const s of STAGES) {
      const protectors = s.enemies.filter((e) => e.role === 'guardian' || e.boss)
      if (protectors.length === 0) continue
      for (const e of s.enemies.filter((x) => x.role === 'breaker')) {
        const d = Math.min(...protectors.map((p) => dist(e.pos, p.pos)))
        // 結界（半径 enemyGuardRadius）の内側に「余裕をもって」入る条件（planGuardianOrbit の coverOf）
        expect(d, `${s.name} / ${e.name}`).toBeLessThanOrEqual(GAME.enemyGuardRadius - 1)
      }
    }
  })

  it('暴発型（ruptor）は至近（8以内）に遮蔽を持ち、半身を隠している', () => {
    for (const s of STAGES) {
      for (const e of s.enemies.filter((x) => x.role === 'ruptor')) {
        const near = s.obstacles.some(
          (o) =>
            o.solids.some((d) => dist({ x: d.x, y: d.y }, e.pos) <= 8 + d.r) ||
            (o.rects ?? []).some((r) => {
              const cx = Math.max(r.x, Math.min(e.pos.x, r.x + r.w))
              const cy = Math.max(r.y, Math.min(e.pos.y, r.y + r.h))
              return dist({ x: cx, y: cy }, e.pos) <= 8
            }),
        )
        expect(near, `${s.name} / ${e.name}`).toBe(true)
      }
    }
  })

  it('敵から各味方へ素材に触れない経路が存在する（＝敵AIが曲げて攻撃できる）', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const s = STAGES[i]
      const env = buildPlanningEnv(s.obstacles, s.rField)
      for (const e of s.enemies) {
        for (const a of alliesOf(s)) {
          expect(findRoute(env, e.pos, a, 'clean'), `${s.name} / ${e.name}`).not.toBeNull()
        }
      }
    }
  })

  it('内部の戦術壁・柱は tough（数撃かけないと崩れない）', () => {
    const toughCount = (idx: number) => STAGES[idx].obstacles.filter((o) => o.kind === 'tough').length
    expect(toughCount(1)).toBeGreaterThanOrEqual(3) // 第2面：柱列＋崩れた塔2基
    expect(toughCount(2)).toBeGreaterThanOrEqual(8) // 第3面：三列の列柱＋折れた列柱＋塔＋崩落壁
    expect(toughCount(3)).toBeGreaterThanOrEqual(6) // 第4面：三列の柱＋崩し手カバー3＋封印壁
    expect(toughCount(4)).toBeGreaterThanOrEqual(5) // 第5面①：盾＋三列の列柱＋塔
    // 第5面②（bossPhases）：崩落後の大広間に残る柱・短壁も tough
    for (const o of STAGES[4].bossPhases![0].obstacles!) expect(o.kind).toBe('tough')
  })
})

describe('難易度フレームワーク（06b）', () => {
  it('castInitialSpeed は既定 8 固定（例外は封印帯の崩し手=6.5・#63）', () => {
    for (const s of STAGES) {
      for (const e of s.enemies) {
        if (s.id === 'stage-4' && e.role === 'ruptor') {
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
        if (role === 'ruptor') {
          expect(e.family).not.toBe('line')
          expect(e.families ?? []).not.toContain('line')
        }
      }
    }
  })

  it('第3面に暴発デモ（障害物狙い・低頻度）の崩し手が1体いる', () => {
    const demos = STAGES[2].enemies.filter((e) => e.role === 'ruptor')
    expect(demos).toHaveLength(1)
    expect(demos[0].ruptorTarget).toBe('obstacles')
    expect(demos[0].fireEvery).toBe(2)
    // 1ターン目に必ず撃つ（最低1回は暴発を見せる）
    expect((1 + (demos[0].fireOffset ?? 0)) % (demos[0].fireEvery ?? 1)).toBe(0)
  })

  it('第3面のデモ崩し手は、壁の近傍に暴発点つきの計画を返す（RUPTOR_DEMO）', () => {
    const s3 = STAGES[2]
    const demo = s3.enemies.find((e) => e.role === 'ruptor')!
    const obstacles = s3.obstacles.map((o) => ({ ...o, carves: [...o.carves] }))
    const party = makeParty().map((a, i) => ({ ...a, pos: alliesOf(s3)[i] ?? a.pos }))
    const plan = planRuptorShot(demo, party, obstacles)
    expect(plan).not.toBeNull()
    expect(plan!.misfirePos).not.toBeNull()
    // 暴発点はいずれかの壁素材の近く（円・矩形とも・#56）
    const nearWall = obstacles.some((o) =>
      materialCells(o).some((d) => dist({ x: d.x, y: d.y }, plan!.misfirePos!) <= FIELD.aoeRadius + d.r),
    )
    expect(nearWall).toBe(true)
  })

  it('第3面：味方が迎撃しなければ、1ターン目にデモの暴発が解決する', () => {
    const st = createBattleState(STAGES[2], 2, makeParty())
    const prep = prepareTurn(st)
    expect(prep.castingEnemyIds.some((id) => prep.state.enemies.find((e) => e.id === id)?.role === 'ruptor')).toBe(true)
    const { resolution } = resolveAllyCasts(prep.state, [], prep.castingEnemyIds)
    expect(resolution.misfires.filter((m) => m.owner === 'enemy').length).toBeGreaterThanOrEqual(1)
    // デモの暴発は味方を巻き込まない（顔見せ演出のまま）
    const demo = resolution.enemyShots.find((s) => s.misfired)!
    for (const a of prep.state.allies) {
      expect(dist(a.pos, demo.misfirePos!)).toBeGreaterThan(FIELD.aoeRadius + 1)
    }
    // 崩し手自身も巻き込まない（#65：自爆しない場所を選ぶ。危険圏は上振れ込み）
    const caster = prep.state.enemies.find((e) => e.id === demo.enemyId)!
    expect(dist(caster.pos, demo.misfirePos!)).toBeGreaterThan(FIELD.aoeRadius)
    expect(resolution.enemies.find((e) => e.id === caster.id)!.hp).toBe(caster.hp) // 無傷
  })

  it('ステージ定義の味方初期位置が戦闘状態へ適用される', () => {
    for (let i = 0; i < STAGES.length; i++) {
      const st = createBattleState(STAGES[i], i, makeParty())
      expect(st.allies.map((a) => a.pos)).toEqual(STAGES[i].allyPositions)
    }
  })

  it('第4面に崩し手3体（低頻度・位相ずらし）と交互張りの守護型がいる', () => {
    const ruptors = STAGES[3].enemies.filter((e) => e.role === 'ruptor')
    expect(ruptors).toHaveLength(3)
    for (const r of ruptors) expect(r.fireEvery).toBe(2)
    expect(new Set(ruptors.map((r) => r.fireOffset)).size).toBeGreaterThan(1) // タイミングが揃わない
    const guardian = STAGES[3].enemies.find((e) => e.role === 'guardian')
    expect(guardian?.alternatingAura).toBe(true)
  })

  it('第5面ボスは多重詠唱（2本→フェーズで3本）と HP フェーズを持つ', () => {
    const s5 = STAGES[4]
    const boss = s5.enemies.find((e) => e.boss)!
    expect(boss.castCount).toBe(2)
    expect(boss.patternPool).toEqual(['breaker', 'attacker'])
    expect(s5.bossPhases).toHaveLength(2)
    expect(s5.bossPhases![0]).toMatchObject({ hpBelow: 0.66, castCount: 2 })
    expect(s5.bossPhases![1]).toMatchObject({ hpBelow: 0.33, castCount: 3, cullMinions: true })
    // 最下層は障害物なし（逃げ場が少ない＝クライマックスは正対する）
    expect(s5.bossPhases![1].obstacles).toHaveLength(0)
  })

  it('終盤の強敵だけが harmonic（多重サイン）を持つ（#69）', () => {
    for (let i = 0; i < STAGES.length; i++) {
      for (const e of STAGES[i].enemies) {
        const fams = [e.family, ...(e.families ?? [])]
        if (!fams.includes('harmonic')) continue
        expect(i, `${e.name} は終盤の面にいること`).toBeGreaterThanOrEqual(4)
        expect(e.level ?? 0).toBeGreaterThanOrEqual(6)
      }
    }
    // 最終面には harmonic 使いが実在する（終盤の「人間には描けない軌道」の担保）
    const elite = STAGES[4].enemies.filter((e) => [e.family, ...(e.families ?? [])].includes('harmonic'))
    expect(elite.length).toBeGreaterThanOrEqual(1)
  })
})

describe('フィールド半径 rField（#49・06b §5.5）', () => {
  it('面ごとに rField が設定される（サイズのスケールで拡大・第1面25〜最大60）', () => {
    expect(STAGES[0].rField).toBe(25) // size 1
    expect(STAGES[1].rField).toBe(37) // size 2
    expect(STAGES[2].rField).toBe(48) // size 3
    expect(STAGES[3].rField).toBe(48) // size 3
    expect(STAGES[4].rField).toBe(43) // size 2.5（①列柱の間）
    // 第1面↔最終面②で 2 倍以上の広さの差
    expect(60 / STAGES[0].rField!).toBeGreaterThan(2)
  })

  it('第5面 bossPhases で rField が拡大する（床崩落＝①列柱の間→②大広間60）', () => {
    const phases = STAGES[4].bossPhases!
    expect(phases[0].rField).toBe(60)
    expect(phases[1].rField).toBe(60)
    // 拡大してもボスは場内に残る
    const boss = STAGES[4].enemies.find((e) => e.boss)!
    expect(dist(boss.pos)).toBeLessThan(phases[1].rField!)
  })
})

describe('部屋の囲い（回り込み対策）', () => {
  it.each([
    ['第2面', 1],
    ['第3面', 2],
    ['第4面', 3],
    ['第5面', 4],
  ])('%s：部屋の左右の外（境界ぎわ）が囲い壁で塞がれている', (_name, idx) => {
    const s = STAGES[idx]
    const rField = s.rField ?? FIELD.rField
    const x = rField - 3
    expect(s.obstacles.some((o) => isSolidAt(o, { x, y: 0 }))).toBe(true)
    expect(s.obstacles.some((o) => isSolidAt(o, { x: -x, y: 0 }))).toBe(true)
  })

  it('囲い壁は unbreakable（削って部屋の外へ抜けられない）', () => {
    const s2 = STAGES[1]
    const seal = s2.obstacles.find((o) => isSolidAt(o, { x: (s2.rField ?? FIELD.rField) - 3, y: 0 }))
    expect(seal).toBeDefined()
    expect(seal!.kind).toBe('unbreakable')
  })
})

describe('図鑑（05c）との整合', () => {
  it('図鑑のHP値と一致する', () => {
    const hpOf = (idx: number, name: string) => STAGES[idx].enemies.find((e) => e.name === name)!.hp
    expect(hpOf(1, '回廊の衛士')).toBe(110)
    expect(hpOf(1, '影の射手')).toBe(105)
    expect(hpOf(1, '石喰いの鬼')).toBe(130)
    expect(hpOf(2, '広間の番兵')).toBe(160)
    expect(hpOf(2, '鋼鬼（白）')).toBe(125)
    expect(hpOf(2, '広間の射手')).toBe(120)
    expect(hpOf(3, '封印の番人')).toBe(180)
    expect(hpOf(3, '崩し手・弧')).toBe(175)
    expect(hpOf(4, '守護者の眷属（迂回）')).toBe(130)
    expect(STAGES[4].enemies.find((e) => e.boss)!.hp).toBe(380)
  })

  it('第3面に守護型（方向づけ場）のゴーレムがいる', () => {
    const golem = STAGES[2].enemies.find((e) => e.role === 'guardian')!
    expect(golem.directedAura).toBe(true)
    expect(golem.species).toBe('golem')
    expect(golem.hp).toBeGreaterThanOrEqual(150)
    expect(golem.hp).toBeLessThanOrEqual(165)
  })

  it('第4面の崩し手3体は abs/arc/poly34 を各体で分けて持つ（#46）', () => {
    const ruptors = STAGES[3].enemies.filter((e) => e.role === 'ruptor')
    expect(new Set(ruptors.map((r) => r.family))).toEqual(new Set(['abs', 'arc', 'poly34']))
  })

  it('第4面の封印の番人は交互張り＋方向づけ併用（最上位ゴーレム）', () => {
    const guardian = STAGES[3].enemies.find((e) => e.role === 'guardian')!
    expect(guardian.alternatingAura).toBe(true)
    expect(guardian.directedAura).toBe(true)
  })

  it('石像の番人以外は species を持ち、原型は proto', () => {
    expect(STAGES[0].enemies[0].species).toBe('proto')
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
    const party = makeParty().map((a, i) => ({ ...a, pos: alliesOf(stage)[i] ?? a.pos }))
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
    const out = resolveAllyCasts(
      prep.state,
      [{ allyId: caster.id, trajectory, initialSpeed: FIELD.fixedSpeed }],
      prep.castingEnemyIds,
    )
    s = out.state
    expect(s.enemies[0].hp).toBeLessThan(target.maxHp)
  })
})
