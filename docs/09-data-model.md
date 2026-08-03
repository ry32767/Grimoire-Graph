# 09. データモデル・ターン進行・モジュール構成

型は `src/game/types.ts`、ターン処理は `src/game/battle.ts` / `src/game/turn.ts`。

---

## 9.1 主要な型（`types.ts`）

| 型 | 役割 |
|---|---|
| `Vec2` | 2D ベクトル（数学座標。原点 O＝術者） |
| `Attribute` | `'light' \| 'dark' \| 'neutral'`（命中点の z 符号で決定） |
| `ZField` | `(x,y)=>number`。属性の高さ z=f(x,y)。軌道とは別物 |
| `FireMode` | `'rotate' \| 'polar'` |
| `Trajectory` | `RotateTrajectory`（g, angle, origin, z?, fieldR?）か `PolarTrajectory`（f, origin, z?, fieldR?）の共用体。`fieldR`＝この軌道の `inField` 判定に使う場半径（#49・未指定は `FIELD.rField`） |
| `Spell` / `AllyCast` | 発射入力（owner/trajectory/initialSpeed、味方は allyId） |
| `Flight` / `FlightSample` | 物理シミュ結果（samples・end・endPos・endSpeed） |
| `FlightEnd` | `'vanished'(速度0消滅) \| 'outOfField' \| 'invalid'(暴発) \| 'maxParam'(完走)` |
| `StatusEffect` | `flinch`/`burn`＋magnitude＋remainingTurns |
| `Enemy` / `Ally` | 敵・味方術者（[05](05-enemies.md)/[01](01-overview.md) 参照）。敵は `ruptorTarget`/`castCount`/`patternPool`/`fireEvery`/`fireOffset`/`boss`/`slipThrough`/`alternatingAura`/`guardZSign`/`directedAura`/`species`/`level` の拡張フィールドを持つ（#42/#44/#45/#46/#47/05b）。`directedAura`＝守護型の方向づけ場（#47）、`species`/`level`＝描画・ティア演出専用でロジック不関与 |
| `EnemyFamily` | `line \| arc \| wave \| spiral \| exp \| poly34 \| abs`（得意関数の系統・#43/#46。`abs`＝折れ／絶対値・V字） |
| `EnemySpecies` | `proto \| oni \| wraith \| redWraith \| golem`（種族・05c 図鑑・#46。描画専用） |
| `EnemyRole` | `attacker \| breaker \| guardian \| ruptor`（#42） |
| `Disc` / `Rect` / `Obstacle` / `ObstacleKind` | 障害物（素材＝solids（円）＋rects（四角・#56）− carves・耐久種別） |
| `CarveBurst` | 削る瞬間の演出データ |
| `ActiveOrbit` | 永続する周回結界（#39） |
| `Mechanics` | `{ obstacles, enemyFire }`（段階的解禁） |
| `BossPhase` | ボスの HP フェーズ（#45）：`{ hpBelow, castCount, obstacles, cullMinions?, rField? }`（`rField`＝崩落後の場半径・`applyBossPhases` が `BattleState.rField` へ反映・#49） |
| `Stage` | ステージ定義（enemies/obstacles/introText/clearText/mechanics/boss?/bossPhases?/rField?（面ごとの場半径・`createBattleState` が `BattleState.rField` へ取り込む・#49）/allyPositions?（面ごとの味方初期位置の上書き・#64。`party.ts` の並び順に対応し `createBattleState` が適用。未指定の面は既定位置。現状は第4面のみ使用）） |
| `Phase` | `'enemyReveal' \| 'compose' \| 'resolve'` |
| `LogEntry` | 戦闘ログ（kind で分類） |
| `BattleState` | 戦闘状態（メモリ上のみ・永続化なし） |

### `BattleState`

```ts
{
  stageIndex, allies[], enemies[], obstacles[], mechanics,
  turn, phase, log[], outcome: 'ongoing'|'cleared'|'gameover',
  orbits?: ActiveOrbit[],   // 持続中の周回結界
  bossPhases?: BossPhase[], // ボスの HP フェーズ定義（createBattleState でステージから複製・#45）
  bossPhase?: number,       // 現在のフェーズ（0=最初のアリーナ）
  rField?: number,          // 現在の場半径（#49・§5.5）。createBattleState が Stage.rField を取得・applyBossPhases が BossPhase.rField で縮小
  finale?: 'pending'|'cast'|'done'  // 断末魔（ボスHP0後の暴発3連）の進行状態
}
```

