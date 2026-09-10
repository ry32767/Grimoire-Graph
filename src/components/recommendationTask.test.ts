import { describe, expect, it, vi } from 'vitest'
import { startRecommendationTask, type RecommendationWorker } from './recommendationTask'
import type { RecommendBatchInput, RecommendBatchReply } from '../game/recommendBatch'

const input: RecommendBatchInput = { allies: [], enemies: [], obstacles: [] }
const success: RecommendBatchReply = { ok: true, results: [{
  allyId: 'a', recommendation: { angle: 1, freeExpr: 'x', zConst: 2.5 },
}] }
function fakeWorker(): RecommendationWorker {
  return {
    postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null,
  }
}

describe('おすすめWorkerのライフサイクル', () => {
  it('入力を送信し、成功結果をそのまま一度返してWorkerを終了する', () => {
    const worker = fakeWorker()
    const onResult = vi.fn()
    const onError = vi.fn()
    startRecommendationTask(input, onResult, onError, () => worker)
    expect(worker.postMessage).toHaveBeenCalledWith(input)
    worker.onmessage?.(new MessageEvent('message', { data: success }))
    worker.onmessage?.(new MessageEvent('message', { data: success }))
    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith(success.results)
    expect(onError).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('中断後に遅れて届く結果や失敗は無視する', () => {
    const worker = fakeWorker()
    const onResult = vi.fn()
    const onError = vi.fn()
    const cancel = startRecommendationTask(input, onResult, onError, () => worker)
    cancel()
    expect(worker.terminate).toHaveBeenCalledOnce()
    worker.onmessage?.(new MessageEvent('message', { data: success }))
    worker.onerror?.(new Event('error') as ErrorEvent)
    expect(onResult).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('起動失敗を返し、新しい試行は成功できる', () => {
    const onError = vi.fn()
    const onResult = vi.fn()
    startRecommendationTask(input, onResult, onError, () => { throw new Error('blocked') })
    expect(onError).toHaveBeenCalledOnce()
    const worker = fakeWorker()
    startRecommendationTask(input, onResult, onError, () => worker)
    worker.onmessage?.(new MessageEvent('message', { data: success }))
    expect(onResult).toHaveBeenCalledOnce()
  })

  it.each(['execution', 'message', 'reply', 'send'])('%s の失敗で停止し同期計算は行わない', (kind) => {
    const worker = fakeWorker()
    const onError = vi.fn()
    const onResult = vi.fn()
    if (kind === 'send') worker.postMessage = () => { throw new Error('clone') }
    startRecommendationTask(input, onResult, onError, () => worker)
    if (kind === 'execution') worker.onerror?.(new Event('error') as ErrorEvent)
    if (kind === 'message') worker.onmessageerror?.(new MessageEvent('messageerror'))
    if (kind === 'reply') worker.onmessage?.(new MessageEvent('message', { data: { ok: false } }))
    expect(onError).toHaveBeenCalledOnce()
    expect(onResult).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
