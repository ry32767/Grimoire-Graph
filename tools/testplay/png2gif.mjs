// PNG連番 → GIF（クロップ・縮小つき）。usage: node png2gif.mjs <dir> <start> <count> <out.gif> [step]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import pkg from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = pkg

const [dir, startS, countS, out, stepS] = process.argv.slice(2)
const start = Number(startS)
const count = Number(countS)
const step = Number(stepS ?? 1)
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort().slice(start, start + count)
const CROP_W = 880
const SCALE = 0.55 // 出力幅 ~484px

const gif = GIFEncoder()
let n = 0
for (let fi = 0; fi < files.length; fi += step) {
  const png = PNG.sync.read(readFileSync(`${dir}/${files[fi]}`))
  const cw = Math.min(CROP_W, png.width)
  const ch = png.height
  const ow = Math.round(cw * SCALE)
  const oh = Math.round(ch * SCALE)
  const rgba = new Uint8ClampedArray(ow * oh * 4)
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(ch - 1, Math.round(y / SCALE))
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(cw - 1, Math.round(x / SCALE))
      const si = (sy * png.width + sx) * 4
      const di = (y * ow + x) * 4
      rgba[di] = png.data[si]
      rgba[di + 1] = png.data[si + 1]
      rgba[di + 2] = png.data[si + 2]
      rgba[di + 3] = 255
    }
  }
  const palette = quantize(rgba, 128)
  const index = applyPalette(rgba, palette)
  gif.writeFrame(index, ow, oh, { palette, delay: 170 })
  n++
}
gif.finish()
writeFileSync(out, gif.bytes())
console.log(out, n, 'frames')
