import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'

export const loadSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getStudioSession, PRIVATE_NO_STORE } = await import('./auth.server')
    setResponseHeader('Cache-Control', PRIVATE_NO_STORE)
    return getStudioSession()
  },
)
