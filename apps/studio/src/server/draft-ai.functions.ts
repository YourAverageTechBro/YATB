import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { parseWriteupRequest, parseWriteupSave, parseWriteupTarget } from '#/domain/draft-writeups'

async function readSession() {
  // Imported inside the handler so the server modules stay out of the client bundle.
  const { PRIVATE_NO_STORE, requireStudioSession } = await import('./auth.server')
  setResponseHeader('Cache-Control', PRIVATE_NO_STORE)
  return requireStudioSession()
}

async function mutationSession() {
  const { requireStudioMutationOrigin } = await import('./auth.server')
  const session = await readSession()
  requireStudioMutationOrigin()
  return session
}

export const loadDraftWriteups = createServerFn({ method: 'GET' })
  .validator(parseWriteupTarget)
  .handler(async ({ data }) => {
    await readSession()
    return (await import('./draft-ai.server')).loadWriteups(data)
  })

export const requestDraftWriteup = createServerFn({ method: 'POST' })
  .validator(parseWriteupRequest)
  .handler(async ({ data }) => {
    await mutationSession()
    return (await import('./draft-ai.server')).requestWriteup(data)
  })

export const saveDraftWriteup = createServerFn({ method: 'POST' })
  .validator(parseWriteupSave)
  .handler(async ({ data }) => {
    const session = await mutationSession()
    return (await import('./draft-ai.server')).saveWriteup(data, session.user.id)
  })

export const loadDraftTranscript = createServerFn({ method: 'GET' })
  .validator(parseWriteupTarget)
  .handler(async ({ data }) => {
    await readSession()
    return (await import('./draft-ai.server')).loadTranscript(data)
  })
