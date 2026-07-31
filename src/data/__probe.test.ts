// 一時プローブ（#69）：新レイアウトの「直線で敵に届かない」条件を実測する。恒久化したら削除する。
import { describe, it } from 'vitest'
import { STAGES } from './stages'
import { makeParty } from './party'
import { isSolidAt } from '../game/obstacle'
import { dist } from '../game/coords'
import type { Obstacle, Vec2 } from '../game/types'

function blocked(obstacles: Obstacle[], a: Vec2, b: Vec2): boolean {
  const L = dist(a, b)
  for (let d = 0; d <= L; d += 0.25) {
    const p = { x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L }
    if (obstacles.some((o) => isSolidAt(o, p))) return true
  }
  return false
}

describe('プローブ：経路の存在', () => {
  it('敵→各味方に clean 経路があるか（無いと敵AIが攻撃できない）', async () => {
    const { buildPlanningEnv } = await import('../game/enemyPlanning/planningEnv')
    const { findRoute } = await import('../game/enemyPlanning/routeSearch')
    for (let i = 1; i < STAGES.length; i++) {
      const s = STAGES[i]
      const allies = s.allyPositions ?? makeParty().map((a) => a.pos)
      const env = buildPlanningEnv(s.obstacles, s.rField)
      const rows: string[] = []
      for (const e of s.enemies) {
        const oks = allies.map((a) => (findRoute(env, e.pos, a, 'clean') ? 'o' : '-')).join('')
        const tun = allies.map((a) => (findRoute(env, e.pos, a, 'wallTunnel') ? 'o' : '-')).join('')
        rows.push(`${e.name}:clean=${oks} tunnel=${tun}`)
      }
      console.log(`[${i + 1}] ${rows.join(' / ')}`)
    }
  }, 300000)
})

describe('プローブ：直線遮断', () => {
  it('各面の (味方 → 敵) の直線が遮蔽で塞がれているか', () => {
    for (let i = 0; i < STAGES.length; i++) {
      const s = STAGES[i]
      const allies = s.allyPositions ?? makeParty().map((a) => a.pos)
      const open: string[] = []
      for (let ai = 0; ai < allies.length; ai++) {
        for (const e of s.enemies) {
          if (!blocked(s.obstacles, allies[ai], e.pos)) open.push(`ally${ai}→${e.name}`)
        }
      }
      console.log(`[${i + 1}] ${s.name} rField=${s.rField} 素材数=${s.obstacles.length} 通ってしまう直線=${open.length}`)
      if (open.length) console.log('    ', open.join(', '))
    }
  })

  it('敵・味方・障害物が場の内側か / 味方の散らばり', () => {
    for (let i = 0; i < STAGES.length; i++) {
      const s = STAGES[i]
      const R = s.rField ?? 30
      const allies = s.allyPositions ?? makeParty().map((a) => a.pos)
      const outAllies = allies.filter((p) => Math.hypot(p.x, p.y) > R - 2).length
      const outEnemies = s.enemies.filter((e) => Math.hypot(e.pos.x, e.pos.y) > R - 2).map((e) => e.name)
      // 味方どうしの最小距離・最大距離
      let minD = Infinity
      for (let a = 0; a < allies.length; a++)
        for (let b = a + 1; b < allies.length; b++) minD = Math.min(minD, dist(allies[a], allies[b]))
      // 味方が素材に埋まっていないか
      const stuck = allies.filter((p) => s.obstacles.some((o) => isSolidAt(o, p))).length
      const eStuck = s.enemies.filter((e) => s.obstacles.some((o) => isSolidAt(o, e.pos))).map((e) => e.name)
      console.log(
        `[${i + 1}] 場外味方=${outAllies} 場外敵=${outEnemies.join('/') || 'なし'} 味方最小間隔=${minD.toFixed(1)} 埋まり味方=${stuck} 埋まり敵=${eStuck.join('/') || 'なし'}`,
      )
    }
  })
})
