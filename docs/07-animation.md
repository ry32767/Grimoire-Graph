# 07. アニメーション・描画・音

解決演出は `src/components/BattleCanvas.tsx`（タイムライン駆動）と `src/render/draw.ts`（描画関数群）、
配色は `src/render/theme.ts`、効果音/BGM は `src/audio/sound.ts`。
Canvas は内部解像度 `INTERNAL = 520`px 正方形、ビューポート `unitsRadius = rField(30)`。

---

## 7.0 UI レイアウト（`styles/battle.css` / `styles/console.css` / `styles/tokens.css`）

戦闘画面は **DC プロトタイプ v3 の 4 段構成**（`.gm-shell`）。
旧 UI（盤面⇄術式シートの 2 ビュー切替・コマンド窓・ステータス窓・「敵公開 → 術式を構える」ゲート）は**廃止**した。

```
┌ 上段レール  .top-rail    間の名前・進行ドット・ターン・味方/敵の合計HP・膜メーター・≡
├ 読み出し    .readout-strip
├ 本体        .gm-body     盤面 .gm-board ｜ 右レール .gm-rail（読み取り値 / z(t) / 術者）
└ コンソール  .gm-console  詠唱コンソール .spell-console ｜ 発射列 .fire-col
```

- **シェル**：広幅は `position: fixed; inset: 0` の固定シェル（ページはスクロールしない）。
  狭幅（`max-width: 1000px`）では `position: static` に戻して縦積み＋ページスクロールへ切り替える。
- **盤面は常に正方形**：`.gm-board` を `container-type: size` にし、
  `.gm-board-inner` の一辺を `min(100cqw, 100cqh)` で決めて中央に置く（幅と高さの小さい方に合わせる）。
  狭幅では `width: min(100%, 62vh)` ＋ `aspect-ratio: 1/1`。
- **盤面に重ねるもの**：θ の読み（左上）・凡例（右上、戦闘ログのタブの下）・戦闘ログ（右上）・
  見返しバー（下）・ズーム（右下）。**敵の残り HP は各敵の頭の上**に描く（`drawEnemyHpBars`）ので、
  盤面隅に敵陣営ウィンドウは置かない。
- **右レール**：読み取り値 4 マス → z(t) 断面 → 術者カード。狭幅では横スクロールの 1 行になる。
- **発射列**：記号盤 / ? / 図鑑 → 全員おまかせ → 詠唱ボタン（危険域では `⚠ それでも発射`）。

### タイトル画面（`TitleScreen` + `render/titleScreen.ts`）

背景は canvas アニメーション：z(t) の同心円の上を y=f(x) の軌道に沿って詠唱の光が走り、
足元にその点の y・z の値が出る。動きはすべて周期 8.4 秒の周期関数なので継ぎ目なくループする。
左に見出しと 3 つの導線（詠唱を始める／はじめての人へ／間を選ぶ・試しの間）。

### レスポンシブと操作寸法

ブレークポイントは `1000px`（レイアウト）と `820px`（タップ寸法・文字サイズ）。
狭幅での `.btn` と `.btn.small` の最小タップ高は操作トークン `--touch-target: 44px` に統一する。

---

### 上部読み出しストリップ（`ReadoutStrip`・`styles/console.css`）

盤面のすぐ上に置く 1 行の帯。`width: min(100%, 860px)`・中央揃え、左に太い縁（`border-left: 4px`）。
縁と見出しの色は「いま何が読めているか」の 1 色だけを載せる：

| 状態 | 色 | 見出しの例 |
|---|---|---|
| 命中予測 | `--light` | `石像の番人 まで r = 16.2 ／ 当たれば 45` |
| 発散（暴発）／ひるみ | `--hp-low` | `t=12.4 で発散 → 暴発` |
| 失速・敵の結界 | `--dark` | `r まで届かない（失速）` |
| 式エラー | `--hp-low` | `式が読めません` |

出し分けの優先順は [03 §3.6](03-functions.md)。狭幅（`max-width: 820px`）では 2 行へ折り返す。

### 詠唱コンソール（`FunctionPanel` / `ZFieldControls` / `DraftPad`）

