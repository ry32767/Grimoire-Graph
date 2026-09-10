import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecommendBatchInput, RecommendBatchResult } from '../game/recommendBatch'
import { startRecommendationTask } from './recommendationTask'

/** 画面・戦闘状態の切替や手動編集で、探索と古い応答を破棄する。 */
export function useRecommendation(screen: string, battle: object | null) {
  const cancelRef = useRef<(() => void) | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancel = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
    setPending(false)
  }, [])
  useEffect(() => {
    setError(null)
    return cancel
  }, [screen, battle, cancel])

  const start = (input: RecommendBatchInput, onResult: (results: RecommendBatchResult) => void) => {
    cancel()
    setError(null)
    setPending(true)
    cancelRef.current = startRecommendationTask(input, (results) => {
      setPending(false)
      onResult(results)
    }, () => {
      setPending(false)
      setError('術式を計算できませんでした。もう一度おまかせを押してください。')
    })
  }
  return { pending, error, start, cancel }
}
