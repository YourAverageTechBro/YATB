import handler from '@tanstack/react-start/server-entry'
import { cleanupTombstonedVideos } from './server/media.server'
import { consumeCompressionQueue, reconcileDerivatives } from './server/compression.server'
import { reconcileDraftStreams } from './server/stream.server'

export { CompressionContainer } from './server/compression-container'

export default {
  fetch(request) {
    return handler.fetch(request)
  },
  async scheduled(_controller, env) {
    await Promise.all([cleanupTombstonedVideos(env), reconcileDerivatives(env), reconcileDraftStreams(env)])
  },
  queue: consumeCompressionQueue,
} satisfies ExportedHandler<Cloudflare.Env>