術式編集ウィンドウの中身。**y（軌道）と z（属性場）を別入力**として上下に並べ、
**いま編集している側のコントロールだけ**を出す（もう片方は隠す）。

- `y=` 欄 … 自由式。`r=` で始めると結界（極座標 `r=f(θ)`・`mode:'polar'`）へ切り替わる。
  右に「作図」（作図台の開閉）と「θ 回転 ⟳ 解く」（数値解＋現在角の表示）。
- `z=` 欄 … 変数は `t`＝術者からの距離。右に「属性 自動」（t=r での光/闇/中立）。
- **y 編集中** … 式から自動検出した係数スライダー／術式チップ（軌道 6 種・結界 5 種）／盤面の通過点フィット。
- **z 編集中** … z 整形（山・段・波・平＋ `t₀` `w` `z₀` スライダー＋`t₀ ← r`）と z 強度ゲージ。
- 記号盤（キーパッド）は開閉式。押した記号は**編集中の欄のキャレット位置**へ差し込む。

### 作図台（`DraftPad`）

関数空間の方眼紙（盤面ではない）。**係数をいじる**／**点から作る**の 2 モード。
点は格子点（整数）に吸着し、1〜3 次の最小二乗多項式を破線で重ねる。「式にする ▸」で y（または z）へ反映する。

---

---

## 7.1 解決演出のタイムライン（`BattleCanvas`）

演出は **弾の実速度がそのまま再生速度になる**（演出の速さ＝弾の速さ）。`requestAnimationFrame` で駆動。

### 2 つのフェーズ

| フェーズ | 長さ | 内容 |
|---|---|---|
| **飛行（flight）** | `flightMs` | 弾が飛び切るまで。`MIN_MS(700)`〜`MAX_MS(2300)`。結界がある場合は下限 1600ms。 |
| **余韻（tail）** | `tailMs` | 着弾後の残響。暴発=`MISFIRE_TAIL_MS(1000)`、霧散/結界破壊=`max(IMPACT_TAIL_MS, DISSIPATE_MS+150)`、通常命中/相殺=`IMPACT_TAIL_MS(450)`、なし=0。 |

合計 `realMs = flightMs + tailMs`。

### 作成フェーズのオーバーレイ（`BattleCanvas`）

解決演出がない作成フェーズでは、盤面に操作補助を重ねて描く：

- **発射方向の矢印**（`drawAimArrow`・#47）：active ally から θ 方向へ金色の矢印。盤面ドラッグで θ を変えると追従。
- **通過点の✛**（`drawFitPoints`・#46）：選んだ通過点を連番つきで表示。
- **点ピックのルーペ**（`drawPickLoupe`・#49）：点ピック中のドラッグで、**指の少し上に拡大鏡**（`ctx.drawImage(ctx.canvas, …)` で指の下を `zoom=2.6` 拡大・`imageSmoothingEnabled=false`）を出し、中心クロスヘアと着地点✛を描く。指で点が隠れない。ポインタ移動時は `composeDrawRef` 経由で盤面を再描画してから重ねる。

### 速度→時間の対応（`buildTimeline` / `posAtTime`）

各弾サンプル `{pos, speed, arcLen, z}` を逆速度で積分して時間を作る：

```ts
ds   = arcLen[i] − arcLen[i-1]
v    = max(MIN_SPEED(0.5), (speed[i] + speed[i-1]) / 2)
t[i] = t[i-1] + ds / v
maxTotal = 全弾タイムラインの最大
flightMs = min(MAX_MS, max(floorMs, maxTotal × MS_PER_GAMESEC(360)))
```

毎フレーム：`elapsed = now − start`、`e = min(1, elapsed/flightMs)`、`tau = e × maxTotal`（ゲーム内時刻）で各弾位置を線形補間。速い弾は早く着き、遅い弾は長く飛ぶ。

### 主なイベントと演出時間

