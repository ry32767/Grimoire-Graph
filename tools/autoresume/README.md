# 自動復帰ウォッチドッグ

5時間の利用上限などで Claude Code のセッションが止まったとき、**制限が解除されたあとに自動で作業を再開させる**ための常駐スクリプト。

## 仕組み

- 心拍：Claude Code が書き続けるセッション transcript（`~/.claude/projects/<slug>/*.jsonl`）の mtime を見る。
  フックや設定変更は不要。transcript の置き場はプロジェクトパスから自動導出する。
- `--stall` 分（既定 20 分）更新が止まっていたら「中断した」とみなし、
  プロジェクトのディレクトリで `claude -c -p <resume-prompt.md>` を起動して直前の会話を続きから再開する。
- 再開の出力に利用上限のメッセージが含まれていたら、解除時刻（取れれば）まで待って再挑戦する。
  時刻が取れなければ 10 → 20 → 30 分と待ち時間を伸ばす。
- 権限は普段のセッションと同じ（`settings.json` の `defaultMode`）。`bypassPermissions` は付けないので、
  無人実行でも危険な操作は普段どおり止まる。

## 使い方

```cmd
rem 常駐開始（既定の期限は 2026-08-02T14:30:00）
tools\autoresume\run-watchdog.cmd

rem 期限を指定して常駐開始
tools\autoresume\run-watchdog.cmd 2026-08-05T09:00:00
```

止めるとき：

```cmd
rem STOP ファイルを置くと次のポーリングで終了する
type nul > tools\autoresume\STOP
```

状態とログ：

- 状態 … `%USERPROFILE%\.claude\autoresume\grimoire-state.json`
- ログ … `%USERPROFILE%\.claude\autoresume\grimoire.log`

## 引き継ぎ

再開したセッションは `resume-prompt.md` を受け取り、`PROGRESS.md` を読んで続きから作業する。
**作業する側は区切りごとに `PROGRESS.md` を更新すること**（これが中断・再開をまたぐ唯一の引き継ぎ）。

## 検証済みの動作（2026-08-01）

1. 停止検知 → 再開コマンドの起動（`--exec` で代替コマンドを起動して確認）
2. `claude -c -p` によるヘッドレス継続 … 直前の会話の内容を保持していることを確認
3. ウォッチドッグ自身が `claude` を起動する E2E … 応答の取得まで確認
