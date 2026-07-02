# 06. ステージ（全 7 面・実装値）

定義は `src/data/stages.ts`。スケール 1.5 倍（場 `rField=30`）。敵は上方、味方は下方。
**難易度の枠組み（LVL・数値スケール・解放表）は [06b-difficulty-framework.md](06b-difficulty-framework.md)**。本ファイルは実装されている配置・数値の一覧。
障害物の素材は `solids`（重なった円の和＝連続ブロブ）と `rects`（軸並行の矩形＝四角い壁・#56）で表す。`R=2.4`（円の半径）、`STEP=2.4`（円の間隔）。柱・螺旋は円、壁・ブロックは矩形（角がシャープ）を使う。

共通：`castInitialSpeed=8`（全敵固定）。HP は基礎 100 × LVL 倍率（`LVL_SCALE`・明示指定があればそちら）。castMag も LVL 依存（[06b](06b-difficulty-framework.md) §2）。

## 障害物のヘルパー

| 関数 | 形 |
|---|---|
| `pillar(cx, y0, n, element, kind?)` | 縦の柱（上へ n 個の円・丸い） |
| `block(x0, y0, cols, rows, element, kind?)` | 四角いブロック（cols×rows ぶんを覆う矩形・#56） |
| `wall(x0, x1, y0, rows, element, kind?)` | 横一列の四角い壁（rows 段ぶんの厚みの矩形・#56） |
| `colonnade(x0, x1, step, y0, n, elems[])` | 列柱（step 間隔で縦 n 段の柱を並べ、elems を順に割当） |
| `spiralArm(cx, cy, n, turns, phase, element)` | アルキメデス螺旋の腕 |

> `block`/`wall` は #56 で円敷き詰めから矩形（`obRect`）へ変更（footprint はほぼ同じ／角がシャープ）。当たり判定・削れ（`carves` で円を引く）・暴発 AoE は円・矩形どちらにも対応（`isSolidAt` / `obstacleOverlapsCircle` / `materialCells`）。

`mechanics`：`obstacles`（障害物有効か）・`enemyFire`（敵が撃つか）の段階的解禁。

---

## ステージ 1 ― 第一の間・門（LVL 1）

- **mechanics**：障害物なし・敵発射なし（命中だけを学ぶ）。
- **障害物**：なし。

| 敵 | 属性 | LVL | HP | 系統 | ロール | 配置 |
|---|---|---|---|---|---|---|
| 石像の番人 | dark | 1 | 90 | line | attacker | (0, 19) |

---

## ステージ 2 ― 第二の間・通路（LVL 2）

- **mechanics**：障害物あり・敵発射あり。
- **障害物**：列柱 `colonnade(-18,18, 3.6, -1, 4, [dark,light])`＋中央にもろい瓦礫 `wall(-6,6,-1,1, neutral, fragile)`（「壊せる」を教える最初の壁）。

| 敵 | 属性 | LVL | HP | 系統 | ロール | 配置 |
|---|---|---|---|---|---|---|
| 回廊の衛士 | dark | 2 | 115 | arc | attacker（迂回型） | (-12, 19) |
| 影の射手 | dark | 2 | 115 | wave | attacker（迂回型） | (12, 20) |

---

## ステージ 3 ― 第三の間・踊り場（LVL 3）

- **テーマ**：相性（反対極×1.5）と normal 壁。火力型の初登場。
- **障害物**：全幅の光壁 `wall(-18,18,5,1,light)`＋闇の塔 `pillar(±13,-3,5,dark)`＋砕けぬ芯柱 `pillar(±7,9,2,neutral,unbreakable)`（迂回強制）＋もろい囲い `wall(-9,-3,-17,1,neutral,fragile)`。

| 敵 | 属性 | LVL | HP | 系統 | ロール | 配置 |
|---|---|---|---|---|---|---|
| 白の祭司 | light | 3 | 130 | line＋arc | breaker（火力型） | (-13, 19) |
| 黒の祭司 | dark | 3 | 130 | line＋arc | breaker（火力型） | (13, 19) |
| 祭壇の影 | dark | 2 | 115 | wave | attacker | (0, 23) |

---

## ステージ 4 ― 第四の間・螺旋（LVL 4・暴発の提示）

- **テーマ**：守護型（基礎・単色オーラ）の初登場。**暴発デモ（RUPTOR_DEMO）**。
- **障害物**：全幅の瓦礫壁 `wall(-18,18,1,1,dark)`＋光と闇の渦 `spiralArm(0,7,8,1.2, 0/π, light/dark)`。

| 敵 | 属性 | LVL | HP | 系統 | ロール | 配置 | 特記 |
|---|---|---|---|---|---|---|---|
| 渦の番兵 | dark | 4 | 150 | spiral | guardian（基礎・闇オーラ） | (-14, 18) | |
| 坑道の弓手 | light | 3 | 130 | spiral＋arc | attacker | (0, 23) | |
| 崩し手 | dark | 5 | 165 | wave | **ruptor** | (14, 18) | `ruptorTarget='obstacles'`（壁狙い）・`fireEvery=2, fireOffset=1`（1・3・5…ターン目） |

- 初の敵暴発が解決すると、RUPTOR_DEMO＋図鑑補足のオーバーレイが一度だけ出る（[04b](04b-misfire-instability.md) §4b.4b）。