| イベント | 発火条件 | 長さ | 主な描画関数 |
|---|---|---|---|
| 弾の飛行 | サンプルあり | flightMs | `drawBullet` + `drawWaveTrail` |
| 障害物えぐり | 弾が `carve.arcLen` を通過 | `CARVE_BURST_MS=480`（到達時刻から実時間） | `drawCarveBurst`（岩片飛散・赤橙） |
| 命中フラッシュ | `arcLen ≥ impact.arcLen` | `FLASH_MS=420` | 赤フラッシュ＋画面揺れ |
| クラッシュ火花 | 2 弾が `CLASH_DIST=1.6` 以内 | `CLASH_MS=460` | `drawClashSpark`（青白い火花） |
| 結界の霧散 | 壁/弾に負ける。**弾が破壊点（`AnimOrbit.carves[0]`）へ到達した瞬間**から散り始める（#64：`resolveTurn` が記録する `enemyRings[].breakPos`／`orbitBreaks` を App が同期点として渡す。同期点が無いときの保険は `e≥0.4`） | `DISSIPATE_MS=520` | `drawOrbitDissipation`（リング消失・粒拡散） |
| 弾の霧散 | 速度 0 | `DISSIPATE_MS=520` | `drawBulletDissipation`（コア収縮・粒拡散） |
| 暴発 | `misfirePos` 到達 | `MISFIRE_TAIL_MS=1000` | `drawMisfire`（収縮→大爆発の 2 段） |
| 撃破（雑魚・種族別） | 致命弾のフラッシュ開始（取れなければ `e≥0.9`） | `DEATH_MS=900` | `drawEnemyDeath`（種族ごとの消滅・05c §6.5） |
| 撃破（ボス最終崩壊） | ボス撃破確定（`outcome='cleared'`） | `BOSS_COLLAPSE_MS=2200` | `drawBossCollapse`（装甲落下→粒子ほどけ→天秤水平） |

### 種族別の撃破演出（`drawEnemyDeath`・05c §6.5・#46）

敵 HP が 0 になった撃破を、種族ごとに描き分ける（**当たり判定・ダメージ計算には一切影響しない、描画タイムラインのみ**）。`ResolveAnimation.deaths[]`（`{id,pos,species,element,tier,hitboxRadius,boss}`）を App が「このターン hp>0→hp≤0 になった敵」から作り、`BattleCanvas` が `deathStartById[id]` に**そのフラッシュ開始時刻**（＝致命弾の到達）を記録して `progress` を進める。開始した敵は `hideEnemyIds` で生存スプライトを隠し、消滅アニメへ譲る。

- **DoT（burn）撃破の消滅演出（バグ修正）**：継続ダメージ（闇属性が付与する `burn`）は解決フェーズ（`resolveAllyCasts`）ではなく**ターン開始の `prepareTurn`** で適用される（`turn.ts` には DoT 参照がない）。そのため通常命中・掃射・暴発と違い、解決直後の before/after 比較（`battle.enemies`→`after.enemies`）では DoT 撃破が拾えず、以前は**種族別の消滅アニメが一切再生されずに敵が無演出で消えていた**。現在は `onAnimationDone` で `prepareTurn(after)` を実行した直後に「`after` で hp>0→`prep.state` で hp≤0」になった敵を検出し（撃破前スナップショットは `after.enemies` から取る）、`deaths` だけの短いアニメを一度挟んでから次ターン盤面へ進む。この間は `pendingPrepRef` に準備済み状態を退避し、`onAnimationDone` が `prepareTurn` を**再実行しない**（DoT の二重適用を防ぐ）。ロジック（hp・勝敗）は不変で演出のみ追加。
  - **同ターンに主解決の撃破と DoT 撃破が同居するときの盤面（バグ修正）**：burn 中間アニメを流す前に**盤面を `after`（主解決後の敵配列）へ更新**してから `setAnimation({deaths:burnDeaths, bossView})` する。これをしないと、`BattleCanvas` が主解決前の `battle.enemies`（全員 hp>0）を描き、`hideEnemyIds` は burnDeaths の ID しか含まないため、**主解決で撃破済みの敵が生存スプライトで一瞬“生き返って”見えた**。`after` を渡せば `drawEnemies` が hp≤0 の主解決撃破敵をそもそも描かず、burnDeaths の敵だけが消滅アニメで消える。ボスを burn で倒す場合の外見崩れも防ぐため `bossView`（phase/finale/outcome）も `after`/`prep` 準拠で渡す。

