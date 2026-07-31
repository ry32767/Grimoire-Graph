---
name: testplay
description: 実機テストプレイ（Playwright）で「画面上で本当にそう見えるか」を確認する。?stage=N の自動プレイ、または ?editor=1 のステージエディタで任意の敵/壁配置を組んでのテストプレイ。見た目の確認・貫通/パリィ/暴発などの挙動の実機検証を頼まれたときに使う。フレーム画像・戦闘ログは大量なので、必ずサブエージェントに委任して本体は結論だけ受け取る。
---

# 実機テストプレイ（サブエージェント委任）

**原則：この作業は general-purpose サブエージェント1体に丸ごと任せる。**
フレーム PNG・戦闘ログ・セレクタ試行錯誤を本体コンテキストに載せない。
本体が受け取るのは「結論＋戦闘ログの要点＋決定的フレーム2〜3枚のパス」だけ。
必要なときだけ本体がそのフレームを Read で開く。

## サブエージェントへ渡す定型指示（コピーして具体化する）

```
Grimoire-Graph の実機テストプレイを実行し、結果を要約して返す。

セットアップ（既にあれば再利用）:
1. 作業dir = <scratchpad>/testplay で `npm i playwright-core pngjs gifenc`
   （リポジトリには依存を追加しない。ESM解決のためスクリプトはこのdirに置く）
2. リポジトリの tools/testplay/drive.mjs と .Codex/skills/testplay/editor-drive.template.mjs をコピー
3. dev サーバ: リポジトリで `npm run dev` をバックグラウンド起動（起動確認は curl で 200）
   ※停止するときは `pkill -f vite` を単独コマンドで（&&チェーンに入れると exit 144）

環境: CHROMIUM_PATH=/opt/pw-browsers/chromium, BASE_URL=http://localhost:5173/Grimoire-Graph/
- 既存ステージの自動プレイ: `node drive.mjs <stage 1-7> <ターン数> <出力dir> [1ターンms]`
- 任意配置のテストプレイ: editor-drive.template.mjs を編集して実行（?editor=1）

確認したいこと: <ここに具体的な検証内容。例: 直線上の敵2体に1発で両方命中するか>

返すもの（これ以外は返さない）:
- 判定（期待どおりか）と根拠
- 戦闘ログの該当行（そのまま引用）
- 決定的なフレーム2〜3枚の絶対パス（解決アニメ中・結果表示時）
```

## エディタ自動操作の既知の落とし穴（テンプレに反映済み・再発見に時間を溶かさない）

- **NumField（x/y等）は `.enemy-form label` にスコープする**。味方位置パネルにも同名の
  x/y 入力があり、素の `label` 検索だと味方を動かしてしまう。
- 敵リストは `.wall-list-item` のうちテキストに `HP` を含むもの（壁リストと同クラス）。
- 「＋敵を追加」直後は新しい敵が**自動選択されることがある**。`.enemy-form` が見えて
  いなければリスト2番目をクリックして選択する。
- テストプレイ開始は `テストプレイ` ボタン。戦闘は stageIntro を飛ばして直接始まる
  （`?stage=N` 直行のときだけ `戦闘開始` ボタンがある）。
- 戦闘操作: `button.batch-recommend`（全員おまかせ）→ `全員発射|それでも発射` →
  確認 `このまま発射` が出たら押す。
- 戦闘ログ全文は `page.locator('[class*=log]').first().innerText()` で取れる。
  **まずログで判定し、画像は補助**（ログに命中・パリィ・暴発・減速の内訳が全部出る）。

## 参照

- 使い方の正典: [tools/testplay/README.md](../../../tools/testplay/README.md)
- エディタ仕様: docs/11-stage-editor.md
