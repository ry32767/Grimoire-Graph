# 02. 計算方法（座標・物理・属性・ダメージ）

このゲームの数式・計算ロジックの中核。すべて `src/game/` の純粋関数で、`src/data/constants.ts` の定数を使う。

---

## 2.1 座標系（`src/game/coords.ts`）

- **数学座標**：原点 O=(0,0)。x 右・y 上。場の半径 `rField = 30`（この外は「場外」）。
- **Canvas 座標**：原点は画面中央。y は上下反転。
- 変換はこの 1 か所に集約し、描画・当たり判定・物理すべてで共有する（ズレ防止）。

```ts
scaleOf(vp)  = min(width, height) / 2 / unitsRadius   // 1 ユニットあたりのピクセル数
toScreen(p)  = { x: width/2 + p.x*s,  y: height/2 - p.y*s }
toMath(px)   = { x: (px.x - width/2)/s, y: (height/2 - px.y)/s }
rotate(p, θ) = { x: p.x·cosθ - p.y·sinθ, y: p.x·sinθ + p.y·cosθ }
```

### 軌道サンプリング

軌道は原点側から外側へ離散サンプリングし、各点で「有限な実数か（valid）」「場内か（inField）」を判定する。

| 方式 | パラメータ | 範囲 | 刻み | 位置の式 |
|---|---|---|---|---|
| 回転 `rotate` | x | `0 〜 rotateXMax(=48)` | `rotateStep=0.08` | 局所 `(x, g(x)-g(0))` を `angle` 回転し `origin` に平行移動 |
| 極座標 `polar` | θ | `0 〜 polarThetaMax(=4π)` | `polarStep=0.02` | `origin + (r·cosθ, r·sinθ)`、`r=f(θ)` |

- **回転方式の平行移動**：局所 y を `g(0)` だけ引いて、術者位置 `origin` を必ず始点にする（#14）。
- `validPrefix`：最初に「無効 or 場外」になる手前までの連続区間（発射型の飛行に使う）。
- `validFinitePrefix`：最初に「無効（非有限）」になる手前まで（**場外で切らない**＝結界リングは一周する・#22/#25）。
- `buildPolyline`：有効プレフィックスに累積弧長 `cumLen` を付けたポリライン。弧長で位置を引ける。

### 暴発点の検出（`pathTermination`）

軌道の終端を 3 分類する：

- `maxParam` … 場内で軌道を進み切った（暴発しない）。
- `outOfField` … 場外へクリーンに出た（外れ）。
- `invalid` … 未定義・発散・非実数。**暴発点は直前の場内有効点**（無ければ原点）。

場外脱出でも「直後に発散（極を跨ぐ＝連続点が `rField` 以上飛ぶ、または非有限点が来る）」なら `invalid` に分類し、暴発点を画面内に取る（`divergesSoonAfter`）。これで `1/(2.5−x)` のような極をもつ関数も暴発として扱える。

---

## 2.2 属性 z 場（`src/game/attribute.ts`・`src/game/zfields.ts`）

弾が通る各点 (x,y) で z 場を評価する。z 場は軌道とは別入力（[03-functions.md](03-functions.md) 参照）。

```ts
zfieldAt(traj, pos) = traj.z ? traj.z(pos.x, pos.y) : 0   // 未指定なら中立 0
```

### 属性判定

```ts
attributeOf(z):
  |z| < epsilon(0.35)  → 'neutral'
  z > 0                → 'light'
  z < 0                → 'dark'
```

### 属性強度（山型・#21）

```ts
strengthOf(z) = sMax · (1 − |  |z| − zPeak  | / zPeak)        ただし下限 0
              = 5 · (1 − | |z| − 5 | / 5)
```

- |z| = `zPeak`(=5) で最大 `sMax`(=5)。
- |z| = 0 と |z| = 2·zPeak(=10) で 0。
- 線形の三角形（山型）。

| `|z|` | 0 | 1 | 2 | 2.5 | 3 | 4 | **5** | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 強度 | 0 | 1 | 2 | 2.5 | 3 | 4 | **5** | 4 | 3 | 2 | 0 |

### 極性相性倍率（`affinityMultiplier`）

```ts
反対極（光×闇）        → 1.5  (AFFINITY.opposite)
同極（光×光 / 闇×闇）  → 0.5  (AFFINITY.same)
どちらかが中立         → 1.0  (AFFINITY.neutral)
```

### z 場プリセット（`zfields.ts`）

| ID | 名前 | 式 | 既定係数 |
|---|---|---|---|
| `const` | 一定 | `z = c` | c=5（最強の光） |
| `gradY` | 縦勾配 | `z = a·y + b` | a=0.3, b=0 |
| `gradX` | 横勾配 | `z = a·x + b` | a=0.3, b=0 |
| `radial` | 放射 | `z = a·√(x²+y²) + b` | a=0.3, b=0 |

`constZField(c)` は敵・おすすめ用の定数 z 場を作る簡便版。

---

## 2.3 物理：加速度・速度・消滅（`src/game/physics.ts`）

### 加速度場（#31）

弾は通る点の z（属性の高さ）で加速・減速する。

