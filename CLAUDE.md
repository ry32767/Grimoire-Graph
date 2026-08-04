# CLAUDE.md

> 作業規約・コマンド・検証ループは [AGENTS.md](AGENTS.md) に一元化（全エージェント共通）。ここは Claude Code 固有の補足だけ。

@AGENTS.md

## プロジェクトスキル（`.claude/skills/`・トークン節約のため積極的に使う）

細かい実装・テストプレイ・docs 編集はサブエージェント/Workflow へ委任し、本体は判断と検証に専念する。

| スキル | 使う場面 |
|---|---|
| `/verify-loop` | 完了宣言前の検証ループ（省トークンな実行順・ログの刈り方） |
| `/testplay` | 実機テストプレイ（?stage=N／?editor=1）。**必ずサブエージェントに委任**し、本体は結論とキーフレームだけ受け取る |
| `/docs-sync` | 仕様・数値変更後の spec/docs 同期を Workflow で並列編集 |
| `/balance-probe` | 一時デバッグテスト（`__probe.test.ts`）でロジック・AI・バランスを実測 |
| `/spec-audit` | 範囲の広い仕様照合を並列監査＋敵対検証（AGENT_PLAYBOOK 準拠） |
| `/impl-delegate` | 設計確定後の「書くだけ」実装・テスト作成をサブエージェントへ委任 |

## 環境の注意

- **リモート実行環境（Claude Code on the Web）には `gh` CLI が無い。** GitHub の操作（Actions の成否確認・再実行・PR）は `mcp__github__*` ツールで行う。github.io など外部サイトへの直接アクセスは塞がれていることがある（公開ページの表示確認はユーザーに依頼する）
- **`pkill -f vite` を `&&` チェーンに入れない**：シェル自身が巻き込まれて exit 144 になり、後続コマンドが実行されない
- フレーム画像（PNG）は Read ツールで直接開ける。実機テストプレイの見た目確認は、GIF 化の前にキーフレームを数枚読むのが速い
