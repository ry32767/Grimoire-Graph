// 上部読み出しストリップ／術者カードが出す「撃つ前に読める値」をまとめる（DC プロトタイプ v3 の
// renderVals 相当）。z は完全情報・命中は撃つまで分からない、という設計をそのまま文言にする。
import type { ActiveOrbit, Ally, Enemy, Obstacle } from '../game/types'
import { FIELD } from '../data/constants'
import { buildRing } from '../game/orbit'
import { attributeOf } from '../game/attribute'
import { type ComposerState, buildComposerTrajectory, buildZAt } from './composer'
import { type RayInfo, blockingBarrier, poleOf, rayInfo, refAt, type RefAt } from './rayInfo'

export type ReadoutTone = 'error' | 'danger' | 'good' | 'dim' | 'dark'

export interface ReadoutStat {
  key: string
  value: string
  tone: ReadoutTone
}

export interface Readout {
  title: string
  sub: string
  tone: ReadoutTone
  ray: RayInfo
  ref: RefAt
  /** z(t) が発散する t（暴発する距離）。無ければ null */
  pole: number | null
  /** 立ちはだかる敵の結界（距離） */
  blocking: { at: number; id: string } | null
  /** 結界を張る式か */
  barrier: boolean
  /** 右レールに出す 4 つの読み取り値 */
  stats: ReadoutStat[]
  /** 術者カードの一行サマリ */
  mark: string
  markTone: ReadoutTone
}

const attrLabel = (z: number) => {
  const a = attributeOf(z)
  return a === 'light' ? '光 ▲' : a === 'dark' ? '闇 ▼' : '中立'
}
const attrTone = (z: number): ReadoutTone => {
  const a = attributeOf(z)
  return a === 'light' ? 'good' : a === 'dark' ? 'dark' : 'dim'
}

export interface ReadoutInput {
  ally: Ally
  composer: ComposerState
  enemies: Enemy[]
  obstacles: Obstacle[]
  orbits: ActiveOrbit[]
  rField: number | undefined
  /** ひるみ等で撃てない */
  impaired?: boolean
}

/** 1 人ぶんの読み取り値を組み立てる。 */
export function computeReadout(input: ReadoutInput): Readout {
  const { ally, composer: c, enemies, obstacles, orbits, rField } = input
  const barrier = c.mode === 'polar'
  const zAt = buildZAt(c)
  const traj = buildComposerTrajectory(c, ally.pos, rField)
  const exprError = c.freeError || c.zFreeError || (!traj ? '式が読めません（記号・括弧を確認）' : null)

  const ray = rayInfo(ally.pos, c.angle, enemies, obstacles)
  const targetEl = ray.kind === 'enemy' ? ray.element : 'neutral'
  const ref: RefAt = zAt
    ? refAt(zAt, ray.d, targetEl)
    : { z: 0, attr: 'neutral', strength: 0, speed: 0, affinity: 1, damage: 0 }
  const pole = zAt ? poleOf(zAt) : null
  const blocking = barrier ? null : blockingBarrier(ally.pos, ray.kind === 'enemy' ? (ray.pos ?? null) : null, orbits)

  let title: string
  let sub: string
  let tone: ReadoutTone
  let mark: string
  let markTone: ReadoutTone

  if (input.impaired) {
    title = 'ひるみ — このターンは撃てない'
    sub = '状態異常が解けるまで詠唱できない。ほかの術者で立て直す。'
    tone = 'danger'
    mark = 'ひるみ — 撃てない'
    markTone = 'danger'
  } else if (exprError) {
    title = barrier ? '結界の式が読めません' : '式が読めません'
    sub = exprError
    tone = 'error'
    mark = '式エラー'
    markTone = 'error'
  } else if (barrier) {
    const ring = traj ? buildRing(traj) : []
    let rmin = Number.POSITIVE_INFINITY
    let rmax = 0
    for (const p of ring) {
      const d = Math.hypot(p.pos.x - ally.pos.x, p.pos.y - ally.pos.y)
      if (d < rmin) rmin = d
      if (d > rmax) rmax = d
    }
    if (!Number.isFinite(rmin)) rmin = 0
    title = '結界を展開（弾は撃たない）'
    sub =
      `半径 ${rmin.toFixed(1)}〜${rmax.toFixed(1)} ／ 反対極の魔法だけを迎撃し、威力の引き算で必ずどちらかが消える。` +
      `|z|>${FIELD.zRef} だと周回が失速して自滅する。破壊されるまで持続。`
    tone = 'good'
    mark = '結界'
    markTone = 'good'
  } else if (pole !== null && pole < ray.d) {
    title = `t=${pole.toFixed(1)} で発散 → 暴発`
    sub = `極は θ に依らず t で決まる。r=${ray.d.toFixed(1)} に極を合わせれば的の位置で暴発する（半径 ${FIELD.aoeRadius} の光闇最大 AoE）。`
    tone = 'danger'
    mark = '暴発'
    markTone = 'danger'
  } else if (ref.speed <= 0.4) {
    title = 'r まで届かない（失速）'
    sub = `|z|>${FIELD.zRef} の区間が長すぎる。z(t) を t=r 付近だけ尖らせて、それまでは 0 に寝かせる。`
    tone = 'dark'
    mark = '失速'
    markTone = 'dark'
  } else if (blocking) {
    title = `敵の結界が t≈${blocking.at.toFixed(0)} で立ちはだかる`
    sub = `直進では届かない。威力で上回って破るか、同極の z に寄せて透過するか、迂回する曲線で裏へ回す。抜ければ ${ref.damage}。`
    tone = 'dark'
    mark = '反対極の結界に阻まれる'
    markTone = 'dark'
  } else {
    const head =
      ray.kind === 'enemy'
        ? `${ray.name} まで r = `
        : ray.kind === 'wall'
          ? '射線上の壁まで r = '
          : ray.kind === 'nearWall'
            ? '最寄りの壁まで r = '
            : '射線 r = '
    title = `${head}${ray.d.toFixed(1)} ／ 当たれば ${ref.damage}`
    sub =
      `t=r で v${ref.speed.toFixed(1)} × 強度${ref.strength.toFixed(1)} × ` +
      `${ref.affinity > 1 ? '反属性 ×1.5' : ref.affinity < 1 ? '同属性 ×0.5' : '中立 ×1.0'}。` +
      'z は解ける、命中は撃つまで分からない。'
    tone = 'good'
    mark = `当たれば ${ref.damage}`
    markTone = 'good'
  }

  const stats: ReadoutStat[] = [
    { key: ray.statLabel, value: ray.d.toFixed(1), tone: ray.kind === 'enemy' ? 'good' : 'dim' },
    { key: 'z(r)', value: `${ref.z > 0 ? '+' : ''}${ref.z.toFixed(2)}`, tone: attrTone(ref.z) },
    { key: '強度 × v(r)', value: `${ref.strength.toFixed(1)} × ${ref.speed.toFixed(1)}`, tone: 'dim' },
    blocking
      ? { key: '敵結界', value: '立ちはだかる', tone: 'dark' as ReadoutTone }
      : { key: '当たれば', value: String(ref.damage), tone: 'good' as ReadoutTone },
  ]

  return { title, sub, tone, ray, ref, pole, blocking, barrier, stats, mark, markTone }
}

/** z 欄の横に出す「属性 自動」の表示。 */
export function elementReadout(z: number): { label: string; tone: ReadoutTone } {
  return { label: attrLabel(z), tone: attrTone(z) }
}
