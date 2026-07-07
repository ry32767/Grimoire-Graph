// ステージ編集の Undo/Redo 履歴（#67 CAD風操作性）。
// setStage と同じ関数シグネチャ（値 or 更新関数）で使える薄いラッパー。
// ドラッグ中の連続更新は setWithoutHistory で1操作にまとめ、checkpoint() で
// ドラッグ開始時にだけ履歴を積む（毎 pointermove で履歴が積み上がるのを防ぐ）。
import { useState } from 'react'

const HISTORY_LIMIT = 50

export function useHistory<T>(initial: T | (() => T)) {
  const [present, setPresent] = useState<T>(initial)
  const [past, setPast] = useState<T[]>([])
  const [future, setFuture] = useState<T[]>([])

  /** 通常の変更：現在値を履歴に積んでから更新する（1呼び出し=1 Undo ステップ）。 */
  const set = (updater: T | ((prev: T) => T)) => {
    const next = typeof updater === 'function' ? (updater as (p: T) => T)(present) : updater
    setPast((p) => [...p, present].slice(-HISTORY_LIMIT))
    setFuture([])
    setPresent(next)
  }

  /** ドラッグ中などの連続更新：履歴を積まず現在値だけ差し替える。 */
  const setWithoutHistory = (updater: T | ((prev: T) => T)) => {
    setPresent((prev) => (typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater))
  }

  /** ドラッグ開始など「これから始まる一連の変更」の直前に1回呼ぶ。 */
  const checkpoint = () => {
    setPast((p) => [...p, present].slice(-HISTORY_LIMIT))
    setFuture([])
  }

  const undo = () => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setFuture((f) => [present, ...f])
    setPast((p) => p.slice(0, -1))
    setPresent(prev)
  }

  const redo = () => {
    if (future.length === 0) return
    const next = future[0]
    setPast((p) => [...p, present])
    setFuture((f) => f.slice(1))
    setPresent(next)
  }

  /** リセット等：履歴を空にして初期化する。 */
  const reset = (next: T) => {
    setPast([])
    setFuture([])
    setPresent(next)
  }

  return {
    state: present,
    set,
    setWithoutHistory,
    checkpoint,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  }
}
