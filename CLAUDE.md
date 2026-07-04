# CLAUDE.md

> Claude Code はこのファイルを自動で読み込みます。このプロジェクトの作業規約・コマンド・検証ループは [AGENTS.md](AGENTS.md) に**一元化**しています（全エージェント共通）。CLAUDE.md はそれを取り込む薄いラッパで、Claude Code 固有の補足だけを足します。

@AGENTS.md

<!-- 技術スタック・コマンド・検証ループ・手動確認の手順は AGENTS.md にしか書かない（ここで再掲しない）。
     Claude Code 固有の事項（使う Skill 名・MCP 設定など）が出てきたらここに足す。 -->

## プロジェクトスキル（Claude Code 固有）

反復作業は `.claude/skills/` にスキル化してある。該当する作業ではスキルを使うこと：

- **verify-loop** … AGENTS.md の検証ループ（test / lint / typecheck / build ＋ 受け入れ条件照合）を回す。機能完了宣言・コミットの前に必ず。
- **spec-review** … graph_mage-spec.md・docs/ と src/ の実装を突き合わせ、乖離を洗い出して修正する仕様照合レビュー。
- **docs-sync** … 仕様変更後に、対応表に従って spec と docs/ を実装の実値で更新する。
- **fix-issues** … GitHub Issue やテストプレイのフィードバックを分類し、依存順に一括実装 → 項目ごとに受け入れ条件照合 → コミットまで進める。
