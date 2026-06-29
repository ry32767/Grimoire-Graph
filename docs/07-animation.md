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
| 障害物えぐり | 弾が `carve.arcLen` を通過 | `BURST_ARC=9`（弧長窓） | `drawCarveBurst`（岩片飛散・赤橙） |
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
| 0 | 背景 | `COLORS.bg` 塗り、2 ユニット格子、原点軸、場の境界円（半透明紫） |
| 1 | z 場オーバーレイ（編集時のみ） | 光=金の薄塗り（不透明度 0.04〜0.20）、闇=紫の薄塗り（0.05〜0.23）。強度に比例 |
| 1b | z 場エラー overlay（編集時・#30） | 場がエラーになる地点を全て赤 `rgba(255,60,60,0.5)`（`drawZFieldErrors`）。極=赤い線（二分法 `isPoleBetween` で検出）、定義域外=赤い領域 |
| 2 | 敵ゴースト軌道（予告） | `COLORS.ghost` の破線 `[5,4]` |
| 3 | 障害物 | solids を描き carves を `destination-out` で打ち抜き、種別ごとのテクスチャを `source-atop`（石積み目地/亀裂/鋲/シェブロン） |
| 4 | 味方の予測軌道（編集時） | z で色分けした線（光=金/闇=紫/中立=淡）、強度で線幅 |
| 4b | 暴発点マーカー（編集時・#30） | 関数（軌道 or z 場）がエラーで暴発する点に**赤い ✕**（`drawMisfireMarker`・`#ff4b4b`・最前面）。`Preview.misfirePos` 由来 |
| 5 | 敵 | オーラ→暗い下地→属性枠→ロール印（guardian=二重破線/breaker=棘）→ドット絵スプライト（16×16）→系統 glyph→名前ラベル→被弾フラッシュ |
| 6 | 味方術者 | オーラ→アクティブ強調リング（破線）→ドット絵スプライト→隠蔽ヴェール→名前→被弾フラッシュ |
| 7 | HP バー | 敵/味方の上 |
| 8 | 弾の波トレイル | `drawWaveTrail`：2 本の正弦波（180°位相差）＋トレイル粒 |
| 9 | 飛行する弾 | `drawBullet`：外周グロー→shadowBlur→回転スパイク→白いコアの多層グロー |
| 10 | 結界リングの粒 | 18 粒がリングを 1.1 周。各粒に 5 点の尾。`zColor` で属性色 |
| 11 | 結界の霧散 | `drawOrbitDissipation` |
| 12 | えぐりバースト | `drawCarveBurst`（岩片） |
| 13 | クラッシュ火花 | `drawClashSpark` |
| 14 | 暴発 | `drawMisfire` |
| 15 | 弾の霧散 | `drawBulletDissipation` |
| 16 | 隠蔽ヴェール | `drawConcealVeil`：闇結界の内側を 3px ぼかし＋暗幕 `rgba(6,5,14,0.5)` 重ね |

### 弾の色・大きさ

```ts
bulletColorOf(z):  光→#f4c430 / 闇→#7b5cc4 / 中立→#d9d4ea
powerSizeFrac(speed, z) = min(1, strengthOf(z)×max(0,speed) / (sMax×maxFlightSpeed))
                        = min(1, 威力 / (5×24))
pulse = 1 + sin(phase×1.7)×0.25                       // 0.75〜1.25 で脈動
glowR = (9 + sizeFrac×18) × pulse,  coreR = (2.0 + sizeFrac×3.4) × pulse
```

威力が高いほど弾・グロー・スパイク・トレイル粒が大きく派手になる。

### 波トレイル定数

`TRAIL_MAX_AMP = 6`（最大振幅 px）、`TRAIL_FREQ = 0.13`（弧長あたりの周波数）。
変位 `= ampAt(i)·sin(TRAIL_FREQ·arc − phase)`、`phase = e×flightMs×0.02`。

---

## 7.3 配色パレット（`theme.ts`）

| トークン | 値 | 用途 |
|---|---|---|
| `bg` | `#0d0b14` | 背景（ほぼ黒の紫） |
| `grid` | `#26224a` | 格子 |
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

### 障害物のテクスチャ（種別ごと）

| 種別 | 下地色 | テクスチャ |
|---|---|---|
| normal/属性 | light=茶 `rgba(120,98,46,.94)` / dark=紫 `rgba(62,52,104,.94)` / 中立=灰 | 石積みの目地（横線） |
| fragile | 薄灰 `rgba(110,106,122,.9)` | ジグザグの亀裂 |
| tough | 濃灰 `rgba(56,56,70,.96)` | 鋲打ちグリッド |
| unbreakable | 黒 `rgba(24,24,32,.98)` | シェブロン斜線 |

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
