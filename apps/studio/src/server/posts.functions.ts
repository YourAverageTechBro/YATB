import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { parsePostId, parsePostRevision } from '#/domain/posts'

async function readSession() {
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

export const listPostDrafts = createServerFn({ method: 'GET' }).handler(async () => {
  await readSession()
  return (await import('./posts.server')).listPostDrafts()
})

export const loadPostDraft = createServerFn({ method: 'GET' })
  .validator(parsePostId)
  .handler(async ({ data }) => {
    await readSession()
    return (await import('./posts.server')).getPostDraft(data)
  })

export const createPostDraft = createServerFn({ method: 'POST' }).handler(async () => {
  const session = await mutationSession()
  return (await import('./posts.server')).createPostDraft(session.user.id)
})

export const savePostDraft = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }) => {
    const session = await mutationSession()
    const server = await import('./posts.server')
    return server.savePostDraft(server.parseSavePostInput(data), session.user.id)
  })

export const markPostReady = createServerFn({ method: 'POST' })
  .validator((data: { id: string; expectedRevision: number }) => ({
    id: parsePostId(data.id),
    expectedRevision: parsePostRevision(data.expectedRevision),
  }))
  .handler(async ({ data }) => {
    await mutationSession()
    return (await import('./posts.server')).markPostReady(data.id, data.expectedRevision)
  })

export const duplicatePostDraft = createServerFn({ method: 'POST' })
  .validator(parsePostId)
  .handler(async ({ data }) => {
    const session = await mutationSession()
    return (await import('./posts.server')).duplicatePostDraft(data, session.user.id)
  })
