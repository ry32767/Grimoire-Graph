// テストプレイ駆動：指定ステージへ dev ジャンプ → 全員おまかせ → 全員発射 → 解決アニメを連続キャプチャ
// usage: node drive.mjs <stage(1-7)> <turns> <outdir> [budgetMs per turn]
// 前提：dev サーバ起動済み（BASE_URL）・playwright-core をインストール済み（README.md 参照）
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const stage = process.argv[2] ?? '4'
const turns = Number(process.argv[3] ?? 3)
const outdir = process.argv[4] ?? `./frames-stage${stage}`
const budget = Number(process.argv[5] ?? 9000)
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173/Grimoire-Graph/'
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'
mkdirSync(outdir, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(`${BASE_URL}?stage=${stage}`, { waitUntil: 'networkidle' })

// stageIntro：戦闘開始
await page.getByRole('button', { name: '戦闘開始' }).click({ timeout: 15000 })
await page.waitForTimeout(800)

let frame = 0
const shoot = async () => {
  await page.screenshot({ path: `${outdir}/f${String(frame++).padStart(4, '0')}.png` })
}

// 物語オーバーレイ（暴発デモ等）が出ていたら「続ける」で閉じる
const dismissOverlay = async () => {
  const btn = page.locator('.story-overlay button', { hasText: '続ける' }).first()
  if (await btn.isVisible().catch(() => false)) {
    await shoot() // オーバーレイも記録
    await btn.click()
    await page.waitForTimeout(300)
  }
}

for (let t = 0; t < turns; t++) {
  await dismissOverlay()
  // 敵の予告（enemyReveal のテレグラフ）を数フレーム収める
  for (let i = 0; i < 4; i++) {
    await shoot()
    await page.waitForTimeout(200)
  }
  await dismissOverlay()
  // 全員おまかせ → 全員発射
  const rec = page.locator('button.batch-recommend').first()
  if (await rec.isVisible().catch(() => false)) await rec.click()
  await page.waitForTimeout(300)
  await shoot()
  const fire = page.getByRole('button', { name: /全員発射|それでも発射/ }).first()
  if (await fire.isVisible().catch(() => false)) {
    await fire.click()
  } else {
    console.log('fire button not found at turn', t)
    break
  }
  // 「このまま発射」確認が出たら通す
  await page.waitForTimeout(250)
  const confirm = page.getByRole('button', { name: 'このまま発射' }).first()
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  // 解決アニメを連続キャプチャ
  const start = Date.now()
  while (Date.now() - start < budget) {
    await shoot()
    await page.waitForTimeout(150)
  }
  // 勝敗画面（ResultScreen）に達したら終了。演出オーバーレイの「崩壊」文言は誤検知しない
  const cleared = await page.getByText('ステージクリア！').isVisible().catch(() => false)
  const over = await page.getByRole('button', { name: 'このステージをやり直す' }).isVisible().catch(() => false)
  if (cleared || over) {
    for (let i = 0; i < 3; i++) {
      await shoot()
      await page.waitForTimeout(300)
    }
    console.log('battle ended:', cleared ? 'cleared' : 'gameover')
    break
  }
}
console.log('frames:', frame)
await browser.close()