```ts
acceleration(z) = aMax · (1 − |z| / zRef)        ただし下限 −aDecelMax
                = 13 · (1 − |z| / 2.5)           下限 −8
```

| `|z|` | 0 | 1 | 2 | **2.5** | 3 | 4 | 5 |
|---|---|---|---|---|---|---|---|
| 加速度 | +13 | +7.8 | +2.6 | **0** | −2.6 | −7.8 | −8(クランプ) |

- 中立（z≈0）で最大加速 `aMax`(=13)。
- |z| = `zRef`(=2.5) でちょうど 0。
- |z| > zRef で**減速（負）**。減速は `−aDecelMax`(=−8) で頭打ち。
- 最強属性 `zPeak`(=5) は zRef を超えるため必ず減速する → **強く帯びるほど失速する**。

### 速度モデル（弧長エネルギー積分）

`dv/dt = a(z)`, `ds/dt = v` より `v² = v₀² + 2∫a ds`（弧長 s での積分。`v ← v + a·dt` と等価）。

実装は各頂点までの加速度積分 `A`（台形則）を持ち、エネルギー基準で速度を引く：

```ts
speedFromEnergy(v0², ΔA) = min( √max(0, v0² + 2·ΔA),  maxFlightSpeed(=24) )
```

- **初速は毎回固定** `fixedSpeed = 10`（スライダー廃止・#5）。
- 飛行速度の上限（終端速度）`maxFlightSpeed = 24`。
- 速度が 0 になればその点で **`vanished`（消滅）**。減衰イベントで 0 になっても、自然減速で 0 に達しても消滅。

### 減衰イベント（`LossEvent`）と再シミュレート

障害物のえぐり・シールド・パリィ・結界の迎撃は「弧長 s で速度を `deltaV` 削る」イベントとして蓄積し、
毎回「元の初速＋全減衰」で `simulateProfile` を再実行する（複数防御の速度損を正しく重ねる）。

| 関数 | 用途 |
|---|---|
| `buildSpeedProfile(traj, v0)` | 味方の軌道（原点起点・z 場で加速度を評価）から速度プロファイル |
| `buildPathProfile(points, v0, zAt)` | 敵弾など明示パス（z は index で与える）から速度プロファイル |
| `simulateProfile(profile, losses)` | プロファイル＋減衰イベントから飛行を解決（コア） |
| `speedAtLength(profile, s)` / `sampleAtLength(flight, s)` | 弧長 s の速度・サンプルを引く |

---

## 2.4 威力とダメージ（`attribute.ts`）

### 威力

```ts
power = 命中点の速度 × strengthOf(z)
```

「速度 × |z| 由来の強度」。中立帯で加速して速度を稼ぎ、当てる瞬間に強属性へ乗せると高威力になる。

### ダメージ（`computeDamage`）

```ts
attackAttr = attributeOf(命中点の z)
strength   = strengthOf(命中点の z)
power      = speed × strength
affinity   = affinityMultiplier(attackAttr, 対象の防御属性)
damage     = power × affinity
```

戦闘ログには `速{speed}×強{strength}×相性{affinity} = {damage}` の内訳が出る。

### 敵弾が味方に当たる場合（`turn.ts`）

```ts
damage = hit.speed × strengthOf(bZ) × affinityMultiplier(bAttr, 味方の防御属性)
```

bZ は敵弾の z 場を命中点で評価した値。

---

## 2.5 状態異常（`src/game/status.ts`）

属性に応じて命中時に付与。持続は「ターン数」で管理。

### 光 → ひるみ（flinch）

```ts
turns = max(flinchBaseTurns(=1), ceil(strength / 2))
```

ひるみ中はそのターン行動できない（味方は発射不可、敵は発射しない）。

### 闇 → 継続ダメージ（burn / DoT）

```ts
総量    = strength × burnScale(=2)
継続     = burnTurns(=3) ターン
毎ターン = 総量 / burnTurns = strength × 2 / 3
```

### 付与・更新ルール（`addStatus`）

- 中立は付与なし（強度 0 も付与なし）。
- 同種の状態異常はスタックせず、**強い方／長い方へ更新**（`magnitude`・`remainingTurns` を `max`）。

### ターン開始処理（`tickStatuses`）

1. burn の合計ダメージを適用、flinch があれば「行動阻害」フラグ。
2. 全状態の `remainingTurns` を 1 減らし、0 になったものを除去。

### 最大強度（暴発用・`maxStatuses`）

暴発は光・闇の両方を最大強度 `sMax`(=5) で同時付与する（ひるみ＋継続ダメージ両方）。

---

## 2.6 当たり判定（`src/game/collision.ts`）

飛行サンプル（線分列）と円ヒットボックスの交差。

- `segmentCircleHit(a, b, c, r)`：線分 a→b と中心 c・半径 r の円が最初に交わる媒介変数 t∈[0,1]（始点が円内なら 0）。
- `firstHit(samples, center, radius)`：最初に触れた点の位置・速度・弧長・パラメータを線形補間で返す。
- `firstHitAmong(samples, targets)`：複数対象のうち**最も手前（弧長最小）**で当たるものを返す。

ヒットボックス半径：敵 `enemyHitbox = 1.8`（ボスは 3.6）、味方 `allyHitbox = 2.0`。
</content>
