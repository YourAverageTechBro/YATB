import { z } from 'zod'
import { parseMediaId } from './media'
import { parsePostId, parsePostMediaId } from './posts'
import { parseVideoId } from './videos'
import { zodToolError } from './mcp-videos'

export const FILE_KINDS = ['footage', 'review_cut', 'post_media'] as const
export type FileKind = (typeof FILE_KINDS)[number]

export const MCP_FILE_PAGE_SIZE = 20
export const MCP_FILE_PAGE_MAX = 100
export const FILE_TAG_MAX_LENGTH = 40
export const FILE_TAG_MAX_COUNT = 20
export const FILES_MIGRATION_MESSAGE = 'Files catalog is unavailable until migration 0016 is applied.'

export type CatalogFile = Readonly<{
  id: string
  kind: FileKind
  name: string
  content_type: string
  size_bytes: number
  duration_ms: number | null
  created_at: number
  tags: readonly string[]
  video_id: string | null
  post_id: string | null
}>

export type ListFilesInput = Readonly<{
  kind?: FileKind
  video_id?: string
  post_id?: string
  tag?: string
  name?: string
  content_type?: string
  created_after?: number
  created_before?: number
  page: number
  limit: number
}>

export const listFilesInputSchema = z.object({
  kind: z.enum(FILE_KINDS).optional(),
  video_id: z.string().optional(),
  post_id: z.string().optional(),
  tag: z.string().optional(),
  name: z.string().optional(),
  content_type: z.string().optional(),
  created_after: z.number().int().optional(),
  created_before: z.number().int().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(MCP_FILE_PAGE_MAX).optional(),
}).strict()

export const getFileInputSchema = z.object({
  id: z.string(),
  kind: z.enum(FILE_KINDS).optional(),
}).strict()

export const setFileTagsInputSchema = z.object({
  id: z.string(),
  kind: z.enum(FILE_KINDS).optional(),
  tags: z.array(z.string()),
}).strict()

export const patchFileTagsInputSchema = z.object({
  id: z.string(),
  kind: z.enum(FILE_KINDS).optional(),
  tags: z.array(z.string()).min(1),
}).strict()

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(zodToolError(result.error))
  return result.data
}

export function parseFileKind(value: unknown): FileKind {
  if (typeof value === 'string' && (FILE_KINDS as readonly string[]).includes(value)) {
    return value as FileKind
  }
  throw new Error('File kind is invalid.')
}

export function parseFileId(kind: FileKind, value: unknown): string {
  switch (kind) {
    case 'footage':
    case 'review_cut':
      return parseMediaId(value)
    case 'post_media':
      return parsePostMediaId(value)
    default: {
      const unexpected: never = kind
      throw new Error(unexpected)
    }
  }
}

export function parseTag(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Tag is invalid.')
  const tag = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (tag.length < 1 || tag.length > FILE_TAG_MAX_LENGTH) {
    throw new Error(`Tag must be between 1 and ${FILE_TAG_MAX_LENGTH} characters.`)
  }
  if (/[\u0000-\u001f\u007f]/.test(tag)) throw new Error('Tag is invalid.')
  return tag
}

export function parseTags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error('Tags are required.')
  const tags = [...new Set(value.map(parseTag))]
  if (tags.length > FILE_TAG_MAX_COUNT) throw new Error(`Use at most ${FILE_TAG_MAX_COUNT} tags.`)
  return tags
}

export function parseListFilesInput(value: unknown): ListFilesInput {
  const input = parseSchema(listFilesInputSchema, value)
  return {
    kind: input.kind,
    video_id: input.video_id === undefined ? undefined : parseVideoId(input.video_id),
    post_id: input.post_id === undefined ? undefined : parsePostId(input.post_id),
    tag: input.tag === undefined ? undefined : parseTag(input.tag),
    name: input.name === undefined || input.name.trim() === '' ? undefined : input.name.trim(),
    content_type: input.content_type === undefined || input.content_type.trim() === ''
      ? undefined
      : input.content_type.trim().toLowerCase(),
    created_after: input.created_after,
    created_before: input.created_before,
    page: input.page ?? 1,
    limit: input.limit ?? MCP_FILE_PAGE_SIZE,
  }
}

export function parseGetFileInput(value: unknown): { id: string; kind?: FileKind } {
  const input = parseSchema(getFileInputSchema, value)
  if (input.kind !== undefined) return { id: parseFileId(input.kind, input.id), kind: input.kind }
  return { id: parseMediaId(input.id) }
}

export function parseSetFileTagsInput(value: unknown): { id: string; kind?: FileKind; tags: readonly string[] } {
  const input = parseSchema(setFileTagsInputSchema, value)
  const tags = parseTags(input.tags)
  if (input.kind !== undefined) return { id: parseFileId(input.kind, input.id), kind: input.kind, tags }
  return { id: parseMediaId(input.id), tags }
}

export function parsePatchFileTagsInput(value: unknown): { id: string; kind?: FileKind; tags: readonly string[] } {
  const input = parseSchema(patchFileTagsInputSchema, value)
  const tags = parseTags(input.tags)
  if (tags.length < 1) throw new Error('Tags are required.')
  if (input.kind !== undefined) return { id: parseFileId(input.kind, input.id), kind: input.kind, tags }
  return { id: parseMediaId(input.id), tags }
}

export function contentTypeFilter(value: string): { exact?: string; prefix?: string } {
  if (value.endsWith('/') || !value.includes('/')) {
    return { prefix: value.endsWith('/') ? value : `${value}/` }
  }
  return { exact: value }
}
