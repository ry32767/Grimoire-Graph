// 書き出しパネル（#67・docs/11-stage-editor.md §9）：TS/JSON コード片を生成しクリップボードへコピーする。
import { useState } from 'react'
import { exportToJSON, exportToTS } from './exportStage'
import type { EditorStage } from './model'

interface Props {
  stage: EditorStage
}

type CopyStatus = { kind: 'ts' | 'json'; ok: boolean } | null

export default function ExportBar({ stage }: Props) {
  const [status, setStatus] = useState<CopyStatus>(null)

  const copy = async (kind: 'ts' | 'json') => {
    const text = kind === 'ts' ? exportToTS(stage) : exportToJSON(stage)
    try {
      await navigator.clipboard.writeText(text)
      setStatus({ kind, ok: true })
    } catch {
      setStatus({ kind, ok: false })
    }
  }

  return (
    <div className="export-bar">
      <button className="btn" onClick={() => copy('ts')}>
        書き出し（TS）をコピー
      </button>
      <button className="btn" onClick={() => copy('json')}>
        書き出し（JSON）をコピー
      </button>
      {status && (
        <span className={status.ok ? 'export-status ok' : 'export-status ng'}>
          {status.ok
            ? `${status.kind === 'ts' ? 'TS' : 'JSON'} をコピーしました`
            : 'コピーに失敗しました（クリップボード権限を確認してください）'}
        </span>
      )}
    </div>
  )
}
