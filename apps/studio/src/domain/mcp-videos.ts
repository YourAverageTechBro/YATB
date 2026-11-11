import { z } from 'zod'
import {
  parseProduction,
  parsePublishDate,
  parseStatus,
  parseTitle,
  parseVideoId,
  VIDEO_FORMATS,
  VIDEO_PROMOTIONS,
  VIDEO_STATUSES,
  type Production,
  type Video,
  type VideoFormat,
  type VideoId,
  type VideoPromotion,
  type VideoStatus,
} from './videos'

export const MCP_VIDEO_PAGE_SIZE = 20
export const MCP_VIDEO_PAGE_MAX = 100

export type McpVideoView = Readonly<{
  id: VideoId
  title: string
  format: VideoFormat
  promotion: Production['promotion']
  organic_video_id: VideoId | null
  status: VideoStatus
  publish_date: string | null
  script: Video['script']
  revision: number
  created_at: number
  updated_at: number
}>

export const listVideosInputSchema = z.object({
  status: z.enum(VIDEO_STATUSES).optional(),
  format: z.enum(VIDEO_FORMATS).optional(),
  promotion: z.enum(VIDEO_PROMOTIONS).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(MCP_VIDEO_PAGE_MAX).optional(),
}).strict()

export const getVideoInputSchema = z.object({
  id: z.string(),
}).strict()

export const createVideoInputSchema = z.object({
  title: z.string(),
  format: z.enum(VIDEO_FORMATS),
  promotion: z.enum(VIDEO_PROMOTIONS),
  organic_video_id: z.string().nullable().optional(),
  status: z.enum(VIDEO_STATUSES).optional(),
  publish_date: z.string().nullable().optional(),
  script: z.unknown().optional(),
}).strict()

export const updateVideoInputSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  format: z.enum(VIDEO_FORMATS).optional(),
  promotion: z.enum(VIDEO_PROMOTIONS).optional(),
  organic_video_id: z.string().nullable().optional(),
  status: z.enum(VIDEO_STATUSES).optional(),
  publish_date: z.string().nullable().optional(),
  script: z.unknown().optional(),
}).strict()

export function mcpVideoView(video: Video): McpVideoView {
  return {
    id: video.id,
    title: video.title,
    format: video.production.format,
    promotion: video.production.promotion,
    organic_video_id: linkedOrganicId(video.production),
    status: video.status,
    publish_date: video.publishDate,
    script: video.script,
    revision: video.revision,
    created_at: video.createdAt,
    updated_at: video.updatedAt,
  }
}

export function linkedOrganicId(production: Production): VideoId | null {
  return production.format === 'long' && production.promotion === 'integration'
    ? production.organicVideoId
    : null
}

export function parseListVideosInput(value: unknown): {
  status?: VideoStatus
  format?: VideoFormat
  promotion?: VideoPromotion
  page: number
  limit: number
} {
  const input = parseSchema(listVideosInputSchema, value)
  return {
    status: input.status,
    format: input.format,
    promotion: input.promotion,
    page: input.page ?? 1,
    limit: input.limit ?? MCP_VIDEO_PAGE_SIZE,
  }
}

export function parseGetVideoInput(value: unknown): VideoId {
  return parseVideoId(parseSchema(getVideoInputSchema, value).id)
}

export function parseCreateVideoToolInput(value: unknown): {
  title: string
  production: Production
  status: VideoStatus
  publishDate: string | null
  script: unknown | undefined
} {
  const input = parseSchema(createVideoInputSchema, value)
  return {
    title: parseTitle(input.title),
    production: parseProduction({
      format: input.format,
      promotion: input.promotion,
      organicVideoId: input.organic_video_id,
    }),
    status: input.status === undefined ? 'not-started' : parseStatus(input.status),
    publishDate: parsePublishDate(input.publish_date ?? null),
    script: input.script,
  }
}

export function applyVideoPatch(current: Video, value: unknown): {
  id: VideoId
  expectedRevision: number
  title: string
  production: Production
  status: VideoStatus
  publishDate: string | null
  script: Video['script'] | unknown
} {
  const input = parseSchema(updateVideoInputSchema, value)
  const id = parseVideoId(input.id)
  if (id !== current.id) throw new Error('Video id is invalid.')
  const format = input.format ?? current.production.format
  const promotion = input.promotion ?? current.production.promotion
  const organicVideoId = format === 'long' && promotion === 'integration'
    ? (input.organic_video_id !== undefined ? input.organic_video_id : linkedOrganicId(current.production))
    : null
  return {
    id: current.id,
    expectedRevision: current.revision,
    title: input.title === undefined ? current.title : parseTitle(input.title),
    production: parseProduction({ format, promotion, organicVideoId }),
    status: input.status === undefined ? current.status : parseStatus(input.status),
    publishDate: input.publish_date === undefined ? current.publishDate : parsePublishDate(input.publish_date),
    script: input.script === undefined ? current.script : input.script,
  }
}

export function zodToolError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Input is invalid.'
  if (issue.code === 'unrecognized_keys') {
    const keys = 'keys' in issue ? (issue.keys as string[]).join(', ') : 'unknown'
    return `Unknown field ${keys}.`
  }
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return `${path}${issue.message}`
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(zodToolError(result.error))
  return result.data
}
