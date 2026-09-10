import { recommendBatch, type RecommendBatchInput, type RecommendBatchReply } from '../game/recommendBatch'

self.onmessage = (event: MessageEvent<RecommendBatchInput>) => {
  let reply: RecommendBatchReply
  try {
    reply = { ok: true, results: recommendBatch(event.data) }
  } catch {
    reply = { ok: false }
  }
  self.postMessage(reply)
}
