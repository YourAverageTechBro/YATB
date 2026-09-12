import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import {
  parseCreateReviewComment,
  parseDeleteReviewComment,
  parseEditReviewComment,
} from '#/domain/reviews'
import { parseMediaId } from '#/domain/media'
import { parseVideoId } from '#/domain/videos'

function pair(value: unknown): { videoId: string; draftId: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Review query is required.')
  const input = value as Record<string, unknown>
  return { videoId: parseVideoId(input.videoId), draftId: parseMediaId(input.draftId) }
}

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

export const loadDrafts = createServerFn({ method: 'GET' })
  .validator(parseVideoId)
  .handler(async ({ data }) => {
    await readSession()
    return (await import('./reviews.server')).listDrafts(data)
  })

export const loadComments = createServerFn({ method: 'GET' })
  .validator(pair)
  .handler(async ({ data }) => {
    await readSession()
    return (await import('./reviews.server')).listComments(data.videoId, data.draftId)
  })

export const addComment = createServerFn({ method: 'POST' })
  .validator(parseCreateReviewComment)
  .handler(async ({ data }) => {
    const session = await mutationSession()
    return (await import('./reviews.server')).createComment(data, session.user.id)
  })

export const saveComment = createServerFn({ method: 'POST' })
  .validator(parseEditReviewComment)
  .handler(async ({ data }) => {
    await mutationSession()
    return (await import('./reviews.server')).updateComment(data)
  })

export const removeComment = createServerFn({ method: 'POST' })
  .validator(parseDeleteReviewComment)
  .handler(async ({ data }) => {
    await mutationSession()
    await (await import('./reviews.server')).deleteComment(data.videoId, data.id, data.expectedRevision)
    return { deleted: true as const }
  })