> **ラン全体の状態**（`instability`・初回崩壊済みフラグ・図鑑補足の既読など・04b）は `BattleState` ではなく `App.tsx` の React state が持つ（ステージをまたいで持ち越すため）。ゲームロジックへは `resolveTurn` の入力（`instability`/`misfireRoll`）として注入する。

> **場半径の伝播（#49・§5.5）**：`BattleState.rField` は `resolveAllyCasts` から `ResolveInput.fieldR` として `resolveTurn` に渡り、敵AI（`planEnemyShots(…, fieldR)`）が計画する軌道に `Trajectory.fieldR` として刻まれる。味方casts は `buildComposerTrajectory(c, origin, fieldR)` が同じ値を刻む。`coords.sampleTrajectory` は `traj.fieldR ?? FIELD.rField` を `inField` 判定に使うため、面/フェーズで場が変わっても物理・迎撃・暴発・描画（`Viewport.unitsRadius`）が同じ半径で一致する。グローバル可変状態は持たない（純粋関数）。

---

## 9.2 ターンの進行（`battle.ts`）

```
createBattleState(stage, index, party)   // HP 全快・turn=1・phase='enemyReveal'
        │
        ▼
prepareTurn(state)
  ├ 状態異常をターン減衰（味方/敵）：burn ダメージ適用、flinch 判定
  ├ castingEnemyIds（発射できる敵）／impairedAllyIds（ひるみ味方）を決定
  │   └ 発射頻度（fireEvery/fireOffset・06b）：該当ターン以外は撃たない
  ├ 交互張り守護型の guardZSign をターン偶奇で設定（奇数=光・05b §5.4）
  ├ 断末魔（#45）：finale='pending' ならボスを暴発型3連の変異体に置き換え finale='cast'
  └ phase='compose'、outcome 判定
        │   ── 作成フェーズ（プレイヤー操作）──
        ▼
resolveAllyCasts(state, casts, castingEnemyIds, { instability?, misfireRoll? })
  ├ resolveTurn(...) で同時発射を解決 → 状態更新・turn+1・phase='resolve'
  ├ finale='cast' → 'done'（断末魔を解決し切った）
  ├ ボスが今倒れたら finale='pending' を予約（勝敗より先・#45）
  ├ applyBossPhases：HP しきいを跨いだら床崩落（障害物差し替え・結界霧散・眷属間引き・castCount 変更）
  └ 勝敗判定
```

- 敵がひるみ中、または `mechanics.enemyFire` が false、または発射頻度の該当ターンでなければ発射しない。
- 味方がひるみ中、または HP 0 なら発射しない。
- `outcome`：味方全滅→`gameover`、敵全滅→`cleared`（ただし `finale` が pending/cast の間は `ongoing` のまま）、それ以外→`ongoing`。
- instability の致死判定（04b：上限到達→ゲームオーバー）は `App.tsx` が `resolution.misfires` を集計して勝敗より先に適用する。

---

## 9.3 解決の中核（`resolveTurn`・`turn.ts`）

入力は非破壊（複製して新状態を返す）。解決はこの順序：

