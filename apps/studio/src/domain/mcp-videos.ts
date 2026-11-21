import { z } from 'zod'
import { parseContentType, parseDisplayName, parseMediaId } from './media'
import { documentText } from '../server/rich-document'
import { anchorStartMs, type Draft, type ReviewComment } from './reviews'
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

const GIB = 1024 * 1024 * 1024
/** R2 single-object PUT max is just under 5 GiB. */
export const MCP_DRAFT_UPLOAD_MAX_BYTES = Math.floor(4.9 * GIB)
export const MCP_DRAFT_UPLOAD_URL_TTL_MS = 2 * 60 * 60 * 1000
export const MCP_DRAFT_UPLOAD_TTL_MS = MCP_DRAFT_UPLOAD_URL_TTL_MS + 15 * 60 * 1000

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

export const requestVideoUploadInputSchema = z.object({
  video_id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size: z.number().int(),
}).strict()

export const finalizeVideoUploadInputSchema = z.object({
  upload_id: z.string(),
}).strict()

export const listDraftVersionsInputSchema = z.object({
  video_id: z.string(),
}).strict()

export const createGuestLinkInputSchema = z.object({
  video_id: z.string(),
  draft_id: z.string().optional(),
}).strict()

export const listVideoCommentsInputSchema = z.object({
  video_id: z.string(),
  draft_id: z.string().optional(),
  include_resolved: z.boolean().optional(),
}).strict()

export type McpDraftVersionView = Readonly<{
  id: string
  version: number
  filename: string
  content_type: string
  size_bytes: number
  duration_ms: number
  created_at: number
  stream_state: Draft['stream']['state']
  stream_uid: string | null
  download_url: string
  download_expires_at: number
  guest_url: string | null
}>

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

export function parseRequestVideoUploadInput(value: unknown): {
  videoId: VideoId
  filename: string
  contentType: string
  size: number
} {
  const input = parseSchema(requestVideoUploadInputSchema, value)
  const contentType = parseContentType(input.content_type)
  if (!contentType.startsWith('video/')) throw new Error('content_type must be a video type.')
  if (input.size < 1 || input.size > MCP_DRAFT_UPLOAD_MAX_BYTES) {
    throw new Error(`size must be between 1 and ${MCP_DRAFT_UPLOAD_MAX_BYTES} bytes.`)
  }
  return {
    videoId: parseVideoId(input.video_id),
    filename: parseDisplayName(input.filename),
    contentType,
    size: input.size,
  }
}

export function parseFinalizeVideoUploadInput(value: unknown): string {
  return parseMediaId(parseSchema(finalizeVideoUploadInputSchema, value).upload_id)
}

export function parseListDraftVersionsInput(value: unknown): VideoId {
  return parseVideoId(parseSchema(listDraftVersionsInputSchema, value).video_id)
}

export function parseCreateGuestLinkInput(value: unknown): { videoId: VideoId; draftId?: string } {
  const input = parseSchema(createGuestLinkInputSchema, value)
  return {
    videoId: parseVideoId(input.video_id),
    draftId: input.draft_id === undefined ? undefined : parseMediaId(input.draft_id),
  }
}

export function parseListVideoCommentsInput(value: unknown): {
  videoId: VideoId
  draftId?: string
  includeResolved: boolean
} {
  const input = parseSchema(listVideoCommentsInputSchema, value)
  return {
    videoId: parseVideoId(input.video_id),
    draftId: input.draft_id === undefined ? undefined : parseMediaId(input.draft_id),
    includeResolved: input.include_resolved ?? true,
  }
}

export function guestReviewUrl(origin: string, token: string): string {
  return `${new URL(origin).origin}/shared-reviews/${token}`
}

export type McpCommentAuthor =
  | Readonly<{ type: 'user'; name: string }>
  | Readonly<{ type: 'guest'; name: string; email: string }>

export type McpCommentView = Readonly<{
  id: string
  draft_id: string
  draft_version: number
  timestamp_ms: number
  body: string
  author: McpCommentAuthor
  created_at: number
  resolved_at: number | null
  parent_id: string | null
}>

export function mcpCommentView(comment: ReviewComment, draftVersion: number): McpCommentView {
  const author: McpCommentAuthor = comment.author.guest === true
    ? { type: 'guest', name: comment.author.name, email: comment.author.email }
    : { type: 'user', name: comment.author.name }
  return {
    id: comment.id,
    draft_id: comment.draftId,
    draft_version: draftVersion,
    timestamp_ms: anchorStartMs(comment.anchor),
    body: documentText(comment.body),
    author,
    created_at: comment.createdAt,
    resolved_at: comment.resolvedAt,
    parent_id: comment.parentId,
  }
}

export function mcpDraftVersionView(
  draft: Draft,
  downloadUrl: string,
  expiresAt: number,
  origin: string,
): McpDraftVersionView {
  return {
    id: draft.id,
    version: draft.version,
    filename: draft.file.displayName,
    content_type: draft.file.contentType,
    size_bytes: draft.file.byteSize,
    duration_ms: draft.durationMs,
    created_at: draft.createdAt,
    stream_state: draft.stream.state,
    stream_uid: draft.stream.uid,
    download_url: downloadUrl,
    download_expires_at: expiresAt,
    guest_url: draft.shareToken ? guestReviewUrl(origin, draft.shareToken) : null,
  }
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