| 種族 | 消滅の見た目 |
|---|---|
| 原型（proto） | ひび割れて光の粒になって崩れる（基準形） |
| 鋼鬼（oni） | 膝から沈み、鎧の破片が飛散→一部は地面に瓦礫として残ってから消える（実体・重量感） |
| 亡霊魔術師（wraith） | ローブがほどけ、上方へ属性色の光の筋（3〜4本）となって静かに消える（破片なし） |
| 紅亡霊（redWraith） | 亡霊と同じ輪ほどけ＋消える直前に亀裂が強く明滅→細かな紅の光の破片が弾ける。**規模は AoE より遥かに小さく色も抑え、本物の暴発と誤認させない（AoE・ダメージなし）** |
| ゴーレム（golem） | 目の光が消え→同心円に沿って亀裂→その場に沈むように崩れる（破片はほぼ真下に積もる） |

### ボスの多段外見と最終崩壊（`drawBossSprite`/`drawBossCollapse`・#51・06b §6）

書物のページ状装甲＋天秤の意匠（左半身=光/金・右半身=闇/紫）。`bossView`（`{phase,finale,outcome}`）で段階変化する。**天秤の傾き**が最重要のビジュアル（story.md「傾き続けた天秤が水平で止まった」に対応）。

| 状態 | 装甲・核 | 天秤 |
|---|---|---|
| フェーズ1（`bossPhase=0`） | 装甲4枚・左右対称、核は見えない | 水平（0°） |
| フェーズ2（`=1`） | 装甲3枚・一部剥離して舞う | わずかに傾く（~0.22rad≒13°） |
| フェーズ3（`=2`） | 装甲2枚・核（金↔紫の発光体）露出・小刻みに明滅・刻印が裂けて光が漏れる | 大きく傾く（~0.7rad≒40°） |
| 断末魔（`finale='cast'`） | 激しい揺れ＋**3つの綻び**（`drawMisfire` の白紫の視覚言語を小さく流用・中央/左右） | 制御を失って激しく振れる |
| 撃破後（`outcome='cleared'`） | `drawBossCollapse`：①装甲・破片が落下 ②輪郭が光の粒でほどけ立ちのぼる ③最後に**天秤だけが残り水平（0）へ戻ってから消える** | 傾き→水平へ |

### 暴発の演出（`drawMisfire`＋ステージ全体演出・#29/#41）

**紫（闇）と黄（光）の腕がぐるぐる回りながら中心へ集まる大渦**（虚式・茈のイメージ）。**加算合成（`globalCompositeOperation='lighter'`）**で、紫と黄は**完全には混ざらず色を残し、重なった所だけ白っぽく光る**。中心は白熱し、進むほど白核が育って**最後は中心が白く埋まる**。**効果範囲（AoE）の内側を渦で埋め尽くす**（実効半径 `effR = aoeRadius × scale × 1.18` で少しだけ外へはみ出す）。**AoE 境界には白い明滅破線円**を `aoeRadius` ちょうどに描き、実ダメージ範囲を明示。

- **渦の腕**：`ARMS=12` 本（紫/黄が交互）×`PTS=32` 粒のらせん。各粒は `t = frac(k/PTS − inflow)` で**縁→中心へ流れ続ける**（常に AoE を充填）。角度は `base + t·WIND·2π + spin`（半径で巻く＝らせん）。`spin = progress×10`（ぐるぐる回る）。紫は黄より暗く見えるので濃いめ（α×1.45）に出して色を残す。
- **土台ハロ**：紫・黄の薄い放射グラデを少しずらして重ね、隙間なく埋める。
- **きらめき火花**：紫/黄/白が明滅しながら渦に散る（58 個）。
- **中心コア＋十字の星スパーク**：白熱コアは `progress²` で巨大化（最後は白飛び）。中心から白い十字スパークが明滅して伸びる。

**ステージ全体演出（`BattleCanvas`・#41）**：暴発中はフレーム全体を `ctx.translate` で**ガタガタ揺らす**（強さは爆発直後が最強→減衰、振幅 ~9px。ズレの隙間を防ぐため先に背景で塗る）。さらに上空から**遺跡の破片**（`drawFallingDebris`：石片がフィールド円内に降ってくる）が落下する。

### 画面揺れ（`shakeOffset`）