1. **敵弾を構築** … `planEnemyShots` で各敵の弾を決定（多重詠唱は弾ごとに独立計画・#44）。guardian の閉軌道は飛ばさず**防御リング**（`enemyRings`）へ分離。ruptor は暴発点（`misfirePos`）つきの弾になる。
2. **味方発射を分類・構築** … `classifyTrajectory` で発射型/軌道型に。軌道型は壁接触で**霧散**判定。強属性（|z|>zRef）で失速し速度0に達したら**自滅して霧散**（ログで明示・#31/#44）。
3. **防御** … 各敵弾に対し：
   - 3z. 障害物が敵弾を削る（味方の盾）。`blocked`（以降の迎撃・命中の打ち切り）は**壁の中で止まった（`carveAlong` の `vanished`）ときだけ**（#64）。z 減速による自然失速は blocked にしない＝失速点より手前の味方への命中は無効化されない。
   - 3a. 軌道型リング（新規＋永続）が境界で迎撃（反対極のみ。**威力の引き算＝必ず片方消滅**・04-magic §4.5/§4.6）。
   - 3b. 発射型のパリィ：**実衝突判定**（`bulletCollision`・#64）＝両弾を同じゲーム時刻で進め（到達時刻 Σ ds/v・`FIELD.dt` 刻みの時間行進）、`parryHitDist(=2.0)` 以下へ近づいた最初の点で反対極なら威力を引き算する。全（敵弾×自弾）ペアの衝突を**ゲーム時刻の早い順に解決**し、1件ごとに残りの衝突を再計算する（勝ち残りは多段パリィしうる）。
   - 減衰イベントを蓄積し、毎回「元初速＋全減衰」で再シミュレート。
4. **障害物** … 味方の発射型を削りながら遮る。
5. **4.5 敵結界との相殺** … 味方の発射型が敵 guardian の結界（新規リング＋持続結界 `owner='enemy'`）を横切ると、交差点でパリィと同じ威力の引き算。自弾は減衰イベントとして飛行へ反映され（命中しない弾が横切っても、また命中の先でも、結界は減速・破壊される）、結界が勝てば弾は消滅、弾が勝てば結界は霧散。同じ場所へ張り直された同IDの持続結界は二重に数えない。
6. **攻撃** … 発射型は**貫通**：経路上の全ヒットへ弧長順にダメージ（命中で減速しない・敵結界の減速は 4.5 で反映済み）／軌道型は掃射／invalid まで届けば暴発（命中と両立。半径は instability でばらつく・04b §4b.3）。暴発は AoE 内の壁に加え**結界（味方・敵とも）も最大威力でパリィ相当に削る**（`blastOrbits`・速度0で霧散）。
7. **5.5 周回オーラ** … 囲んだ味方へ光=固定回復/闇=隠蔽（内側優先で最大 2 つ）。
8. **5.6 敵結界のオーラ** … 光の敵リング（新規＋持続）は囲んだ敵陣を回復（05b §5.4/#61）。
9. **敵弾が味方へ命中** … **貫通**：パス上で触れた全味方へダメージ＋状態異常（ruptor の弾は除く）。
10. **6b 崩し手の暴発** … 迎撃されず極まで届いた ruptor 弾は暴発 AoE（敵味方無差別・壁も結界も削る）。`misfires` に計上。
11. **永続周回の更新** … 相殺されず生き残った既存（味方＝`owner='player'`／敵＝`owner='enemy'` とも）＋今ターン新規（壊れていない・所有者生存）を次ターンへ持ち越し。同IDの張り直しは新リング側の結果で置き換える。

### `ResolveResult`

```ts
{
  allies, enemies, obstacles, log,
  allyShots[],     // 味方の発射（描画・命中情報）
  enemyShots[],    // 敵弾（描画・命中情報・misfirePos/misfired）
  enemyRings[],    // guardian の防御リング（描画用）。{ring, broken, ringSpeed, breakPos}
                   //   breakPos＝破壊された点（#64・霧散演出の同期用。破壊されていなければ null）
  orbitBreaks,     // 破壊された持続結界の破壊点（#64）。Record<orbit id, Vec2>（演出同期用）
  clashes[],       // 弾/結界の衝突点と威力（火花演出）
  orbits[],        // 次ターンへ持ち越す永続周回
  popups[],        // ダメージ／回復の数値表示（#42）
  misfires[]       // このターン解決した暴発 {pos, owner}（instability の加算用・04b）
}
```

> **結界破壊点の演出同期（#64）**：`App.tsx` が `enemyRings[].breakPos` と `orbitBreaks` を `AnimOrbit.carves` の同期点として渡し、`BattleCanvas` の霧散演出は「弾がその点へ到達した瞬間」から始まる（従来はアニメ窓の 40% 固定時刻で開始しズレていた）。ロジックには影響しない（描画タイムラインのみ）。

