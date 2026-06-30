# 05. 敵・敵 AI

敵の定義は `src/data/stages.ts`（`enemy()` ファクトリ）、AI は `src/game/enemyAI.ts`。

---

## 5.1 敵の構造（`Enemy` 型）

| フィールド | 意味 |
|---|---|
| `name` / `pos` / `hp` / `maxHp` | 名前・配置（=発射元）・HP |
| `element` | 被ダメージ相性に使う**防御属性**（light/dark/neutral） |
| `hitboxRadius` | 被弾ヒットボックス半径（既定 `enemyHitbox=1.8`、ボスは 3.6） |
| `family` | 得意関数の**系統**（見た目で判別・AI が最適化する関数族） |
| `families?` | 追加系統（#28：1〜2 個）。AI は family＋これらを全部試して最良を選ぶ |
| `role?` | 戦い方（attacker / breaker / guardian）。未指定は attacker |
| `castInitialSpeed` | 敵弾の初速 |
| `castZ` | 敵弾の代表 z（符号=属性の基準）。`castMag`（既定 3）×極性 |
| `castZField?` | 敵弾の z 場（未指定なら定数 castZ の場） |

`enemy()` ファクトリは `castZ = element==='light' ? +castMag : element==='dark' ? −castMag : 0` を設定。
ただし AI は攻撃時、**属性に関係なく対象の弱点（反対極）を自由に突く**（§5.4）ので、`element` は主に被弾相性と見た目に効く。

---

## 5.2 系統（family・#17）

弾の形で判別できる「得意関数」。頭上の記号（glyph）とゴースト軌道で予告される。

| family | ラベル | AI が組む軌道（`buildEnemyTrajectory`） | 形状係数候補 |
|---|---|---|---|
| `line` | 直進 | `g(x)=0`（直線） | `[0]` |
| `arc` | 弧 | `g(x)=shape·x²`（緩い放物） | `[-0.09, -0.04, 0.04, 0.09]` |
| `wave` | 波 | `g(x)=shape·sin(0.45x)` | `[1.5, 3]` |
| `spiral` | 渦 | `f(t)=shape·(t+angle)`（極座標・渦巻き） | `[0.7, 1.1]` |

`ARCHETYPES` がラベルと glyph を保持。狙い角オフセットは spiral 以外で `[-0.28,-0.14,0,0.14,0.28]`、spiral は `[0]`。

---

## 5.3 ロール（role・#28）

| role | 説明 |
|---|---|
| `attacker`（既定） | 味方へ最大ダメージを狙う。 |
| `breaker` | 壁を貫いてでも味方へ届かせる。**障害物ペナルティを受けない**（壁よけ軌道も使わず直進で貫く）。 |
| `guardian` | 攻撃せず、自陣を守る**防御用周回結界**を張る。`enemyGuardRadius=7` の円を、自陣属性の最強（|z|=zRef）で展開し味方弾を迎撃する。 |

guardian の結界も「反対極のみ相殺・同極は透過・壁で霧散・強属性の失速で自滅（#31/#44）」という味方の結界と同じルール（[04-magic.md](04-magic.md) §4.6）。ただし guardian は減速しない最強（|z|=zRef）で張るので失速自滅はしない。

---

## 5.4 敵 AI の攻撃計画（`planEnemyShot`）

最大ダメージの軌道を探索する。流れ：

1. **guardian** なら防御結界を張って終了（`planGuardianOrbit`）。
2. **隠蔽**：闇の周回で完全に隠れた味方（`concealed ≥ orbitConcealFull`）は視認不可＝狙えない。全員隠れていれば見えないなりに撃つ。
3. 各「狙う味方 × 狙い角 × 形状係数 × z 場強さ」の候補軌道を総当たりで採点（`consider`）。

### z 場の強さ候補（#31）

```ts
ATTACK_Z_MAGS = [zPeak(=5), zRef(=2.5)]
```

対象の反対極を、`zPeak`（近距離で大威力だが減速）と `zRef`（中遠でも届く）の両方で試す。`castZField` を持つ敵はそれ 1 つを使う。

### スコアリング（`consider`）

```ts
hit = firstHit(flight, aimPos, allyHitbox)          // 失速して速度0なら候補棄却
penalty  = 手前に素材（壁）があれば 0.55（breaker は無視）
baseDmg  = hit.speed × strength × 相性 × penalty × maneuver
killBonus = baseDmg ≥ ally.hp ? 2.2 : 1            // とどめ最優先
woundFocus = 1 + (1 − hp/maxHp) × 0.5               // 手負い優先
lowHpBias  = 1 + max(0,(60 − hp)/60) × 0.25         // 低HP微優先
score = baseDmg × killBonus × woundFocus × lowHpBias
```

`maneuver` は迂回の取り回しコスト（直進=1、壁よけ=`MANEUVER=0.9`）。同条件なら直進/貫通が勝つ。

### 壁よけ軌道（`avoiderTrajectories`・#28）

breaker 以外は、直線が最初に素材へ触れる地点を迂回起点に、横へ膨らませる**通過点を選んでラグランジュ補間で近似曲線**を引く。

- 単一の弓なり：膨らみオフセット `±4, ±7, ±10` で壁の脇/上を抜ける。
- S 字：2 つの通過点で複雑に回り込む（オフセット `±6, ±9`）。機械らしい独特の軌跡。

### 牽制（フォールバック）

どの候補も命中見込みなし（命中スコア無し）なら、最も HP の低い見える味方へ**直進で牽制**（減速しない zRef で撃つ）。

---

## 5.5 隠蔽への対応（`perceivedPos`・#35/#39）

闇の周回で隠れた味方は、敵から見て真の位置からずれて見える。

```ts
ブレ幅 mag = concealRmse（囲む円半径連動・1重=半径/2, 2重=半径）
            または重数 × CONCEAL_JITTER(=3.5)（旧データ）
見かけ位置 = 真位置 + idDir(id) × mag
```

方向は ID 由来で安定（純粋関数を保つ＝同ターンの再評価で揺らがない）。敵はこの見かけ位置に対して狙い・命中評価を行う。

---

## 5.6 登場する敵の一覧

各ステージの敵の完全な配置・HP・属性は [06-stages.md](06-stages.md) を参照。系統・ロールの分布だけ概観：

- **序盤（1〜2 面）**：単一系統の attacker（line / arc / wave）。
- **中盤（3〜5 面）**：複数系統（`families`）持ち、guardian / breaker が混ざる。光闇の祭司、鏡像の衛士など。
- **終盤（6〜7 面）**：強化された castMag、ボスは HP 380・ヒットボックス 3.6・複数系統。guardian と breaker の眷属を従える。
</content>
