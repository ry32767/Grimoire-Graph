# Grimoire Graph 仕様ドキュメント（docs）

> Graph Mage（グラフメイジ）の**実装に即した最新の詳細仕様**をまとめたリファレンスです。
> 「概念の合格ライン」は [`../graph_mage-spec.md`](../graph_mage-spec.md)、「人間向け概要」は [`../README.md`](../README.md)、
> 「AI エージェントの作業規約」は [`../AGENTS.md`](../AGENTS.md) を参照してください。
> このフォルダは **実際のソース（`src/`）から逆引きした、関数・数値・計算式レベルの詳細** を扱います。

最終更新の対象コミット時点のソースに基づきます。数値はすべて `src/data/constants.ts` などの実装値です。

## 目次

| # | ドキュメント | 内容 |
|---|---|---|
| 01 | [overview.md](01-overview.md) | 概要・コアコンセプト・世界観・画面フロー・登場人物（パーティ） |
| 02 | [calculations.md](02-calculations.md) | **計算方法**：座標系・物理（加速度/速度/消滅）・属性 z 場・強度・相性・威力・ダメージ・状態異常 |
| 03 | [functions.md](03-functions.md) | **関数**：軌道プリセット（回転/極座標）・z 場プリセット・自由入力式（mathjs）・サンプリング |
| 04 | [magic.md](04-magic.md) | **魔法**：発射型/軌道型（結界）の二系統・暴発・パリィ・障害物のえぐり取り・結界の永続化 |
| 05 | [enemies.md](05-enemies.md) | **敵**：系統（直進/弧/波/渦）・ロール（attacker/breaker/guardian）・敵 AI の探索 |
| 06 | [stages.md](06-stages.md) | **ステージ**：全 7 面の敵・障害物・導入文・解禁メカニクスの完全一覧 |
| 07 | [animation.md](07-animation.md) | **アニメーション**：解決演出のタイムライン・描画レイヤー・パーティクル・音 |
| 08 | [constants.md](08-constants.md) | **定数リファレンス**：全バランス数値の一覧表 |
| 09 | [data-model.md](09-data-model.md) | データモデル（型）・ターン進行・解決順序・モジュール構成 |

## 30 秒でわかるコアループ

1. **敵公開フェーズ** … 各敵がこのターン撃つ術式の「形」を頭上の記号〔直進/弧/波/渦〕とゴースト軌道で予告する。
2. **作成フェーズ** … 味方 3 人それぞれに、**軌道関数**（どこを飛ぶか）と **z 場**（属性の高さ z=f(x,y)）を割り当てる。
3. **解決フェーズ** … 全員＋敵が**同時に発射**。物理・相殺・障害物・命中をまとめて解決し、演出を再生する。

属性は「描いた z 場の符号」で決まる（**z>0 で光、z<0 で闇、|z|<ε で中立**）。
威力は **命中点の速度 × 属性強度**。強度は |z| が `zPeak(=5)` に近いほど最大という **山型**。
ただし |z| が `zRef(=2.5)` を超えると弾は**減速**し、速度 0 で**霧散**する——「強さ」と「到達」のトレードオフが駆け引きの核心。

## ソースの場所（逆引き）

| 知りたいこと | 主なファイル |
|---|---|
| 物理（加速度・速度） | `src/game/physics.ts` |
| 属性・強度・ダメージ | `src/game/attribute.ts` |
| 関数カタログ・自由入力 | `src/game/functions.ts` / `src/game/mathEngine.ts` / `src/game/zfields.ts` |
| ターン解決の中核 | `src/game/turn.ts` |
| 敵 AI | `src/game/enemyAI.ts` |
| 結界（軌道型魔法） | `src/game/orbit.ts` / `src/game/loop.ts` |
| 障害物のえぐり | `src/game/obstacle.ts` |
| バランス定数 | `src/data/constants.ts` |
| ステージ・敵・パーティ | `src/data/stages.ts` / `src/data/party.ts` |
| 描画・演出 | `src/render/draw.ts` / `src/components/BattleCanvas.tsx` / `src/render/theme.ts` |
| 音 | `src/audio/sound.ts` |
</content>
</invoke>
