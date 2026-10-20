import handler from '@tanstack/react-start/server-entry'
import { cleanupTombstonedVideos } from './server/media.server'
import { consumeCompressionQueue, reconcileDerivatives } from './server/compression.server'
import { consumeDraftAiQueue, reconcileDraftAiJobs } from './server/draft-ai.server'
import { reconcileDraftStreams } from './server/stream.server'

export { CompressionContainer } from './server/compression-container'

type QueueConsumer = (batch: MessageBatch<unknown>, env: Cloudflare.Env) => Promise<void>

/** Keyed by the queue names in wrangler.jsonc `queues.consumers`. */
const QUEUE_CONSUMERS = new Map<string, QueueConsumer>([
  ['yatb-video-compression', consumeCompressionQueue],
  ['yatb-draft-ai', consumeDraftAiQueue],
])

export default {
  fetch(request) {
    return handler.fetch(request)
  },
  async scheduled(_controller, env) {
    await Promise.all([
      cleanupTombstonedVideos(env),
      reconcileDerivatives(env),
      reconcileDraftStreams(env),
      reconcileDraftAiJobs(env),
    ])
  },
  queue(batch, env) {
    const consume = QUEUE_CONSUMERS.get(batch.queue)
    if (!consume) throw new Error(`No consumer for queue ${batch.queue}`)
    return consume(batch, env)
  },
} satisfies ExportedHandler<Cloudflare.Env>
