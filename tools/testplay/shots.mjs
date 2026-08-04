// 詠唱コンソール／作図台の見た目を撮るだけの補助スクリプト（開発専用・#68）。
// usage: node shots.mjs <出力dir>   ※ 依存は tools/testplay/README.md のとおりプロジェクト外に入れる
//   BASE_URL     既定 http://localhost:5173/Grimoire-Graph/
//   CHROMIUM_PATH Chromium 実行ファイル（未指定なら playwright 同梱を使う）
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? './shots'
const BASE = process.env.BASE_URL ?? 'http://localhost:5173/Grimoire-Graph/'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
})
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
let n = 0
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${String(n++).padStart(2, '0')}-${name}.png`) })
  console.log('shot', name)
}
const click = async (text, opts = {}) => {
  const el = page.getByRole('button', { name: text, ...opts }).first()
  await el.click({ timeout: 5000 })
  await page.waitForTimeout(250)
}

await page.goto(`${BASE}?stage=1`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
// タイトル／物語オーバーレイを抜ける
for (let i = 0; i < 6; i++) {
  const btn = page.locator('.modal button, .title-start, .btn.primary').first()
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {})
    await page.waitForTimeout(400)
  }
}
await page.waitForTimeout(600)
await shot('console-y')

await click('押すと結界')
await shot('console-ward')

await click('作図')
await shot('pad-ward-coef')

await click('点から作る')
await shot('pad-ward-pts')

// 方眼紙に3点打つ（θ 軸）
const pad = page.locator('canvas[aria-label="作図台"]')
const box = await pad.boundingBox()
for (const [fx, fy] of [
  [0.12, 0.34],
  [0.5, 0.2],
  [0.88, 0.34],
]) {
  await pad.click({ position: { x: box.width * fx, y: box.height * fy } })
  await page.waitForTimeout(120)
}
await shot('pad-ward-points')

await page.getByRole('button', { name: /合わせる|式にする/ }).first().click()
await page.waitForTimeout(500)
await shot('pad-ward-fitted')

// 作図台を閉じてから軌道へ戻す（オーバーレイがクリックを吸うため）
await page.locator('.draft-close').click()
await page.waitForTimeout(250)
await click('y= 軌道')
await click('作図')
await click('点から作る')
await shot('pad-y')
await page.locator('.draft-close').click()
await page.waitForTimeout(250)

// 狭い幅で術式チップが折り返すか
await page.setViewportSize({ width: 900, height: 860 })
await page.waitForTimeout(400)
await shot('narrow-y')
await click('r= 結界')
await shot('narrow-ward')

await browser.close()
