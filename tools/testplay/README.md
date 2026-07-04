# tools/testplay ― 実機テストプレイの自動駆動（開発専用）

実アプリ（Vite dev サーバ）を Playwright で自動プレイし、敵AI・演出・バランスの**体感**を
スクリーンショット連番と GIF で記録するツール。ロジックの自動テスト（`npm test`）を置き換える
ものではなく、「画面上で本当にそう見えるか」を確認するためのもの。

> 依存はプロジェクト（package.json）に追加しない。このフォルダの外（任意の作業用ディレクトリ）で
> `npm i playwright-core pngjs gifenc` を実行し、そこから node で本スクリプトを指すか、
> スクリプトをコピーして使う。

## 使い方

```bash
# 1. dev サーバを起動（デフォルト http://localhost:5173/Grimoire-Graph/）
npm run dev

# 2. 指定ステージを「全員おまかせ→全員発射」連打で自動プレイし、フレームを保存
#    usage: node drive.mjs <stage(1始まり)> <ターン数> <出力dir> [1ターンの撮影ms]
node tools/testplay/drive.mjs 6 4 ./frames-stage6 9000

# 3. フレーム連番を GIF へ（クロップ・縮小・パレット量子化つき）
#    usage: node png2gif.mjs <dir> <開始index> <枚数> <out.gif> [フレーム間引き step]
node tools/testplay/png2gif.mjs ./frames-stage6 0 120 stage6.gif 3
```

環境変数：

| 変数 | 既定値 | 意味 |
|---|---|---|
| `BASE_URL` | `http://localhost:5173/Grimoire-Graph/` | dev サーバの URL（ポートを変えたとき） |
| `CHROMIUM_PATH` | `/opt/pw-browsers/chromium` | Chromium 実行ファイル（ローカルでは Playwright の chromium のパスを指定） |

## 何を確認するか（#63 のバランス検証で使った観点）

- **敵の予告（enemyReveal）**：暴発型の赤✕とAoE円が「どこに・誰の近くに」出るか。
- **解決アニメ**：弾が壁を避ける／削る／結界に迎撃される挙動が予告どおりか。
- **連打プレイの敗北**：`?stage=N`（dev 限定のステージ直行）から「全員おまかせ→全員発射」を
  繰り返すだけのプレイが、第5面以降で必ず敗北（全滅 or 膜の崩壊）に至るか。
  ※ロジック側の同等の検証は `src/game/balance.test.ts` が自動で行う（そちらが正）。

`?stage=N` は開発ビルド限定（本番では無効・#33）。
