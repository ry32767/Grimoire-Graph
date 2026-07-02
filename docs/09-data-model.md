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
| `Trajectory` | `RotateTrajectory`（g, angle, origin, z?）か `PolarTrajectory`（f, origin, z?）の共用体 |
| `Spell` / `AllyCast` | 発射入力（owner/trajectory/initialSpeed、味方は allyId） |
| `Flight` / `FlightSample` | 物理シミュ結果（samples・end・endPos・endSpeed） |
| `FlightEnd` | `'vanished'(速度0消滅) \| 'outOfField' \| 'invalid'(暴発) \| 'maxParam'(完走)` |
| `StatusEffect` | `flinch`/`burn`＋magnitude＋remainingTurns |
| `Enemy` / `Ally` | 敵・味方術者（[05](05-enemies.md)/[01](01-overview.md) 参照）。敵は `ruptorTarget`/`castCount`/`patternPool`/`fireEvery`/`fireOffset`/`boss`/`slipThrough`/`alternatingAura`/`guardZSign` の拡張フィールドを持つ（#42/#44/#45/05b） |
| `EnemyFamily` | `line \| arc \| wave \| spiral \| exp \| poly34`（得意関数の系統・#43） |
| `EnemyRole` | `attacker \| breaker \| guardian \| ruptor`（#42） |
| `Disc` / `Obstacle` / `ObstacleKind` | 障害物（solids − carves・耐久種別） |
| `CarveBurst` | 削る瞬間の演出データ |
| `ActiveOrbit` | 永続する周回結界（#39） |
| `Mechanics` | `{ obstacles, enemyFire }`（段階的解禁） |
| `BossPhase` | ボスの HP フェーズ（#45）：`{ hpBelow, castCount, obstacles, cullMinions? }` |
| `Stage` | ステージ定義（enemies/obstacles/introText/clearText/mechanics/boss?/bossPhases?） |
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
  finale?: 'pending'|'cast'|'done'  // 断末魔（ボスHP0後の暴発3連）の進行状態
}
```

> **ラン全体の状態**（`instability`・初回崩壊済みフラグ・図鑑補足の既読など・04b）は `BattleState` ではなく `App.tsx` の React state が持つ（ステージをまたいで持ち越すため）。ゲームロジックへは `resolveTurn` の入力（`instability`/`misfireRoll`）として注入する。

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
2. **味方発射を分類・構築** … `classifyTrajectory` で発射型/軌道型に。軌道型は壁接触/失速で**霧散**判定。
3. **防御** … 各敵弾に対し：
   - 3z. 障害物が敵弾を削る（味方の盾）。
   - 3a. 軌道型リング（新規＋永続）が境界で迎撃（反対極のみ相殺）。
   - 3b. 発射型のパリィ（反対極で交差したら速度を削り合う）。
   - 減衰イベントを蓄積し、毎回「元初速＋全減衰」で再シミュレート。
4. **障害物** … 味方の発射型を削りながら遮る。
5. **攻撃** … 発射型は最手前ヒットへダメージ／軌道型は掃射／命中せず invalid なら暴発（半径は instability でばらつく・04b §4b.3）。guardian 結界による減速もここで処理。
6. **5.5 周回オーラ** … 囲んだ味方へ光=固定回復/闇=隠蔽（内側優先で最大 2 つ）。
7. **5.6 敵結界のオーラ** … 光の敵リングは囲んだ敵陣を回復（05b §5.4）。
8. **敵弾が味方へ命中** … パス上で最初に当たった味方へダメージ＋状態異常（ruptor の弾は除く）。
9. **6b 崩し手の暴発** … 迎撃されず極まで届いた ruptor 弾は暴発 AoE（敵味方無差別・壁も削る）。`misfires` に計上。
10. **永続周回の更新** … 相殺されず生き残った既存＋今ターン新規（壊れていない・所有者生存）を次ターンへ持ち越し。

### `ResolveResult`

```ts
{
  allies, enemies, obstacles, log,
  allyShots[],     // 味方の発射（描画・命中情報）
  enemyShots[],    // 敵弾（描画・命中情報・misfirePos/misfired）
  enemyRings[],    // guardian の防御リング（描画用）
  clashes[],       // 弾/結界の衝突点と威力（火花演出）
  orbits[],        // 次ターンへ持ち越す永続周回
  popups[],        // ダメージ／回復の数値表示（#42）
  misfires[]       // このターン解決した暴発 {pos, owner}（instability の加算用・04b）
}
```

`App.tsx` はこれを `ResolveAnimation`（`AnimBullet[]` / `AnimOrbit[]` / `clashes`）に変換して `BattleCanvas` に渡す。

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
│  ├ misfire.ts             暴発
│  ├ misfireInstability.ts  暴発の不安定化・累積・崩壊（膜メーター・04b）
│  ├ parry.ts               相殺（線分交差・反対極のみ）
│  ├ status.ts              状態異常（ひるみ/継続ダメージ）
│  ├ enemyAI.ts             敵 AI（系統・ロール・探索・壁よけ）
│  ├ recommend.ts           おすすめ術式の探索
│  ├ turn.ts                ターン解決の中核
│  └ battle.ts              戦闘ループ・勝敗判定
├ data/
│  ├ constants.ts           バランス定数（[08](08-constants.md)）
│  ├ stages.ts              全 7 ステージ（[06](06-stages.md)）
│  ├ party.ts               自陣営 3 人
│  └ story.ts               世界観テキスト
├ components/               React UI（BattleCanvas/FunctionPanel/Hud/Codex/Guide/screens/composer）
├ render/                   draw.ts（描画関数群）・theme.ts（配色）
├ audio/sound.ts            Web Audio 合成の効果音・BGM
└ styles/                   CSS・フォント
```

> ゲームロジック（`src/game/`）は React state や Canvas に依存しない純粋関数として切り出し、ユニットテストで固める方針（各 `*.test.ts`）。
</content>
