repo: ry32767/Grimoire-Graph
branch: main
path: docs, src/data, src/game

## Last sync
date: 2026-08-02T02:35:00Z

### Updated in this project
- 定数を docs/08-constants.md に一致させた（rField=25・rotateXMax=48・暴発威力120・carveCost7 ほか）
- 障害物を「えぐり取り（solids − carves）」＋素材4種（通常/もろい/頑丈/不壊）へ置き換え
- 結界を周回結界の仕様へ：反対極のみ迎撃・威力の引き算で必ず片方消滅・失速自滅・破壊まで持続
- 暴発を仕様準拠に（威力120／ダメージ180固定・AoE内の壁除去・結界霧散・余波1.5秒で飛行弾を呑む）

## Screen map
| 画面 / ファイル | 参照した repo ファイル |
|---|---|
| Graph Mage Battle v2.dc.html（バトル一式） | docs/02-calculations.md, docs/04-magic.md, docs/04b-misfire-instability.md, docs/06-stages.md, docs/08-constants.md, src/data/party.ts |
| 盤面・障害物・結界の描画 | docs/04-magic.md §4.4/§4.6, docs/08-constants.md（OBSTACLE_KIND） |
