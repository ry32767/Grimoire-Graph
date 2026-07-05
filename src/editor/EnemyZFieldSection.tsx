// EnemyForm の z場編集セクション（#67 §6.2）。暴発型は AI が動的に極を計画するため編集項目を持たない。
// z場プリセット・符号・自由入力式は Enemy 型に残さない一時状態として管理する（castZField 関数からは
// 逆算できないため。敵を選び直すと見た目だけの推定に初期化される＝#67 土台の割り切り）。
import { useEffect, useState } from 'react'
import type { Enemy } from '../game/types'
import { ZFieldPresetSelect } from './EnemyFormFields'
import { buildCastZField, isValidZExpression, type ZFieldPreset } from './enemyRules'

interface Props {
  enemy: Enemy
  zPresets: ZFieldPreset[]
  onChange: (next: Enemy) => void
}

export default function EnemyZFieldSection({ enemy, zPresets, onChange }: Props) {
  const [zPreset, setZPreset] = useState<ZFieldPreset>(enemy.castZField ? 'sinCos' : 'constant')
  const [zSign, setZSign] = useState<1 | -1>(enemy.castZ >= 0 ? 1 : -1)
  const [customExpr, setCustomExpr] = useState('')
  useEffect(() => {
    setZPreset(enemy.castZField ? 'sinCos' : 'constant')
    setZSign(enemy.castZ >= 0 ? 1 : -1)
    setCustomExpr('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enemy.id])

  if (enemy.role === 'ruptor') {
    return <p className="hint">z場は攻撃のたび AI が対象へ向けて自動で極（1/x型）を計画する（05b §4）。ここでの設定は不要。</p>
  }

  const applyZField = (preset: ZFieldPreset, sign: 1 | -1, expr: string) => {
    // castZField は enemy() ファクトリ内で (mag)=>ZField を castMag に適用した結果（ZField 本体）を
    // 保持する。ここでは既存の castZ の大きさ（無ければ既定3）を castMag 相当として使い、即時に適用する。
    const mag = Math.abs(enemy.castZ) || 3
    const builder = buildCastZField(preset, sign, expr)
    onChange({ ...enemy, castZField: builder?.(mag), castZ: sign * mag })
  }

  return (
    <>
      <label>
        z場プリセット
        <ZFieldPresetSelect
          value={zPreset}
          options={zPresets}
          onChange={(p) => {
            setZPreset(p)
            applyZField(p, zSign, customExpr)
          }}
        />
      </label>
      {(zPreset === 'sinCos' || zPreset === 'exp') && (
        <label>
          極性
          <select
            value={zSign}
            onChange={(e) => {
              const s = Number(e.target.value) as 1 | -1
              setZSign(s)
              applyZField(zPreset, s, customExpr)
            }}
          >
            <option value={1}>光（+）</option>
            <option value={-1}>闇（−）</option>
          </select>
        </label>
      )}
      {zPreset === 'custom' && (
        <label>
          自由入力式 z(x,y)（mathjsのみで評価）
          <input
            type="text"
            value={customExpr}
            placeholder="例: 2*sin(0.3*x+0.2*y)"
            onChange={(e) => {
              setCustomExpr(e.target.value)
              applyZField('custom', zSign, e.target.value)
            }}
          />
          <span className={isValidZExpression(customExpr) ? 'expr-ok' : 'expr-ng'}>
            {customExpr === '' ? '' : isValidZExpression(customExpr) ? '式は有効' : '式が不正（直前の設定を維持）'}
          </span>
        </label>
      )}
    </>
  )
}