`App.tsx` はこれを `ResolveAnimation`（`AnimBullet[]` / `AnimOrbit[]` / `clashes` / `popups` / **`deaths`** / **`bossView`**）に変換して `BattleCanvas` に渡す。`deaths[]`（`EnemyDeath = {id,pos,species,element,tier,hitboxRadius,boss}`）は「このターン hp>0→hp≤0 になった敵」を撃破前の敵から作り、`BattleCanvas` が種族別の消滅アニメ（`drawEnemyDeath`／ボスは `drawBossCollapse`）を再生する（05c §6.5・#46/#51）。`bossView = {phase,finale,outcome}` はボスの多段外見（`drawBossSprite`）に渡す描画専用の状態。**いずれも当たり判定・ダメージ計算には影響しない**（描画タイムラインのみ）。

---

## 9.4 モジュール構成（`src/`）

```
src/
├ main.tsx                  React エントリ
├ App.tsx                   画面遷移・3人コンポーザ・タイマー・演出データ組み立て
├ game/                     ゲームロジック（純粋関数・*.test.ts 併設）
│  ├ types.ts               共有ドメイン型
│  ├ coords.ts              座標変換・軌道サンプリング・暴発点検出
│  ├ functions.ts           軌道カタログ・mathjs 評価・サンプル出力
│  ├ mathEngine.ts          mathjs 限定インスタンス＋安全パース
│  ├ zfields.ts             z 場プリセット
│  ├ attribute.ts           z→属性・強度・相性・威力・ダメージ
│  ├ physics.ts             加速度・速度・消滅（エネルギー積分）
│  ├ loop.ts                発射型/軌道型の分類
│  ├ orbit.ts               結界（掃射・迎撃・オーラ・壁破壊）
│  ├ collision.ts           当たり判定（線分×円）
│  ├ obstacle.ts            障害物のえぐり（素材判定・半径・速度損）
│  ├ carve.ts               障害物の削り解決本体（`carveAlong`／`densifyGeom`）。turn.ts と enemyPlanning/ が共有
│  ├ misfire.ts             暴発
│  ├ misfireInstability.ts  暴発の不安定化・累積・崩壊（膜メーター・04b）
│  ├ parry.ts               相殺（発射型どうしは実衝突 `bulletCollision`・#64／結界の迎撃は線分交差。反対極のみ）
│  ├ status.ts              状態異常（ひるみ/継続ダメージ）
│  ├ enemyAI.ts             敵 AI（facade・ロール振り分け・迂回型の計画）
│  ├ enemyPlanning/         敵AIの軌道計画（[05](05-enemies.md) §5.4/§5.4b）
│  │  ├ planningEnv.ts        本番と同一ジオメトリの空間クエリ・clearance
│  │  ├ routeSearch.ts        グリッド A*＋見通し線平滑化（clean/wallTunnel）
│  │  ├ routeFit.ts           経路→family（abs/arc/poly34/harmonic）フィット（自由度は fitComplexity 依存）
│  │  ├ fitComplexity.ts      敵 LVL→最適化できる式の複雑さ（次数・折れ枚数・積の因子・#70）
│  │  ├ evaluate.ts           候補軌道の本番物理検証（carveAlong 共有・辞書式 rank 比較）
│  │  ├ ruptorPlanner.ts      暴発型（ruptor）の計画・z 場の極（`buildRuptorZField`）
│  │  ├ guardianPlanner.ts    守護型（guardian）の結界計画（候補の組み立て・順位づけ・最終検証・#71）
│  │  ├ guardianShape.ts      結界の外形（自由半径プロファイル→フーリエ級数フィット・素材接触の検証）
│  │  ├ guardianZ.ts          結界の z 場候補（一様/余弦/多重余弦/exp×余弦・過励起）と本番物理での採点
│  │  ├ guardianTier.ts       敵 LVL→結界の複雑さ（外形項数・z 場の式・重ね張り枚数・#71）
│  │  ├ trajectories.ts       family→軌道の組み立て（attacker/ruptor 共有）
│  │  └ perception.ts         隠蔽時の見かけ位置・脅威優先度（attacker/ruptor 共有）
│  ├ recommend.ts           おすすめ術式の探索
│  ├ exprFit.ts             式の係数化（数値→スライダー）・通過点フィット（最小二乗・#46）
│  ├ turn.ts                ターン解決の中核
│  └ battle.ts              戦闘ループ・勝敗判定
├ data/
│  ├ constants.ts           バランス定数（[08](08-constants.md)）
│  ├ stages.ts              全 7 ステージ（[06](06-stages.md)）
│  ├ party.ts               自陣営 3 人
│  └ story.ts               世界観テキスト
├ components/               React UI（BattleCanvas/FunctionPanel/Hud/Codex/Guide/screens/composer）
├ render/                   draw.ts（描画関数群）・theme.ts（配色）・species.ts（種族→パレット/装飾の純粋関数・05c §0/§6・#46）・textures.ts（壁タイル）
├ audio/sound.ts            Web Audio 合成の効果音・BGM
└ styles/                   CSS・フォント
```

