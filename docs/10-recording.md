# 10. アニメーションの録画・GIF 作成

戦闘演出（暴発の渦・命中・結界など）を**実機の Canvas からフレーム連続キャプチャ**して、動画（WebM）／GIF にする手順。
デザイン確認・PR への添付・不具合の再現共有などに使う。Claude Code on the web の実行環境（Chromium + 同梱 ffmpeg）を前提にする。

> このフォルダの他ページが「ゲーム実装の仕様」なのに対し、本ページは**開発ツールの手順**。実装には影響しない。

---

## 10.1 全体の流れ

```
dev サーバ起動 → Playwright で操作・Canvas を連続キャプチャ(JPEG) → 動画/GIF にエンコード
```

1. `npm run dev` で開発サーバを立てる（`http://localhost:5173/Grimoire-Graph/`）。
2. Playwright（`playwright-core`）で Chromium を起動し、戦闘画面まで操作する。
3. 見たい演出を発生させ（例：暴発する z 場を入れて「全員発射」）、**Canvas を一定間隔で `toDataURL('image/jpeg')` してフレーム列にためる**。
4. フレーム列を **WebM**（同梱 ffmpeg）または **GIF**（純 JS エンコーダ）に変換する。

> 一時ファイル・依存（playwright-core / gifenc / jpeg-js）は**スクラッチパッドに置き、リポジトリには入れない**。

---

## 10.2 環境メモ（この実行環境固有）

- **Chromium**：`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`（`playwright install` は不要・してはいけない）。
- **同梱 ffmpeg**：`/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux`。**最小ビルド**で制約あり：
  - エンコーダは **libvpx(VP8) のみ**（h264/gif なし）。デコーダは **mjpeg / libvpx**（**png デコード不可**）。
  - プロトコルは **`file` のみ**（`pipe:` / `fd:` 不可）。デマクサは **`image2pipe`**（連番 `image2` は不可）。
  - → **GIF はこの ffmpeg では作れない**。GIF は純 JS（`gifenc`）で作る（§10.5）。
- **プロキシ**：ブラウザは直結させる（`--no-proxy-server` ＋ `proxy:{server:'direct://'}`）。localhost に出るときは `NO_PROXY=localhost,127.0.0.1`。
- `playwright-core` はプロジェクト依存に入れず、スクラッチパッドで `npm install playwright-core` する（`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`）。

---

## 10.3 フレームをキャプチャする（Playwright）

ポイントは **ページ内 `setInterval` で `toDataURL` し続ける**こと（`page.screenshot` は遅く、なめらかに撮れない）。発射の直前にキャプチャを開始し、Canvas のピクセルを直接ためる。

```js
// record.mjs（スクラッチパッドで実行）
import { chromium } from 'playwright-core'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
const OUT = '<scratchpad>', FR = OUT + '/frames'
try { rmSync(FR, { recursive: true }) } catch {}
mkdirSync(FR, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--no-proxy-server'],
  proxy: { server: 'direct://' },
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://127.0.0.1:5173/Grimoire-Graph/?stage=1', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.getByRole('button', { name: '戦闘開始' }).click(); await page.waitForTimeout(500)
const close = page.getByRole('button', { name: '閉じる' })
if (await close.count()) { await close.first().click(); await page.waitForTimeout(200) }

// 暴発させる z 場を入れる（例：x=-5 で発散）
const z = page.locator('input[placeholder*="0.3*y"]')
await z.click(); await z.fill('1/(x+5)')
await z.evaluate((el) => el.parentElement.querySelector('button')?.click())
await page.waitForTimeout(250)

// 33ms 間隔で Canvas を JPEG キャプチャ（約2.9秒ぶん）
await page.evaluate((dur) => {
  const cv = document.querySelector('canvas[aria-label="バトルフィールド"]')
  window.__f = []; window.__done = false
  const id = setInterval(() => { try { window.__f.push(cv.toDataURL('image/jpeg', 0.92)) } catch {} }, 33)
  setTimeout(() => { clearInterval(id); window.__done = true }, dur)
}, 2900)
await page.getByRole('button', { name: '全員発射' }).click()
await page.waitForFunction(() => window.__done === true, { timeout: 6000 })

const frames = await page.evaluate(() => window.__f)
await browser.close()
frames.forEach((url, i) =>
  writeFileSync(`${FR}/f-${String(i).padStart(3, '0')}.jpg`, Buffer.from(url.split(',')[1], 'base64')),
)
console.log('captured', frames.length)
```

