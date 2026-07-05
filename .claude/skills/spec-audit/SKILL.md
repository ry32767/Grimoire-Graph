---
name: spec-audit
description: 「仕様と実装がズレていないか確認して直して」系の範囲の広い監査を、AGENT_PLAYBOOK に従って Workflow（並列監査＋敵対検証）で実行しトークンを節約する。仕様準拠レビュー・広範囲の照合タスクで使う。
---

# 仕様照合監査（Workflow 並列版）

[AGENT_PLAYBOOK.md](../../../AGENT_PLAYBOOK.md) の手順の「監査→再検証」部分を
Workflow で並列化する。**本体は一次資料の読解・所見の最終判断・修正だけを行い、
ファイルの通読は監査エージェントに任せる。**

## 手順

1. **本体**：AGENTS.md／graph_mage-spec.md の該当節／対象 docs を読み、監査領域を分割する
   （PLAYBOOK §1 の4分割が既定：コア数式／ターン・戦闘・敵AI／UI・描画／関数評価・座標系。
   タスクの中心に合わせて境界を引き直してよい）。
2. **Workflow**：領域ごとに監査エージェント → 所見ごとに敵対検証エージェント（pipeline）。
3. **本体**：CONFIRMED の所見だけ自分でも file:line を開いて確認し（鵜呑み禁止・PLAYBOOK §3）、
   修正 → テスト → docs 同期（/docs-sync）→ 検証ループ（/verify-loop）。

## Workflow スクリプトの雛形

```js
export const meta = {
  name: 'spec-audit',
  description: '仕様と実装の乖離を領域並列で監査し、所見を敵対検証する',
  phases: [{ title: '監査' }, { title: '検証' }],
}
// args = { areas: [{ name, files, specRefs }], focus: '照合の観点（ユーザー指示の要約）' }
const FINDINGS = {
  type: 'object', required: ['findings'],
  properties: { findings: { type: 'array', items: {
    type: 'object', required: ['file', 'line', 'quote', 'specRef', 'severity', 'claim', 'fix'],
    properties: {
      file: { type: 'string' }, line: { type: 'number' }, quote: { type: 'string' },
      specRef: { type: 'string' }, severity: { enum: ['spec-violation', 'bug', 'improvement'] },
      claim: { type: 'string' }, fix: { type: 'string' },
    } } } },
}
const VERDICT = {
  type: 'object', required: ['confirmed', 'reason'],
  properties: { confirmed: { type: 'boolean' }, reason: { type: 'string' } },
}
const results = await pipeline(
  args.areas,
  (a) => agent(
    `Grimoire-Graph の仕様照合監査。対象: ${a.files}。正: ${a.specRefs}（specが正・テストは参考）。` +
    `観点: ${args.focus}。仕様逸脱と本物のロジックバグだけを、file:line・実コード引用・` +
    `仕様側該当箇所・重大度・修正案つきで報告。検証できない推測は報告しない。`,
    { label: `audit:${a.name}`, phase: '監査', schema: FINDINGS },
  ),
  (r, a) => parallel((r?.findings ?? []).map((f) => () =>
    agent(
      `敵対検証: 次の監査所見を「反証」する前提でコードと仕様を読み直す。\n${JSON.stringify(f)}\n` +
      `本当に仕様違反/バグか？ 仕様の読み違い・docsの表現が古いだけ・実害なしなら confirmed=false。`,
      { label: `verify:${f.file}:${f.line}`, phase: '検証', schema: VERDICT },
    ).then((v) => ({ ...f, area: a.name, verdict: v })),
  )),
)
const flat = results.filter(Boolean).flat().filter(Boolean)
return {
  confirmed: flat.filter((f) => f.verdict?.confirmed),
  rejected: flat.filter((f) => !f.verdict?.confirmed).map((f) => ({ file: f.file, claim: f.claim, reason: f.verdict?.reason })),
}
```

## 本体側の規律（PLAYBOOK の再掲・委任しても省略しない）

- confirmed でも**自分の目で file:line を開いて**から直す（もっともらしい誤報が一番危険）。
- 疑わしければ /balance-probe の一時テストで再現してから直す。
- 修正1件＝コード＋回帰テスト＋docs を同じコミットで。完了前チェックリスト（PLAYBOOK 末尾）を通す。
