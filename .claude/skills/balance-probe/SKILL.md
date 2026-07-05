---
name: balance-probe
description: 一時デバッグテスト（__probe.test.ts）でゲームロジック・敵AI・バランスを実測する型。バグの再現、掘削効率やAI挙動の比較（修正前/後・味方vs敵）、勝ち筋の成立実験に使う。実測ログの読解はサブエージェントに任せてもよい。
---

# 一時ボット実測（probe）

「理屈で議論せず、まず現行コードで再現・計測してから直す」ための型
（AGENT_PLAYBOOK §3・過去実績：不可解な壁撃ちの再現、掘削効率の味方vs敵比較、
第6面の勝ち筋ボット探索はすべてこの型で確定させた）。

## ルール

- ファイル名は `src/game/__probe.test.ts` のように **`__` 始まり**。**コミット禁止**
  （確定した知見だけを正規のテストに書き直してから削除する）。
- 出力は**1ターン1行の console.log**（`T{n}: 主要指標だけ`）。生オブジェクトを出さない。
- **修正前/後の比較**は `git stash push <対象ファイル>` → 実行 → `git stash pop`。
  「修正前で赤くなる」ことを確認してから回帰テストへ昇格させる。
- 実行結果が長くなる探索（複数戦略の総当たり等）はサブエージェントへ委任し、
  「各戦略の結果表＋結論」だけ返させる。

## 雛形（resolveTurn を1ターンずつ回す最小ループ）

```ts
// 一時デバッグ（コミットしない）
import { it } from 'vitest'
import { resolveTurn } from './turn'
import { constZField } from './zfields'
import type { Ally, Enemy, Obstacle } from './types'

it('probe', () => {
  const ally0: Ally = { id: 'v', name: 'v', pos: { x: 0, y: -15 }, hp: 5000, maxHp: 5000, element: 'light', statuses: [] }
  const e: Enemy = {
    id: 'e0', name: '敵', pos: { x: 0, y: 20 }, hp: 5000, maxHp: 5000, element: 'dark',
    hitboxRadius: 1.8, statuses: [], family: 'line',
    castTrajectory: { mode: 'rotate', g: () => 0, angle: 0 }, castInitialSpeed: 8, castZ: -2.5,
    role: 'breaker', level: 6, // ← 検証したい個体設定
  }
  let obstacles: Obstacle[] = [/* 壁 */]
  let allies = [ally0]
  for (let t = 1; t <= 10; t++) {
    const res = resolveTurn({
      allies, casts: [/* 味方側を測るならここに AllyCast */], enemies: [e],
      castingEnemyIds: ['e0'], obstacles, mechanics: { obstacles: true, enemyFire: true },
    })
    obstacles = res.obstacles
    allies = res.allies
    const s = res.enemyShots[0]
    console.log(`T${t}: carves=${s?.carves.length} hit=${s?.hits.length ? 'YES' : 'no'}`)
    if (s?.hits.length) break
  }
}, 120000)
```

- 味方側（おまかせ）を測る：`recommendCast` → `parseExpression(expr,'x')` →
  `{ mode:'rotate', g, angle: rec.angle, origin, z: constZField(rec.zConst) }` を
  `initialSpeed: FIELD.fixedSpeed` で casts に入れる（balance.test.ts の連打ボットと同形）。
- 多ターンの自動プレイ全体を測る：`createBattleState`/`prepareTurn`/`resolveAllyCasts` を使う
  （instability・崩壊判定込み。balance.test.ts の autoSpamPlay が実例）。
- 実行：`npx vitest run src/game/__probe.test.ts 2>&1 | grep -E "T[0-9]+:"`

## よく効く指標

- 掘削・突破：`enemyShots[0].carves.length` / `hits.length` / 停止点（flight 最終サンプル）
- 干渉：`log` の kind（parry/orbit/misfire）行数、`clashes.length`、`blocked`
- バランス：ターンごとの両陣 HP、`misfires.length`（instability 加算）
