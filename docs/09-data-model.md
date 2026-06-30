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
| `Enemy` / `Ally` | 敵・味方術者（[05](05-enemies.md)/[01](01-overview.md) 参照） |
| `EnemyFamily` | `line \| arc \| wave \| spiral`（得意関数の系統） |
| `EnemyRole` | `attacker \| breaker \| guardian` |
| `Disc` / `Obstacle` / `ObstacleKind` | 障害物（solids − carves・耐久種別） |
| `CarveBurst` | 削る瞬間の演出データ |
| `ActiveOrbit` | 永続する周回結界（#39） |
| `Mechanics` | `{ obstacles, enemyFire }`（段階的解禁） |
| `Stage` | ステージ定義（enemies/obstacles/introText/clearText/mechanics/boss?） |
| `Phase` | `'enemyReveal' \| 'compose' \| 'resolve'` |
| `LogEntry` | 戦闘ログ（kind で分類） |
| `BattleState` | 戦闘状態（メモリ上のみ・永続化なし） |

### `BattleState`

```ts
{
  stageIndex, allies[], enemies[], obstacles[], mechanics,
  turn, phase, log[], outcome: 'ongoing'|'cleared'|'gameover',
  orbits?: ActiveOrbit[]   // 持続中の周回結界
}
```

---

## 9.2 ターンの進行（`battle.ts`）

```
createBattleState(stage, index, party)   // HP 全快・turn=1・phase='enemyReveal'
        │
        ▼
prepareTurn(state)
  ├ 状態異常をターン減衰（味方/敵）：burn ダメージ適用、flinch 判定
  ├ castingEnemyIds（発射できる敵）／impairedAllyIds（ひるみ味方）を決定
  └ phase='compose'、outcome 判定
        │   ── 作成フェーズ（プレイヤー操作）──
        ▼
resolveAllyCasts(state, casts, castingEnemyIds)
  └ resolveTurn(...) で同時発射を解決 → 状態更新・turn+1・phase='resolve'・勝敗判定
```

- 敵がひるみ中、または `mechanics.enemyFire` が false なら発射しない。
- 味方がひるみ中、または HP 0 なら発射しない。
- `outcome`：味方全滅→`gameover`、敵全滅→`cleared`、それ以外→`ongoing`。

---

## 9.3 解決の中核（`resolveTurn`・`turn.ts`）

入力は非破壊（複製して新状態を返す）。解決はこの順序：

1. **敵弾を構築** … `planEnemyShot` で各敵の最大ダメージ軌道を決定。guardian の閉軌道は飛ばさず**防御リング**（`enemyRings`）へ分離。
2. **味方発射を分類・構築** … `classifyTrajectory` で発射型/軌道型に。軌道型は壁接触で**霧散**判定。強属性（|z|>zRef）で失速し速度0に達したら**自滅して霧散**（ログで明示・#31/#44）。
3. **防御** … 各敵弾に対し：
   - 3z. 障害物が敵弾を削る（味方の盾）。
   - 3a. 軌道型リング（新規＋永続）が境界で迎撃（反対極のみ相殺）。
   - 3b. 発射型のパリィ（反対極で交差したら速度を削り合う）。
   - 減衰イベントを蓄積し、毎回「元初速＋全減衰」で再シミュレート。
4. **障害物** … 味方の発射型を削りながら遮る。
5. **攻撃** … 発射型は最手前ヒットへダメージ／軌道型は掃射／命中せず invalid なら暴発。guardian 結界による減速もここで処理。
6. **5.5 周回オーラ** … 囲んだ味方へ光=固定回復/闇=隠蔽（内側優先で最大 2 つ）。
7. **敵弾が味方へ命中** … パス上で最初に当たった味方へダメージ＋状態異常。
8. **永続周回の更新** … 相殺されず生き残った既存＋今ターン新規（壊れていない・所有者生存）を次ターンへ持ち越し。

### `ResolveResult`

```ts
{
  allies, enemies, obstacles, log,
  allyShots[],     // 味方の発射（描画・命中情報）
  enemyShots[],    // 敵弾（描画・命中情報）
  enemyRings[],    // guardian の防御リング（描画用）
  clashes[],       // 弾/結界の衝突点と威力（火花演出）
  orbits[]         // 次ターンへ持ち越す永続周回
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
