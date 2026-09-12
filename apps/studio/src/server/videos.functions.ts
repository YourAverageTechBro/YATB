import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import {
  parsePlanningQuery,
  parseSavedViewId,
  parseVideoId,
  type Production,
  type VideoListConfig,
  type VideoRevision,
  type VideoStatus,
} from '#/domain/videos'
import type { RichDocument } from './rich-document'

type CreateVideoData = {
  title: string
  production: Production
  publishDate: string | null
  script: RichDocument
}

type EditVideoData = CreateVideoData & {
  id: string
  expectedRevision: VideoRevision
  status: VideoStatus
}

type MoveVideoData = { id: string; expectedRevision: VideoRevision; status: VideoStatus }
type DeleteVideoData = { id: string; expectedRevision: VideoRevision }
type SavedViewData = { name: string; config: VideoListConfig }

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

export const loadPlanning = createServerFn({ method: 'GET' })
  .validator(parsePlanningQuery)
  .handler(async ({ data }) => {
    const session = await readSession()
    const { listSavedViews, listVideos } = await import('./videos.server')
    const pageSize = 20
    const [page, savedViews] = await Promise.all([
      listVideos(data.config, pageSize + 1, (data.page - 1) * pageSize),
      listSavedViews(session.user.id),
    ])
    return { videos: page.slice(0, pageSize), savedViews, hasMore: page.length > pageSize }
  })

export const loadVideo = createServerFn({ method: 'GET' })
  .validator(parseVideoId)
  .handler(async ({ data }) => {
    await readSession()
    const { getVideo } = await import('./videos.server')
    return getVideo(data)
  })

export const createVideo = createServerFn({ method: 'POST' })
  .validator((data: CreateVideoData) => data)
  .handler(async ({ data }) => {
    await mutationSession()
    const server = await import('./videos.server')
    return server.createVideo(server.parseCreateVideoInput(data))
  })

export const saveVideo = createServerFn({ method: 'POST' })
  .validator((data: EditVideoData) => data)
  .handler(async ({ data }) => {
    await mutationSession()
    const server = await import('./videos.server')
    return server.updateVideo(server.parseEditVideoInput(data))
  })

export const moveVideoStatus = createServerFn({ method: 'POST' })
  .validator((data: MoveVideoData) => data)
  .handler(async ({ data }) => {
    await mutationSession()
    const server = await import('./videos.server')
    const input = server.parseMoveVideoInput(data)
    return server.moveVideoStatus(input.id, input.expectedRevision, input.status)
  })

export const removeVideo = createServerFn({ method: 'POST' })
  .validator((data: DeleteVideoData) => data)
  .handler(async ({ data }) => {
    await mutationSession()
    const server = await import('./videos.server')
    const input = server.parseDeleteVideoInput(data)
    return server.deleteVideo(input.id, input.expectedRevision)
  })

export const createSavedView = createServerFn({ method: 'POST' })
  .validator((data: SavedViewData) => data)
  .handler(async ({ data }) => {
    const session = await mutationSession()
    const server = await import('./videos.server')
    const input = server.parseSavedViewInput(data)
    return server.createSavedView(session.user.id, input.name, input.config)
  })

export const removeSavedView = createServerFn({ method: 'POST' })
  .validator(parseSavedViewId)
  .handler(async ({ data }) => {
    const session = await mutationSession()
    return (await import('./videos.server')).deleteSavedView(session.user.id, data)
  })