```ts
shakePhase = elapsed × 0.05
x = sin(shakePhase×1.3 + idSeed) × intensity × 5
y = cos(shakePhase×1.7 + idSeed×1.5) × intensity × 5
intensity = 1 − (elapsed − flashStart)/FLASH_MS    // 1→0 に減衰
```

`idSeed(id)` は ID から決定的に作る（揺れの位相を個体ごとに変える）。

---

## 7.1b 新規の演出（#42/#45/04b）

| 演出 | 実装 | 内容 |
|---|---|---|
| 暴発予告（崩し手） | `drawRuptureWarning` | 対詠の晒しフェーズで、計画された暴発点に赤い✕＋AoE 見込み範囲の**不安定に揺れる破線円**。予告がある間は作成フェーズもアニメーションループを回す |
| 崩し手のロール記号 | `drawRoleMarker`（role='ruptor'） | 縁から外へ走る赤い稲妻状のひび×3本（family glyph とは別の専用警告） |
| ステージの異変（04b） | `drawAnomaly` | 崩壊まで**残り1/3**（count≥misfireLimit×2/3）から開始。段階に応じて：亀裂＋背景の波打ち（1）→崩れかけ（2）→ひび増加＋画面周縁が赤黒く脈動（3）。数値は見せない |
| 暴発半径のブレ帯 | `drawMisfireBand` | 崩壊まで**残り2/3**（count≥vStart）から、プレビューの暴発✕の周囲に min–max の二重破線リング（04b §4b.3） |
| 暴発の激化（04b） | `BattleCanvas`（doom） | 崩壊へ近づくほど（doom=count/misfireLimit）暴発時の**画面の揺れ**（×(1+doom×1.5)）と**降る瓦礫の量**（×(1+doom×2)）が増える |
| 破局（致死崩壊） | `BattleCanvas`（collapse） | **暴発の効果範囲がステージ全体を覆う**：原点中心・半径 rField の暴発渦（`drawMisfire`）＋強まる揺れ＋最大量の瓦礫＋終盤の白熱フェード（約3秒）→ ゲームオーバーへ |
| 膜メーター | `Hud.tsx InstabilityMeter` | 初回崩壊後のみ表示。12 目盛り＋「あと N 回で崩壊」。残り2回以下で赤点滅 |
| 物語オーバーレイ | `App.tsx storyOverlay` | RUPTOR_DEMO／COLLAPSE_FIRST／COLLAPSE_PHASE／COLLAPSE_FINAL をモーダルで一度ずつ表示 |
| 敵の暴発爆発 | 既存 `drawMisfire` を敵弾にも適用 | `EnemyShot.misfired` のとき弾の終端で爆発（味方の暴発と同じ演出） |

---

## 7.2 描画レイヤー（背面→前面・`draw.ts`）

