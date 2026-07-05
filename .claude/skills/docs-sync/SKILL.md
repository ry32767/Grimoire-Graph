---
name: docs-sync
description: 仕様・挙動・数値を変えたあとの graph_mage-spec.md / docs/ の同期編集を、Workflow（並列サブエージェント）に委任してトークンを節約する。コード変更のドキュメント反映・「docs を実装に合わせて」系の依頼で使う。
---

# ドキュメント同期の委任（Workflow）

docs 同期は「AGENTS.md の対応表に従い、`src/` の実装値を転記する」機械作業で、
対象ファイルが多い（過去実績: 1修正で spec＋docs 7ファイル）。本体でやらず委任する。

## 手順

1. **本体でやること（判断）**：AGENTS.md「ドキュメント同期」の表から対象ドキュメントを列挙し、
   「何がどう変わったか」の変更概要（1〜3行）と、実装値の参照元（`src/` の file:line）を作る。
2. **Workflow で並列編集**：対象ドキュメント1ファイル＝1エージェント。編集対象が互いに別ファイル
   なので worktree 隔離は不要。各エージェントへ渡すもの：
   - 変更概要（本体が書いたもの）
   - 対象ドキュメントのパスと、直すべき節の見出し・キーワード
   - 実装の参照元（**数値・式は必ず src を読んで転記させる。推測で書かせない**）
   - 返すもの＝「編集した節の一覧＋転記した値」だけ（本文全文は返させない）
3. **最終チェック1体**：全編集後に「旧仕様の残骸」を grep させる（旧定数名・旧数値・
   旧挙動の言い回し）。見つかれば file:line を返させ、本体が判断して直す。

## Workflow スクリプトの雛形

```js
export const meta = {
  name: 'docs-sync',
  description: '変更概要に沿って docs を並列同期し、残骸を最終チェックする',
  phases: [{ title: '編集' }, { title: '残骸チェック' }],
}
// args = { summary: '変更概要', refs: 'src の参照元', targets: [{ path, sections }], staleWords: [...] }
const edits = await parallel(args.targets.map((t) => () =>
  agent(
    `Grimoire-Graph のドキュメント同期。変更概要:\n${args.summary}\n実装の参照元: ${args.refs}\n` +
    `対象: ${t.path} の ${t.sections}。数値・式は必ず src を読んで転記（推測禁止）。` +
    `編集後、変更した節の見出しと転記した値だけを箇条書きで返す。`,
    { label: `edit:${t.path}`, phase: '編集' },
  ),
))
const check = await agent(
  `graph_mage-spec.md と docs/ を対象に、旧仕様の残骸を探す: ${args.staleWords.join(' / ')}。` +
  `該当があれば file:line と該当行を返す。無ければ「clean」とだけ返す。`,
  { phase: '残骸チェック' },
)
return { edits: edits.filter(Boolean), check }
```

## ルール（AGENTS.md の再掲・委任時も緩めない）

- コードと**同じコミット**に入れる。ドキュメントがズレたまま「完了」と言わない。
- 章をまたぐ変更（定数変更→計算結果も変わる等）は関連ページ全部を対象に入れる。
- 仕様変更を伴わない純リファクタは同期不要。
