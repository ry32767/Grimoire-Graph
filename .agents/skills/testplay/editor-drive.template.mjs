// 【テンプレ】ステージエディタ（?editor=1）を自動操作して任意配置のテストプレイを行う実例。
// この例は「一直線上の敵2体」を組んで貫通（多段ヒット）を確認する。配置・確認内容を書き換えて使う。
// 前提: playwright-core を npm i した作業ディレクトリにコピーして実行（ESM解決のため）。
// 詳細な操作の落とし穴は同ディレクトリの SKILL.md を参照。
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const outdir = process.argv[2] ?? './frames-editor-pierce'
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173/Grimoire-Graph/'
const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'
mkdirSync(outdir, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

await page.goto(`${BASE_URL}?editor=1`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
let frame = 0
const shoot = async () => page.screenshot({ path: `${outdir}/f${String(frame++).padStart(4, '0')}.png` })
await shoot() // エディタ初期状態

// NumField（label 内テキスト＋input）へ値を入れるヘルパ
const setNum = async (labelText, value) => {
  // 敵の詳細フォーム（.enemy-form）内の NumField に限定する（味方パネルの座標入力と衝突しない）
  const input = page
    .locator('.enemy-form label', { hasText: new RegExp(`^${labelText}`) })
    .locator('input')
    .first()
  await input.fill(String(value))
  await input.blur()
}

// 既存の敵（石像の番人）を選択し、中央味方(0,-23)の正面 (0, 2) へ移動
await page.locator('.wall-list-item', { hasText: 'HP' }).first().click()
await setNum('x', 0)
await setNum('y', -8)

// 2体目を追加し、同じ直線のさらに奥 (0, 10) へ
await page.getByRole('button', { name: /追加/ }).first().click()
await page.waitForTimeout(200)
// 追加した敵は自動選択されることがある：フォームが出ていなければ2体目をクリックして選択する
const enemyItems = page.locator('.wall-list-item', { hasText: 'HP' })
console.log('enemy list items:', await enemyItems.count())
if (!(await page.locator('.enemy-form').isVisible().catch(() => false))) {
  await enemyItems.nth(1).click()
  await page.waitForTimeout(200)
}
await setNum('x', 0)
await setNum('y', 0)
await shoot() // 配置後のエディタ

// テストプレイ開始
await page.getByRole('button', { name: 'テストプレイ' }).click()
await page.waitForTimeout(800)
await shoot()

// 全員おまかせ → 全員発射
const rec = page.locator('button.batch-recommend').first()
if (await rec.isVisible().catch(() => false)) await rec.click()
await page.waitForTimeout(400)
await shoot()
const fire = page.getByRole('button', { name: /全員発射|それでも発射/ }).first()
await fire.click()
await page.waitForTimeout(250)
const confirm = page.getByRole('button', { name: 'このまま発射' }).first()
if (await confirm.isVisible().catch(() => false)) await confirm.click()

// 解決アニメを連続キャプチャ（貫通：中央の弾が手前の敵を抜けて奥の敵にも当たる）
const start = Date.now()
while (Date.now() - start < 7000) {
  await shoot()
  await page.waitForTimeout(130)
}
// 戦闘ログと敵HPをテキストで確認する（貫通＝1発で2体に命中のログが出るか）
const logText = await page.locator('.battle-log, [class*=log]').first().innerText().catch(() => '(no log)')
console.log('=== battle log ===')
console.log(logText)
console.log('frames:', frame)
await browser.close()