| # | レイヤー | 主な内容 |
|---|---|---|
| 0 | 背景 | `COLORS.bg` 塗り、**1 ユニット格子**（1マス=数学1ユニット・#53）、5ユニットごとに濃い大目盛り（`COLORS.gridMajor`）、原点軸、場の境界円（半透明紫）。格子の範囲は `visibleBounds(vp)` から決め、ステージのスケール（`unitsRadius`）を変えても画面全体を覆う |
| 1 | z 場オーバーレイ（作成フェーズは常時・#55） | 光=金の薄塗り（不透明度 0.04〜0.20）、闇=紫の薄塗り（0.05〜0.23）。強度に比例。**セルは方眼と同じ1ユニット**で、整数境界の各マスを中心 (x+0.5, y+0.5) の z で塗る（格子に整列・#53） |
| 1b | z 場エラー overlay（編集時・#30） | 場がエラーになる地点を全て赤 `rgba(255,60,60,0.5)`（`drawZFieldErrors`）。極=赤い線（二分法 `isPoleBetween` で検出）、定義域外=赤い領域 |
| 2 | 敵ゴースト軌道（予告） | `COLORS.ghost` の破線 `[5,4]` |
| 3 | 障害物 | solids（円）＋rects（四角・#56）を描き carves を `destination-out` で打ち抜き、種別ごとのピクセルアート・タイルを `source-atop` で敷き詰める（石積み/亀裂/鋲/鋼板） |
| 4 | 味方の予測軌道（編集時） | 中立色の線（#21：プレビューでは z＝属性を線色で見せない。属性は z 場オーバーレイ側で読む） |
| 4b | 暴発点マーカー（編集時・#30） | 関数（軌道 or z 場）がエラーで暴発する点に**赤い ✕**（`drawMisfireMarker`・`#ff4b4b`・最前面）。`Preview.misfirePos` 由来 |
| 5 | 敵 | オーラ→暗い下地→属性枠→ロール印（guardian=二重破線/breaker=棘）→**種族別スプライト**（`drawSpeciesSprite`：oni/wraith/redWraith/golem/proto を species×tier で手続き描画。ボスは `drawBossSprite`・#46/#51）→系統 glyph→名前ラベル→被弾フラッシュ。撃破時は生存スプライトを隠し消滅アニメ（`drawEnemyDeath`/`drawBossCollapse`）へ譲る |
| 6 | 味方術者 | オーラ→アクティブ強調リング（破線）→ドット絵スプライト→隠蔽ヴェール→名前→被弾フラッシュ |
| 7 | HP バー | 敵/味方の上 |
| 8 | 弾の波トレイル | `drawWaveTrail`：2 本の正弦波（180°位相差）＋トレイル粒 |
| 9 | 飛行する弾 | `drawBullet`：外周グロー→shadowBlur→回転スパイク→白いコアの多層グロー |
| 10 | 結界リングの粒 | 18 粒がリングを 1.1 周。各粒に 5 点の尾。`zColor` で属性色。**進み方は点ごとの速度に連動**（#60：`ringTimeline`＝Σ ds/speed の累積時間で phase→index を写像。速い区間は素早く抜け、遅い区間で粒が密集）。粒サイズも触れた点の速度×強度（`ptSpeed`）。**#63：同じターン内で速度を累積**＝1周ぶんの正味エネルギー変化 `dSq=speed[last]²−speed[0]²`（>0＝加速する場 |z|<zRef）で、解決の進行 e が進むほど回転が加速/減速し粒も拡大/縮小（`spin=e+accum·e²/2`・`mult=1+accum·e`）。累積は解決アニメーション内のみ（ターンをまたがない）。加速する場・非対称なリング（螺旋等）で顕著、対称な円で dSq≈0 なら一定 |
| 11 | 結界の霧散 | `drawOrbitDissipation` |
| 12 | えぐりバースト | `drawCarveBurst`（岩片） |
| 13 | クラッシュ火花 | `drawClashSpark` |
| 14 | 暴発 | `drawMisfire` |
| 15 | 弾の霧散 | `drawBulletDissipation` |
| 16 | 隠蔽ヴェール | 自陣の闇結界＝`drawConcealVeil`（内側を 3px ぼかし＋暗幕 `rgba(6,5,14,0.5)`）。**敵 guardian の闇結界＝`drawEnemyConceal`（#61/#62）**：作成フェーズで内側を 5px ぼかし＋薄幕 `rgba(10,7,20,0.5)` で**z 場・予測経路を隠す**（1枚＝見づらいがギリギリ見える）。**2枚が重なった領域は交差クリップで不透明な黒＝全く見えない**（自陣隠蔽の 1重/2重 と同じ）。破線の境界。`standingOrbits[].owner` で切替 |
| 17 | ダメージ／回復の数値（#42） | `drawDamageNumber`：被弾/回復の数値が浮かび上がる。**揺れの外**（UI として安定）に最前面で描く |

### 弾の色・大きさ

```ts
bulletColorOf(z):  光→#f4c430 / 闇→#7b5cc4 / 中立→#d9d4ea
powerSizeFrac(speed, z) = min(1, strengthOf(z)×max(0,speed) / (sMax×maxFlightSpeed))
                        = min(1, 威力 / (5×24))           // 威力 = 速度 × 属性強度
sizeFrac = max(0.06, powerSizeFrac)                   // 最低限見える小ささだけ確保し、あとは威力に比例
pulse = 1 + sin(phase×1.7)×0.25                       // 0.75〜1.25 で脈動
glowR = (4 + sizeFrac×22) × pulse,  coreR = (1.3 + sizeFrac×4.2) × pulse
```

