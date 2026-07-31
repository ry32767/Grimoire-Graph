// 一時プローブ（#69）：経路 → family フィット → 本番物理検証のどこで落ちているかを見る。
import { describe, it } from 'vitest'
import { buildPlanningEnv } from './enemyPlanning/planningEnv'
import { findRoute } from './enemyPlanning/routeSearch'
import { fitRouteToFamilies } from './enemyPlanning/routeFit'
import { evaluateEnemyShot } from './enemyPlanning/evaluate'
import { firstHit } from './collision'
import { constZField } from './zfields'
import { STAGES } from '../data/stages'
import { makeParty } from '../data/party'
import { FIELD, GAME } from '../data/constants'
import type { Trajectory } from './types'

describe('プローブ：経路フィットの通り', () => {
  it('第2面：衛士 → 各味方', () => {
    const s = STAGES[1]
    const allies = s.allyPositions ?? makeParty().map((a) => a.pos)
    const env = buildPlanningEnv(s.obstacles, s.rField)
    for (const e of s.enemies) {
      for (const a of allies) {
        const route = findRoute(env, e.pos, a, 'clean')
        if (!route) {
          console.log(`${e.name}→(${a.x},${a.y}): 経路なし`)
          continue
        }
        const pts = route.points.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join('')
        const fits = fitRouteToFamilies(route.points, e.pos, ['abs', 'arc', 'poly34', 'harmonic'])
        const detail = fits.map((f) => {
          const traj: Trajectory = {
            mode: 'rotate', g: f.g, angle: f.angle, origin: e.pos, z: constZField(-FIELD.zRef), fieldR: s.rField,
          }
          const ev = evaluateEnemyShot(traj, e.castInitialSpeed, s.obstacles, [], { turnXs: f.turnXs })
          const hit = firstHit(ev.flight.samples, a, GAME.allyHitbox)
          const turnsBefore = hit ? ev.turnInMaterialArcs.filter((t) => t < hit.arcLen).length : -1
          const matBefore = hit ? ev.materialArcs.filter((t) => t < hit.arcLen).length : -1
          return `${f.family}:${hit ? `hit v=${hit.speed.toFixed(1)} 素材${matBefore} 壁内折れ${turnsBefore}` : `不達(終点まで${ev.pathLength.toFixed(0)} 失速=${ev.stalled})`}`
        })
        console.log(`${e.name}→(${a.x},${a.y}) 点${route.points.length}: ${pts}`)
        console.log(`    ${detail.join(' | ')}`)
      }
    }
  }, 300000)
})