> ゲームロジック（`src/game/`）は React state や Canvas に依存しない純粋関数として切り出し、ユニットテストで固める方針（各 `*.test.ts`）。
</content>

---

## 9.6 UI 側のモジュール（`src/components/` / `src/render/`）

エンジン（`src/game/`）は**読むだけ**。エンジンが返さない情報を UI が必要とするときは、
必ず `src/components/` か `src/render/` に「派生計算」として置く（`src/game/` には置かない）。

| モジュール | 役割 |
|---|---|
| `components/composer.ts` | `ComposerState`（術式の編集状態）→ `Trajectory` / `ZField` / プレビュー |
| `components/rayInfo.ts` | 射線上に何があるか・距離 r での読み取り値・極・立ちはだかる結界（[03 §3.6](03-functions.md)） |
| `components/readout.ts` | 上をまとめて「読み出しストリップ」「4 マスの数値」「術者カードの一行」を組む |
| `components/zshape.ts` | z の正準形（山/段/波/平）の解析と生成（[03 §3.2b](03-functions.md)） |
| `components/polyFit.ts` | 作図台の最小二乗多項式フィットと式整形 |
| `components/solveAngle.ts` | 「⟳ 解く」：形はそのままに的を通る θ を数値探索（`simulateFlight` を実際に回す） |
| `components/testStage.ts` | 「試しの間」（壁 4 種＋直射敵 2 体の練習部屋）の Stage を組み立てる |
| `render/tutorialFigures.ts` | 手引き（8 枚）の canvas 図版 |
| `render/endroll.ts` | エンドロールの AI 同士の自動対戦（`planEnemyShots`/`enemyFlight`/`resolveParry` をそのまま使う） |

### `ComposerState`（`composer.ts`）

```ts
{
  mode: 'rotate' | 'polar',       // y 欄が `r=` で始まると polar（結界）
  presetId, coeffs, angle, speed,
  useFree, freeExpr, freeError,   // エンジンへ渡す式（係数検出で整形された形）
  yText, zText,                   // 入力欄に表示する「ユーザーが打った生のテキスト」
  fitTemplate, fitParams, fitValues,      // 式中の数値リテラル→係数スライダー（#46）
  zRadial: boolean,               // true: z を g(t)（術者からの距離）として読む（既定）
  zPresetId, zCoeffs,             // zRadial=false の互換経路のみ使う
  zUseFree, zFreeExpr, zFreeError,
  zFitTemplate, zFitParams, zFitValues,
}
```

> `freeExpr` と `yText` を分けているのは、**打鍵のたびに入力欄が整形されない**ようにするため。
> エンジンへ渡すのは `freeExpr` / `zFreeExpr`、画面に出すのは `yText` / `zText`。

### 見返し（プレイバック）の状態

`App.tsx` が直近 8 ターンぶんの `ReplayEntry`（`{turn, animation, allies, enemies, obstacles, rField}`＝
**解決前の盤面ごと**）を持つ。見返し中は `BattleCanvas` にそのスナップショットと
`playback: {paused, seekMs, seekToken, rate}` を渡し、`replay` を立てて終端でも `onAnimationDone` を呼ばせない。
`seekToken` が変わったフレームだけ時計が飛び、そのとき既に過ぎている演出は「はるか過去」に畳んで無音で通過させる
（巻き戻しで全エフェクトが一斉に再生されるのを防ぐ）。