弾の大きさは**威力（=その点の速度×属性強度）にそのまま比例**する（#45）。速度0や弱属性なら小さく、最大威力で最大。
以前は強属性へ下駄（`sFrac×0.4`）を履かせ基準サイズも大きかったため、威力が低くても常に大玉に見えていた。
スパイクの本数だけは属性強度 `sFrac` 由来（強属性ほど棘が多い）。

### 波トレイル定数

`TRAIL_MAX_AMP = 6`（最大振幅 px）、`TRAIL_FREQ = 0.13`（弧長あたりの周波数）。
変位 `= ampAt(i)·sin(TRAIL_FREQ·arc − phase)`、`phase = e×flightMs×0.02`。

---

### ダメージ／回復の数値（`drawDamageNumber`・#42）

被弾・回復のたびに、対象の頭上に数値が**浮かび上がって（上へ昇りながらフェード）**表示される。`resolveTurn` が `DamagePopup[]`（位置・量・種別・対象ID・タイミング）を集め、`BattleCanvas` が描く。

- **色**：属性色（光=金 `#f4c430`／闇=紫 `#b483ff`／中立=淡）。**暴発=白 `#ffffff`**、**回復=緑 `#5ad16a`（先頭に `+`）**。
- **大きさ**：受けたダメージ量に依存（`size = min(40, 14 + amount × 0.22)`px）。大ダメージほど大きい。
- **タイミング**：`trigger` で同期。`flash`＝被弾フラッシュと同時（命中/掃射）、`misfire`＝暴発の爆発時、`heal`＝固定（flightMs×0.5）。同じ対象の数値は少しずつ遅らせて縦に積む。
- **表示時間**：`POPUP_MS = 950`ms（数値を最後まで見せるため、ターンの余韻 `tailMs` も最低 `POPUP_MS+300` を確保）。
- 暗い縁取り付きで高コントラスト。**画面揺れの外**に描くので暴発中でも読みやすい。

## 7.3 配色パレット（`theme.ts`）

| トークン | 値 | 用途 |
|---|---|---|
| `bg` | `#0d0b14` | 背景（ほぼ黒の紫） |
| `grid` | `#221e40` | 格子（小目盛り・1ユニット） |
| `gridMajor` | `#332d5e` | 格子（大目盛り・5ユニットごと・#53） |
| `axis` | `#3a3470` | 原点軸 |
| `light1` | `#f4c430` | 光属性（金）：弾・軌道・テキスト |
| `light2` | `#fff8e1` | クリーム：UI・ハイライト・弾のコア |
| `dark1` | `#7b5cc4` | 闇属性（紫） |
| `dark2` | `#1e2a6b` | 濃紺：影 |
| `neutral` | `#3a3a46` | 中立（灰） |
| `text` | `#fff8e1` | エンティティのラベル |
| `caster` | `#ffe9a8` | 味方スプライトのアクセント |
| `enemy` | `#e85d75` | 敵ラベル（赤桃） |
| `enemyDark` | `#9c3650` | 敵の影 |
| `ghost` | `#9c7bd8` | 敵ゴースト軌道 |
| `obstacle` | `#8a7bbf` | 障害物アクセント |

`attrColor(attr)`：光→light1 / 闇→dark1 / 中立→neutral。

### 障害物のテクスチャ（種別ごと・#56）

壁の質感は**ピクセルアートのタイル画像**を素材内（`source-atop`）に `createPattern(tile,'repeat')` で敷き詰める（`src/render/textures.ts` の `getWallTexture(kind, element)`。小タイルを生成してキャッシュ。`imageSmoothingEnabled=false`、下地の属性色を活かすため `globalAlpha≈0.62` で重ねる）。画像が取得できない環境では下の手続き描画にフォールバック。将来は `getWallTexture` を `new Image()` の実 PNG 読み込みに差し替え可能。

| 種別 | 下地色 | タイル（ピクセルアート） |
|---|---|---|
| normal/属性 | light=茶 `rgba(120,98,46,.94)` / dark=紫 `rgba(62,52,104,.94)` / 中立=灰 | 石積みレンガ（属性で色味・段ごとに半個ずらし） |
| fragile | 薄灰 `rgba(110,106,122,.9)` | レンガ＋ジグザグの亀裂 |
| tough | 濃灰 `rgba(56,56,70,.96)` | レンガ＋鋲（各レンガ中央の点） |
| unbreakable | 黒 `rgba(24,24,32,.98)` | 鋼板（斜めシェブロン＋四隅と中央の鋲） |

