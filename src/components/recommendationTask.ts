import type { RecommendBatchInput, RecommendBatchReply, RecommendBatchResult } from '../game/recommendBatch'

export interface RecommendationWorker {
  postMessage: (input: RecommendBatchInput) => void
  terminate: () => void
  onmessage: ((event: MessageEvent<RecommendBatchReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
}

/** 中断後にキューから届いた応答も無視する。同期探索へのフォールバックはしない。 */
export function startRecommendationTask(
  input: RecommendBatchInput,
  onResult: (results: RecommendBatchResult) => void,
  onError: () => void,
  createWorker: () => RecommendationWorker = () =>
    new Worker(new URL('./recommend.worker.ts', import.meta.url), { type: 'module' }),
): () => void {
  let active = true
  let worker: RecommendationWorker | undefined
  const cancel = () => {
    active = false
    worker?.terminate()
  }
  const fail = () => {
    if (!active) return
    cancel()
    onError()
  }
  try {
    worker = createWorker()
    worker.onmessage = ({ data }) => {
      if (!active) return
      if (!data.ok) return fail()
      cancel()
      onResult(data.results)
    }
    worker.onerror = fail
    worker.onmessageerror = fail
    worker.postMessage(input)
  } catch {
    fail()
  }
  return cancel
}
