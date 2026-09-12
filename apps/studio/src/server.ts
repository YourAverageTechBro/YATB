import handler from '@tanstack/react-start/server-entry'
import { cleanupTombstonedVideos } from './server/media.server'

export default {
  fetch(request) {
    return handler.fetch(request)
  },
  async scheduled(_controller, env) {
    await cleanupTombstonedVideos(env)
  },
} satisfies ExportedHandler<Cloudflare.Env>