> 形は円（`solids`）と矩形（`rects`・#56）。矩形は角のシャープな四角い壁として `fillRect` で塗り、テクスチャ・削れ穴（`destination-out`）も同じ仕組みで機能する。レイヤー3の `solids を描き` は `solids＋rects を描き` に拡張。

---

## 7.4 音（`src/audio/sound.ts`）

Web Audio で**合成**する効果音＋簡易 BGM（音源ファイル不要・完全ローカル）。`AudioContext` はユーザー操作（ボタン）で resume。マスター音量 `VOL=0.5`、ミュート可。

### 効果音（`SfxKind`）

| kind | 鳴り方（概略） |
|---|---|
| `fire` | 680→240Hz square（発射） |
| `select` | 880Hz square 短（タブ選択） |
| `hit` | 990→1480Hz triangle＋1320Hz square（味方の命中） |
| `enemyHit` | 180→70Hz sawtooth（被弾） |
| `orbit` | 440→700Hz sine（結界展開） |
| `clash` | 短いノイズ破裂＋1800→480Hz square（パリィ/結界相殺の「バチッ」） |
| `misfire` | ノイズ 0.32s＋120→40Hz sawtooth（暴発） |
| `clear` | 523→659→784→1046Hz の上昇アルペジオ（クリア） |
| `gameover` | 392→330→262→196Hz の下降（全滅） |

着弾系の効果音は解決ログの `kind` を見て予約し、演出完了時にまとめて再生（`App.tsx` `fireAll`/`onAnimationDone`）。

### BGM

神秘的なペンタトニックのループ（`MELODY` 16 音）を `setInterval` 240ms 刻みで再生。4 拍ごとに 1 オクターブ下のベースを重ねる。triangle 波・小音量。
</content>

---

## 7.5 見返し（プレイバック・`PlaybackBar`・#DC移植）

解決済みのターンを選び、経路・命中・結界の削れを**スクラブしながら**見返せる。ゲーム進行には影響しない。

- 直近 **8 ターン**ぶんのアニメーションを、**解決前の盤面ごと**保持する（[09 §9.6](09-data-model.md)）。
- `BattleCanvas` に `playback: {paused, seekMs, seekToken, rate}` と `replay` を渡すと、
  内部の時計を外から止める／飛ばす／速さ（×1・×0.5・×0.25）を変えられる。
- 見返し中は終端で `onAnimationDone` を呼ばない（その位置に留まる）。
- **巻き戻し対策**：`seekToken` が変わったフレームだけ演出のラッチを全消しし、
  その時点で既に過ぎている演出は「はるか過去」の時刻でラッチして無音のまま通過させる。

## 7.6 手引きの図版（`render/tutorialFigures.ts`・`Guide`）

8 枚の canvas 図で「y が道／θ で回す／z が属性／強い属性は重い／盤面の輪が z(t)／
当たるかは撃つまで分からない／結界とパリィ／壁と暴発」を**動かして**見せる。
数値はエンジンの式をそのまま使う（`strengthOf`・`acceleration`）ので、図と本編の挙動がずれない。

## 7.7 エンドロール（`render/endroll.ts`・`Endroll`）

エンディングの後に流れるクレジット背景。**本物の敵AI同士（LIGHT MAGE ⇄ DARK MAGE）が延々と撃ち合う**。

- 計画は `planEnemyShots`、飛行は `enemyFlight` → `traverseObstacles`、
  相殺は `resolveParry`、結界の迎撃は `ringInterception`。**ロジックは一切書き換えない**。
- 1 幕＝両者が同時に撃つ。**結界の迎撃 → 命中 → 弾どうしの相殺 → 暴発**の順に解く。
- やられた側だけ **LVL +1・全回復**、壁は別配置に組み直す。LVL 5（同時 3 発）で決着したら両者 LVL 1 へ。
- 敵AIの計画は重いので、**幕の尻尾で 1 フレーム 1 手ずつ**先取りして次の幕を組む（切り替わりで描画が止まらない）。
