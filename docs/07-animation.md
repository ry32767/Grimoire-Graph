# 07. アニメーション・描画・音

解決演出は `src/components/BattleCanvas.tsx`（タイムライン駆動）と `src/render/draw.ts`（描画関数群）、
配色は `src/render/theme.ts`、効果音/BGM は `src/audio/sound.ts`。
Canvas は内部解像度 `INTERNAL = 520`px 正方形、ビューポート `unitsRadius = rField(30)`。

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
| 結界の霧散 | 壁/弾に負ける | `DISSIPATE_MS=520` | `drawOrbitDissipation`（リング消失・粒拡散） |
| 弾の霧散 | 速度 0 | `DISSIPATE_MS=520` | `drawBulletDissipation`（コア収縮・粒拡散） |
| 暴発 | `misfirePos` 到達 | `MISFIRE_TAIL_MS=1000` | `drawMisfire`（収縮→大爆発の 2 段） |

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

## 7.2 描画レイヤー（背面→前面・`draw.ts`）

| # | レイヤー | 主な内容 |
|---|---|---|
| 0 | 背景 | `COLORS.bg` 塗り、**1 ユニット格子**（1マス=数学1ユニット・#53）、5ユニットごとに濃い大目盛り（`COLORS.gridMajor`）、原点軸、場の境界円（半透明紫）。格子の範囲は `visibleBounds(vp)` から決め、ステージのスケール（`unitsRadius`）を変えても画面全体を覆う |
| 1 | z 場オーバーレイ（作成フェーズは常時・#55） | 光=金の薄塗り（不透明度 0.04〜0.20）、闇=紫の薄塗り（0.05〜0.23）。強度に比例。**セルは方眼と同じ1ユニット**で、整数境界の各マスを中心 (x+0.5, y+0.5) の z で塗る（格子に整列・#53） |
| 1b | z 場エラー overlay（編集時・#30） | 場がエラーになる地点を全て赤 `rgba(255,60,60,0.5)`（`drawZFieldErrors`）。極=赤い線（二分法 `isPoleBetween` で検出）、定義域外=赤い領域 |
| 2 | 敵ゴースト軌道（予告） | `COLORS.ghost` の破線 `[5,4]` |
| 3 | 障害物 | solids（円）＋rects（四角・#56）を描き carves を `destination-out` で打ち抜き、種別ごとのピクセルアート・タイルを `source-atop` で敷き詰める（石積み/亀裂/鋲/鋼板） |
| 4 | 味方の予測軌道（編集時） | z で色分けした線（光=金/闇=紫/中立=淡）、強度で線幅 |
| 4b | 暴発点マーカー（編集時・#30） | 関数（軌道 or z 場）がエラーで暴発する点に**赤い ✕**（`drawMisfireMarker`・`#ff4b4b`・最前面）。`Preview.misfirePos` 由来 |
| 5 | 敵 | オーラ→暗い下地→属性枠→ロール印（guardian=二重破線/breaker=棘）→ドット絵スプライト（16×16）→系統 glyph→名前ラベル→被弾フラッシュ |
| 6 | 味方術者 | オーラ→アクティブ強調リング（破線）→ドット絵スプライト→隠蔽ヴェール→名前→被弾フラッシュ |
| 7 | HP バー | 敵/味方の上 |
| 8 | 弾の波トレイル | `drawWaveTrail`：2 本の正弦波（180°位相差）＋トレイル粒 |
| 9 | 飛行する弾 | `drawBullet`：外周グロー→shadowBlur→回転スパイク→白いコアの多層グロー |
| 10 | 結界リングの粒 | 18 粒がリングを 1.1 周。各粒に 5 点の尾。`zColor` で属性色。**進み方は点ごとの速度に連動**（#60：`ringTimeline`＝Σ ds/speed の累積時間で phase→index を写像。速い区間は素早く抜け、遅い区間で粒が密集）。粒サイズも触れた点の速度×強度（`ptSpeed`） |
| 11 | 結界の霧散 | `drawOrbitDissipation` |
| 12 | えぐりバースト | `drawCarveBurst`（岩片） |
| 13 | クラッシュ火花 | `drawClashSpark` |
| 14 | 暴発 | `drawMisfire` |
| 15 | 弾の霧散 | `drawBulletDissipation` |
| 16 | 隠蔽ヴェール | 自陣の闇結界＝`drawConcealVeil`（内側を 3px ぼかし＋暗幕 `rgba(6,5,14,0.5)`）。**敵 guardian の闇結界＝`drawComposeConceal`（#61）**：作成フェーズで内側を 6px ぼかし＋濃い幕 `rgba(10,7,20,0.66)` で**z 場・予測経路を隠す**＋破線の境界。`standingOrbits[].owner` で切替 |
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
