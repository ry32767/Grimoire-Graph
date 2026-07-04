# CLAUDE.md

> Claude Code はこのファイルを自動で読み込みます。このプロジェクトの作業規約・コマンド・検証ループは [AGENTS.md](AGENTS.md) に**一元化**しています（全エージェント共通）。CLAUDE.md はそれを取り込む薄いラッパで、Claude Code 固有の補足だけを足します。

@AGENTS.md

<!-- 技術スタック・コマンド・検証ループ・手動確認の手順は AGENTS.md にしか書かない（ここで再掲しない）。 -->

## Claude Code 固有の補足

- **リモート実行環境（Claude Code on the Web）には `gh` CLI が無い。** GitHub の操作（Actions の成否確認・再実行・PR）は GitHub MCP ツール（`mcp__github__actions_list` / `actions_get` / `get_job_logs` / `actions_run_trigger` 等）で行う。github.io など外部サイトへの直接アクセスはネットワークポリシーで塞がれていることがある（公開ページの表示確認はユーザーに依頼する）
- **実機テストプレイ（`tools/testplay/`）の実行方法**：依存（playwright-core / pngjs / gifenc）はプロジェクトに追加せず、scratchpad 等の作業用ディレクトリで `npm i` する。**ESM の依存解決はスクリプトの置き場所基準**なので、`drive.mjs` / `png2gif.mjs` はその作業用ディレクトリへコピーしてから実行する（リポジトリのパスを直接 node で指すと `ERR_MODULE_NOT_FOUND` になる）。Chromium はリモート環境なら `/opt/pw-browsers/chromium`（`CHROMIUM_PATH` で上書き可）
- **`pkill -f vite` を `&&` チェーンに入れない**：シェル自身が巻き込まれて exit 144 になり、後続コマンドが実行されない。dev サーバの停止は独立したコマンドで行う
- **フレーム画像（PNG）は Read ツールで直接開いて見る**：実機テストプレイの見た目確認（貫通・暴発位置・霧散タイミング）は、GIF 化の前にキーフレームを数枚読むのが速い
