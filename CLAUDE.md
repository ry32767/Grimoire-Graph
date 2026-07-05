# CLAUDE.md

> Claude Code はこのファイルを自動で読み込みます。このプロジェクトの作業規約・コマンド・検証ループは [AGENTS.md](AGENTS.md) に**一元化**しています（全エージェント共通）。CLAUDE.md はそれを取り込む薄いラッパで、Claude Code 固有の補足だけを足します。

@AGENTS.md

<!-- 技術スタック・コマンド・検証ループ・手動確認の手順は AGENTS.md にしか書かない（ここで再掲しない）。 -->

## Claude Code 固有の補足

### プロジェクトスキル（`.claude/skills/`・トークン節約のため積極的に使う）

細かい実装・テストプレイ・docs 編集はサブエージェント/Workflow へ委任し、本体は判断と検証に専念する。

| スキル | 使う場面 |
|---|---|
| `/testplay` | 実機テストプレイ（?stage=N／?editor=1）。**必ずサブエージェントに委任**し、本体は結論とキーフレームだけ受け取る |
| `/docs-sync` | 仕様・数値変更後の spec/docs 同期を Workflow で並列編集（実装値は src から転記） |
| `/verify-loop` | 検証ループの省トークン実行順（typecheck→対象テスト→フル1回→lint→build。出力は tail で刈る） |
| `/balance-probe` | 一時デバッグテスト（`__probe.test.ts`）でロジック・AI・バランスを実測。修正前後比較は git stash |
| `/spec-audit` | 範囲の広い仕様照合を Workflow で並列監査＋敵対検証（AGENT_PLAYBOOK 準拠） |
| `/impl-delegate` | 設計確定後の「書くだけ」実装・テスト作成をサブエージェントへ委任する定型 |

### 環境の注意

- **リモート実行環境（Claude Code on the Web）には `gh` CLI が無い。** GitHub の操作（Actions の成否確認・再実行・PR）は GitHub MCP ツール（`mcp__github__actions_list` / `actions_get` / `get_job_logs` / `actions_run_trigger` 等）で行う。github.io など外部サイトへの直接アクセスはネットワークポリシーで塞がれていることがある（公開ページの表示確認はユーザーに依頼する）
- **`actions_list` の応答は 300KB 超**でファイル保存に落ちる。中身は python の json 読みで必要な数件だけ抜く（/verify-loop 参照）
- **実機テストプレイ（`tools/testplay/`）の実行方法**：依存（playwright-core / pngjs / gifenc）はプロジェクトに追加せず、scratchpad 等の作業用ディレクトリで `npm i` する。**ESM の依存解決はスクリプトの置き場所基準**なので、`drive.mjs` / `png2gif.mjs` はその作業用ディレクトリへコピーしてから実行する（リポジトリのパスを直接 node で指すと `ERR_MODULE_NOT_FOUND` になる）。Chromium はリモート環境なら `/opt/pw-browsers/chromium`（`CHROMIUM_PATH` で上書き可）
- **`pkill -f vite` を `&&` チェーンに入れない**：シェル自身が巻き込まれて exit 144 になり、後続コマンドが実行されない。dev サーバの停止は独立したコマンドで行う
- **フレーム画像（PNG）は Read ツールで直接開いて見る**：実機テストプレイの見た目確認（貫通・暴発位置・霧散タイミング）は、GIF 化の前にキーフレームを数枚読むのが速い
