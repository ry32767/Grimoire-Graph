import { describe, it, expect } from 'vitest'
import { STAGES } from './stages'
import { ROTATE_PRESETS, buildTrajectory } from '../game/functions'
import { createBattleState, prepareTurn, resolveAllyCasts } from '../game/battle'
import { planRuptorShot } from '../game/enemyAI'
import { makeParty } from './party'
import { FIELD } from './constants'
import { dist } from '../game/coords'
import { isSolidAt, materialCells } from '../game/obstacle'
import { ringEncloses, type RingPoint } from '../game/orbit'
import { constZField } from '../game/zfields'
import type { Trajectory } from '../game/types'

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
        // 部屋の囲い（roomWalls/crossWalls）・翼壁は「四方を壁で囲う」ため境界の外まで伸ばして
        // 密封する（unbreakable の中立壁）。円形の場では外縁が境界円を必ず超えるので、この種の
        // 囲い壁は厳密な四隅在場内の制約を免除する（内部障害物のみ場内を要求）。
        const isSealWall = o.kind === 'unbreakable' && o.element === 'neutral'
        for (const r of rects) {
          expect(r.w).toBeGreaterThan(0)
          expect(r.h).toBeGreaterThan(0)
          if (isSealWall) continue // 部屋/十字の囲い・翼壁は境界まで密封してよい
          // 通常の障害物は四隅とも場内（矩形の全4角）
          expect(dist({ x: r.x, y: r.y })).toBeLessThan(rField)
          expect(dist({ x: r.x + r.w, y: r.y })).toBeLessThan(rField)
          expect(dist({ x: r.x, y: r.y + r.h })).toBeLessThan(rField)
          expect(dist({ x: r.x + r.w, y: r.y + r.h })).toBeLessThan(rField)
        }
      }
    }
  })

  it('部屋型ステージは四方を壁で囲われている（手描き仕様・回り込み不可）', () => {
    // 円の中に部屋（矩形/十字）を残し、外側を壁で埋める設計。円周付近（境界の内側）を一周
    // サンプルし、「素材が全く無い（=部屋がそのまま境界に達している）」向きが少ないことを確認する。
    // 開けた円のステージ（第4面・第7面②③のフェーズ）は囲わないので除外。
    const roomStages = STAGES.filter((s) => s.id !== 'stage-4' && s.id !== 'stage-7')
    for (const s of roomStages) {
      const rField = s.rField ?? FIELD.rField
      let sealed = 0
      const N = 72
      for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2
        const p = { x: (rField - 1.5) * Math.cos(th), y: (rField - 1.5) * Math.sin(th) }
        if (s.obstacles.some((o) => isSolidAt(o, p))) sealed++
      }
      // 境界付近の過半は囲い壁（部屋の開口＝回廊/正面だけが開く）
      expect(sealed).toBeGreaterThan(N / 2)
    }
  })

  it('部屋の囲い壁は unbreakable（削って部屋の外へ抜けられない）', () => {
    // 各部屋型ステージに、境界（|x| or |y| ≥ rField）まで届く unbreakable の中立壁がある
    const roomStages = STAGES.filter((s) => s.id !== 'stage-4' && s.id !== 'stage-7')
    for (const s of roomStages) {
      const rField = s.rField ?? FIELD.rField
      const hasSeal = s.obstacles.some(
        (o) =>
          o.kind === 'unbreakable' &&
          o.element === 'neutral' &&
          (o.rects ?? []).some(
            (r) => Math.max(Math.abs(r.x), Math.abs(r.x + r.w)) >= rField || Math.max(Math.abs(r.y), Math.abs(r.y + r.h)) >= rField,
          ),
      )
      expect(hasSeal).toBe(true)
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
    // デモの暴発は中央寄せの味方（#64）を巻き込まない（顔見せ演出のまま）
    const demo = resolution.enemyShots.find((s) => s.misfired)!
    for (const a of prep.state.allies) {
      expect(dist(a.pos, demo.misfirePos!)).toBeGreaterThan(FIELD.aoeRadius + 1)
    }
    // 崩し手自身も巻き込まない（#65：自爆しない場所を選ぶ。危険圏は上振れ込み）
    const caster = prep.state.enemies.find((e) => e.id === demo.enemyId)!
    expect(dist(caster.pos, demo.misfirePos!)).toBeGreaterThan(FIELD.aoeRadius)
    expect(resolution.enemies.find((e) => e.id === caster.id)!.hp).toBe(caster.hp) // 無傷
  })

  it('第4面（#64）：味方は中央寄せで、レンの半径7の結界1枚で3人を囲える（壁に触れず存続）', () => {
    const st = createBattleState(STAGES[3], 3, makeParty())
    // ステージ定義の初期位置上書きが適用されている
    expect(st.allies.map((a) => a.pos)).toEqual(STAGES[3].allyPositions)
    const prep = prepareTurn(st)
    const ren = prep.state.allies[1]
    const traj: Trajectory = {
      mode: 'polar', f: () => 7, origin: ren.pos, z: constZField(-FIELD.zRef), fieldR: prep.state.rField,
    }
    const { resolution } = resolveAllyCasts(
      prep.state,
      [{ allyId: ren.id, trajectory: traj, initialSpeed: FIELD.fixedSpeed }],
      prep.castingEnemyIds,
    )
    const orbitShot = resolution.allyShots.find((s) => s.kind === 'orbit')!
    expect(orbitShot.broken).toBe(false) // 渦は開始半径13で離してあり、結界は壁に触れない
    for (const a of prep.state.allies) {
      expect(ringEncloses(orbitShot.path as RingPoint[], a.pos)).toBe(true) // 3人とも内側
    }
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
  it('面ごとに rField が設定される（サイズのスケールで拡大・第1面25〜最大60）', () => {
    // 手描き仕様の「サイズ」に対応：第1面=25（最小）→ 面が進むほど広くなる。7面は①矩形43→②大円60。
    expect(STAGES[0].rField).toBe(25) // size 1
    expect(STAGES[1].rField).toBe(31) // size 1.5
    expect(STAGES[2].rField).toBe(37) // size 2
    expect(STAGES[3].rField).toBe(48) // size 3
    expect(STAGES[4].rField).toBe(54) // size 3.5
    expect(STAGES[5].rField).toBe(48) // size 3
    expect(STAGES[6].rField).toBe(43) // size 2.5（①矩形の間）
    // 第1面↔第7面②で約2.4倍の広さの差
    expect(60 / STAGES[0].rField!).toBeGreaterThan(2)
  })

  it('第7面 bossPhases で rField が拡大する（床崩落＝①矩形→②大円60）', () => {
    const phases = STAGES[6].bossPhases!
    expect(phases[0].rField).toBe(60) // ②開けた大円（サイズ4）
    expect(phases[1].rField).toBe(60) // ③④も同じ大円
    // 拡大してもボス（y=26）は場内に残る
    const boss = STAGES[6].enemies.find((e) => e.boss)!
    expect(dist(boss.pos)).toBeLessThan(phases[1].rField!)
  })
})

describe('部屋の囲い（手描き仕様・回り込み対策）', () => {
  it.each([
    ['第2面', 1],
    ['第3面', 2],
    ['第6面', 5],
  ])('%s：矩形の部屋の左右の外（境界ぎわ）が囲い壁で塞がれている', (_name, idx) => {
    const s = STAGES[idx]
    const rField = s.rField ?? FIELD.rField
    // 部屋の外（|x| が部屋幅より大きく、境界の内側）に囲い壁の素材があること（両側）
    const x = rField - 3
    const blockedRight = s.obstacles.some((o) => isSolidAt(o, { x, y: 0 }))
    const blockedLeft = s.obstacles.some((o) => isSolidAt(o, { x: -x, y: 0 }))
    expect(blockedRight).toBe(true)
    expect(blockedLeft).toBe(true)
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
