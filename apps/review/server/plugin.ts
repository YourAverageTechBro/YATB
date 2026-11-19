import type { Plugin } from 'vite'
import { createMiddleware } from './http.ts'
import { openStore } from './store.ts'

export function reviewApi(): Plugin {
  return {
    name: 'yatb-review-api',
    configureServer(server) {
      const store = openStore()
      server.middlewares.use(createMiddleware(store))
      server.httpServer?.on('close', () => store.close())
    },
  }
}
