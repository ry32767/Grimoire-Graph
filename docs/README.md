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
| 04b | [misfire-instability.md](04b-misfire-instability.md) | **暴発の不安定化・累積・崩壊**：instability（膜メーター）・三段階の開示・半径のばらつき・崩し手との接続 |
| 05 | [enemies.md](05-enemies.md) | **敵**：系統（直進/弧/波/渦/昇り/捻れ）・ロール（attacker/breaker/guardian/ruptor）・敵 AI の探索・崩し手の極 |
| 05b | [enemy-archetypes.md](05b-enemy-archetypes.md) | **攻撃パターン4種**（火力型/迂回型/暴発型/守護型）× 軌道 family × z場・多重詠唱 |
| 06 | [stages.md](06-stages.md) | **ステージ**：全 7 面の敵・障害物・LVL・ボスフェーズの完全一覧（実装値） |
| 06b | [difficulty-framework.md](06b-difficulty-framework.md) | **難易度フレームワーク（LVL）**：数値スケール・関数/パターン解放表・壁の指針・第7面フェーズ設計 |
| 07 | [animation.md](07-animation.md) | **アニメーション**：解決演出のタイムライン・描画レイヤー・パーティクル・音 |
| 08 | [constants.md](08-constants.md) | **定数リファレンス**：全バランス数値の一覧表 |
| 09 | [data-model.md](09-data-model.md) | データモデル（型）・ターン進行・解決順序・モジュール構成 |
| 10 | [recording.md](10-recording.md) | （開発ツール）アニメーションの録画・GIF 作成手順（Playwright + 同梱 ffmpeg / gifenc） |
| — | [story.md](story.md) | **ストーリー**：全7面の刻印・背景描写・導入/クリア文・崩壊イベントのテキスト（`src/data/story.ts` の原典） |
| — | [lore.md](lore.md) | **背景設定（作者用）**：見えない軸 z・古代式・グリモワールの正体・滅びの真相（作中では匂わせるのみ） |

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
