import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { parseShareToken } from '#/domain/file-library'
import {
  parseComparisonQuery,
  parseCreateGuestReviewComment,
  parseCreateReviewComment,
  parseDeleteReviewComment,
  parseDraftShareRequest,
  parseEditReviewComment,
  parseResolveReviewComment,
  resolveComparison,
  type ComparisonQuery,
} from '#/domain/reviews'
import { parseMediaId } from '#/domain/media'
import { parseVideoId } from '#/domain/videos'

function pair(value: unknown): { videoId: string; draftId: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Review query is required.')
  const input = value as Record<string, unknown>
  return { videoId: parseVideoId(input.videoId), draftId: parseMediaId(input.draftId) }
}

function comparisonRequest(value: unknown): { videoId: string; query: ComparisonQuery } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Comparison query is required.')
  const input = value as Record<string, unknown>
  return {
    videoId: parseVideoId(input.videoId),
    query: parseComparisonQuery(input),
  }
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
    const drafts = await (await import('./reviews.server')).listDrafts(data)
    return (await import('./stream.server')).signDraftPlayback(drafts)
  })

export const loadComments = createServerFn({ method: 'GET' })
  .validator(pair)
  .handler(async ({ data }) => {
    await readSession()
    return (await import('./reviews.server')).listComments(data.videoId, data.draftId)
  })

export const loadComparison = createServerFn({ method: 'GET' })
  .validator(comparisonRequest)
  .handler(async ({ data }) => {
    await readSession()
    const drafts = await (await import('./stream.server')).signDraftPlayback(
      await (await import('./reviews.server')).listDrafts(data.videoId),
    )
    return resolveComparison(drafts, data.query)
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

export const resolveComment = createServerFn({ method: 'POST' })
  .validator(parseResolveReviewComment)
  .handler(async ({ data }) => {
    await mutationSession()
    return (await import('./reviews.server')).resolveComment(data.videoId, data.id, data.expectedRevision)
  })

export const createDraftReviewLink = createServerFn({ method: 'POST' })
  .validator(parseDraftShareRequest)
  .handler(async ({ data }) => {
    const session = await mutationSession()
    return (await import('./reviews.server')).createDraftShare(data.videoId, data.draftId, session.user.id)
  })

export const revokeDraftReviewLink = createServerFn({ method: 'POST' })
  .validator(parseDraftShareRequest)
  .handler(async ({ data }) => {
    await mutationSession()
    await (await import('./reviews.server')).revokeDraftShare(data.videoId, data.draftId)
    return { revoked: true as const }
  })

export const loadSharedReview = createServerFn({ method: 'GET' })
  .validator(parseShareToken)
  .handler(async ({ data }) => {
    const { PRIVATE_NO_STORE } = await import('./auth.server')
    setResponseHeader('Cache-Control', PRIVATE_NO_STORE)
    setResponseHeader('Referrer-Policy', 'strict-origin')
    const shared = await (await import('./reviews.server')).getSharedDraft(data)
    if (!shared) return { available: false as const }
    const [draft] = await (await import('./stream.server')).signDraftPlayback([shared.draft])
    const comments = await (await import('./reviews.server')).listComments(
      shared.draft.videoId, shared.draft.id, true,
    )
    return {
      available: true as const,
      videoTitle: shared.videoTitle,
      draft: draft ?? shared.draft,
      comments,
    }
  })

export const addGuestComment = createServerFn({ method: 'POST' })
  .validator(parseCreateGuestReviewComment)
  .handler(async ({ data }) => {
    const { PRIVATE_NO_STORE, requireStudioMutationOrigin } = await import('./auth.server')
    requireStudioMutationOrigin()
    const ip = getRequestHeaders().get('cf-connecting-ip') ?? 'local'
    try {
      return await (await import('./reviews.server')).createGuestComment(data, ip)
    } catch (error) {
      const { ReviewError } = await import('./reviews.server')
      if (error instanceof ReviewError) {
        throw new Response(error.message, { status: error.status, headers: { 'Cache-Control': PRIVATE_NO_STORE } })
      }
      throw error
    }
  })