---

## ステージ 5 ― 第五の間・深層の広間（LVL 5・鏡像）

- **テーマ**：数で攻める。左右が光闇の鏡像。**同極すり抜け**の初登場。
- **障害物**：左列柱 `colonnade(-18,0,3.6,-1,4,[light])`／右列柱 `colonnade(3.6,18,3.6,-1,4,[dark])`＋割れない鏡枠 `pillar(±18,8,3,neutral,unbreakable)`。

| 敵 | 属性 | LVL | HP | 系統 | ロール | 配置 | 特記 |
|---|---|---|---|---|---|---|---|
| 鏡像の衛士（光） | light | 4 | 150 | line＋exp | breaker | (-15, 18) | |
| 鏡像の衛士（闇） | dark | 4 | 150 | line＋exp | breaker | (15, 18) | |
| 鏡像の射手（闇） | dark | 5 | 165 | wave＋poly34 | attacker | (-7, 23) | `slipThrough`＋sin/cos z場 |
| 鏡像の射手（光） | light | 5 | 165 | wave＋poly34 | attacker | (7, 23) | `slipThrough`＋sin/cos z場 |

---

## ステージ 6 ― 第六の間・封印帯（LVL 6・初回崩壊面）

- **テーマ**：暴発の**誘発**。崩し手3体＋交互張りの守護型。**初回崩壊（グリモワール救済）**がこの面で必ず起きる（ターン2以降・[04b](04b-misfire-instability.md) §4b.2）。
- **障害物**：3段重ねの封印壁 `wall(-18,18,1,3,dark)`＋砕けぬ封印核 `block(-2,1,3,2,neutral,unbreakable)`＋取っ掛かりの光柱 `pillar(±17,-3,2,light)`。

| 敵 | 属性 | LVL | HP | 系統 | ロール | 配置 | 特記 |
|---|---|---|---|---|---|---|---|
| 封印の番人 | light | 6 | 185 | wave | guardian | (0, 23) | `alternatingAura`（奇数ターン=光/偶数=闇） |
| 崩し手・弧 | dark | 6 | 185 | arc | **ruptor** | (-13, 19) | `fireEvery=2, fireOffset=1` |
| 崩し手・波 | light | 6 | 185 | wave | **ruptor** | (13, 19) | `fireEvery=2, fireOffset=0` |
| 崩し手・捻れ | dark | 6 | 185 | poly34 | **ruptor** | (0, 16) | `fireEvery=2, fireOffset=1` |

- 3体は属性・family・タイミングをずらして撃つ。反対極の結界・パリィで**個別に防げる**（防げば `instability` は積まない）。

---

## ステージ 7 ― 第七の間・大広間（LVL 7・ボス戦・HPフェーズ制／#45）

- **テーマ**：総力戦。ボスは**多重詠唱**（#44）。HP 66%／33% で**床が崩れ**、アリーナが入れ替わる。撃破後に**断末魔の暴発3連**。
- **上層（開始時）**：列柱 `colonnade(-18,18,3.6,-2,5,[light,dark])`＋守護者の盾 `block(-4,-3,4,3,light)`。

| 敵 | 属性 | LVL | HP | 系統 | ロール | 配置 | 特記 |
|---|---|---|---|---|---|---|---|
| 魔導書の守護者 | light | 7 | 380 | wave＋line/arc/exp/poly34 | boss・多重詠唱 | (0, 23) | hitbox 3.6・`castCount=2`・`patternPool=[breaker, attacker]` |
| 守護者の眷属（迂回） | dark | 6 | 130 | spiral＋poly34 | attacker | (-15, 17) | `slipThrough`＋sin/cos z場 |
| 守護者の眷属（火力） | light | 6 | 130 | line＋arc | breaker | (15, 17) | |

### HP フェーズ（`Stage.bossPhases`）

| フェーズ | 条件 | castCount | アリーナ | 眷属 |
|---|---|---|---|---|
| 上層（開始） | — | 2 | 列柱＋盾 | 2体 |
| 中層 | HP ≤ 66% | 2 | `wall(-10,10,-1,1,dark)` のみ（開けている） | 残存 |
| 下層 | HP ≤ 33% | **3** | **障害物なし**（逃げ場が少ない） | **間引き**（崩落に呑まれる） |

- フェーズ移行時：床崩落のログ＋COLLAPSE_PHASE オーバーレイ。持続結界（周回）は崩落で全て霧散する。※「落下中の暗転1ターン」は未実装（テンポ優先・[06b](06b-difficulty-framework.md) §8）。

### 断末魔（暴発3連・撃破の最終演出）

- ボス HP が 0 になっても勝敗は確定せず（`finale='pending'`）、**次のターンにボスが暴発型3連の「最後の一手」を晒して放つ**（`finaleVariant`＝role: ruptor・castCount: 3。予告＝ゴースト＋赤✕×3）。
- 3本とも**通常ルールの弾**：反対極の結界・パリィで速度0にすれば暴発せず、`instability` も積まない。防げなかった分は通常の暴発（常に最大威力・両極性）＋ `instability +1`（最大+3）。
- このタイミングで `instability` が上限（12）に達すれば、**ボス撃破後でもステージ全体暴発＝ゲームオーバー**（免除なし）。
- 3本を解決したのちに勝敗判定へ進む（`finale='done'` → クリア）。