- **演出の発生**は「DEV ステージ直行 `?stage=N` → 関数/ z 場を入れて 全員発射」で作る。命中させたいときは「困ったらこれ」（recommend）で敵を狙わせる。
- **撮り終わりの余白**（次の作成フェーズ）はあとでトリミングする（§10.4/§10.5 で先頭〜爆発までを採用）。
- セレクタは `aria-label="バトルフィールド"` の Canvas。ボタンは表示名（`戦闘開始`/`全員発射`/`困ったらこれ`/`閉じる`）。

---

## 10.4 WebM にする（同梱 ffmpeg）

同梱 ffmpeg は `file` プロトコルのみ＝パイプ不可。**JPEG を 1 ファイルに連結**して `image2pipe` で読ませる。

```bash
FF=/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux
# 飛行〜爆発だけ採用（末尾の作成フェーズは捨てる）。例：先頭52フレーム
ls frames/f-*.jpg | sort | head -52 | xargs cat > clip.mjpeg
$FF -y -f image2pipe -vcodec mjpeg -framerate 30 -i clip.mjpeg \
   -c:v libvpx -b:v 2M -pix_fmt yuv420p misfire.webm
```

> 注意：`-i -` / `-i fd:0` は使えない（pipe/fd プロトコル無し）。必ず**連結ファイルを `-i` に渡す**。WebM(VP8) は多くのブラウザで再生可能だが、ビューアによっては開けないことがある（その場合は §10.5 の GIF）。

---

## 10.5 GIF にする（純 JS・`gifenc`）

同梱 ffmpeg は GIF を出力できないので、**純 JS の GIF エンコーダ `gifenc`＋ JPEG デコーダ `jpeg-js`** で作る（スクラッチパッドに `npm install gifenc jpeg-js`）。両方とも CommonJS なのでデフォルトインポートする。

```js
// make-gif.mjs（スクラッチパッドで実行）
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import jpegPkg from 'jpeg-js'; const jpeg = jpegPkg
import gifencPkg from 'gifenc'; const { GIFEncoder, quantize, applyPalette } = gifencPkg
const FR = '<scratchpad>/frames'
const files = readdirSync(FR).filter((f) => f.endsWith('.jpg')).sort().slice(0, 52) // 飛行〜爆発
const DW = 360, DH = 360 // 縮小（サイズ削減）

const downscale = (src, sw, sh) => { // 最近傍
  const out = new Uint8Array(DW * DH * 4)
  for (let y = 0; y < DH; y++) { const sy = Math.min(sh - 1, (y * sh / DH) | 0)
    for (let x = 0; x < DW; x++) { const sx = Math.min(sw - 1, (x * sw / DW) | 0)
      const s = (sy * sw + sx) * 4, d = (y * DW + x) * 4
      out[d]=src[s]; out[d+1]=src[s+1]; out[d+2]=src[s+2]; out[d+3]=255 } }
  return out
}
const gif = GIFEncoder()
for (const f of files) {
  const { data, width, height } = jpeg.decode(readFileSync(`${FR}/${f}`), { useTArray: true })
  const rgba = downscale(data, width, height)
  const palette = quantize(rgba, 256)
  const index = applyPalette(rgba, palette)
  gif.writeFrame(index, DW, DH, { palette, delay: 40 }) // delay は ms（40ms≒25fps）
}
gif.finish()
writeFileSync('<scratchpad>/misfire.gif', Buffer.from(gif.bytes()))
```

- **サイズ削減**：解像度を下げる（360→300 等）／フレーム間引き（`files.filter((_,i)=>i%2===0)`）／`delay` 調整。今回の暴発は 360px・52frame で約 1.8MB。
- `delay` は**ミリ秒**指定（gifenc 内部で 1/100 秒へ丸め）。

---

## 10.6 配布

- 生成した GIF/WebM は `SendUserFile` で渡す（ビューアにより GIF の方が確実に再生できる）。
- スクラッチパッドの中間ファイル（frames/・*.webm・*.gif・node_modules）は**コミットしない**。
</content>
