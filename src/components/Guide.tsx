// チュートリアル／初心者ガイド（機能16）。操作とターンの流れ・主要概念・各メカニクスを一言で説明。
interface Props {
  onClose: () => void
}

export default function Guide({ onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>はじめての術式ガイド</h2>
          <button className="btn small" onClick={onClose}>
            閉じる
          </button>
        </div>
        <ul className="tip-list">
          <li>
            <strong>ターンの流れ</strong>：まず<strong>敵が関数（術式）を公開</strong>します（紫の点線＝ゴースト）。
            それを見てから<strong>自分の関数を組み</strong>、「発射」で<strong>両者同時に</strong>解決します。
          </li>
          <li>
            <strong>関数で狙う</strong>：プリセットを選び、スライダーで形を整え、θ（角度）と初速を決めます。
            極座標 r=f(θ) なら全方向へ展開できます。自由入力（x の式）も使えます。
          </li>
          <li>
            <strong>当てる位置で属性が決まる</strong>：背景が金色（光）か紫藍（闇）かが「理の場」。
            当てた位置が<strong>光なら光属性・闇なら闇属性</strong>、0 から離れるほど強い。
          </li>
          <li>
            <strong>中立帯で加速、強属性帯で威力</strong>：|z| が 0 に近い暗い帯ほど弾が加速します。
            <strong>威力 = 命中時の速度 × 強度</strong>。中立帯で加速して、当てる瞬間に強属性帯へ差し込むのがコツ。
          </li>
          <li>
            <strong>相性</strong>：反対の理（光↔闇）に当てると ×1.5、同極は ×0.5。敵の弱点（属性）を突こう。
          </li>
          <li>
            <strong>暴発</strong>：関数がエラー（発散・場外）になった地点で術式が綻び、光と闇を最大強度で同時に放つ切り札。
            ただし <code>1/x</code> のような式は<strong>足元で暴発して自爆</strong>するので注意。
          </li>
          <li>
            <strong>結界・障害物・パリィ</strong>：結界（閉曲線）で敵弾の速度を削って止める。障害物は避けるか壊す。
            敵弾とぶつかったら、<strong>反対の理同士なら相殺</strong>、同極・中立はすり抜けます。
          </li>
          <li>
            <strong>困ったら</strong>：「困ったらこれ」で無難に当たるおすすめ関数をワンタップ。
            発射するまで何度でも調整でき、確定するまでターンは進みません。
          </li>
        </ul>
        <div className="center-actions">
          <button className="btn primary" onClick={onClose}>
            わかった！
          </button>
        </div>
      </div>
    </div>
  )
}
