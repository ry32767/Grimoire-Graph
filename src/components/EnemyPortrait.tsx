// 敵図鑑のポートレート（#68：敵図鑑に見た目を追加）。
// バトル中の敵描画と同じ speciesStyle/drawSpeciesSprite（render/species・render/draw）を
// 小さな canvas に静止～微アニメで描く。ロジックには一切影響しない表示専用コンポーネント。
import { useEffect, useRef } from 'react'
import type { Attribute, EnemySpecies } from '../game/types'
import { drawSpeciesSprite, drawBossSprite } from '../render/draw'
import { GUARD_LIGHT, GUARD_DARK } from '../render/species'
import { COLORS } from '../render/theme'

const SIZE = 96
const R = SIZE * 0.34

interface Props {
  species: EnemySpecies
  tier: 1 | 2 | 3
  element: Attribute
  boss?: boolean
}

export default function EnemyPortrait({ species, tier, element, boss }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const eyeColor = element === 'light' ? GUARD_LIGHT : GUARD_DARK
    const cx = SIZE / 2
    const cy = SIZE / 2

    let raf = 0
    const render = (phase: number) => {
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, SIZE, SIZE)
      if (boss) drawBossSprite(ctx, cx, cy, R, phase)
      else drawSpeciesSprite(ctx, cx, cy, R, species, tier, element, eyeColor, phase)
    }

    if (reduceMotion) {
      render(0)
      return
    }
    const start = performance.now()
    const loop = (t: number) => {
      render(((t - start) / 1000) % (Math.PI * 2))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [species, tier, element, boss])

  return <canvas ref={ref} width={SIZE} height={SIZE} className="enemy-portrait" />
}
