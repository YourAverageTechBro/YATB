import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  failedSave,
  parseListConfig,
  parseProduction,
  parsePublishDate,
  parseRevision,
  parseSavedViewId,
  parseSavedViewName,
  parseStatus,
  parseTitle,
  parseVideoId,
  type SavedView,
  type SavedViewId,
  type SaveVideoResult,
  type Video,
  type VideoId,
  type VideoListConfig,
  type VideoRevision,
  type VideoSort,
  type VideoSummary,
} from '#/domain/videos'
import { parseRichDocument, type RichDocument } from './rich-document'
import { ACTIVE_VIDEO_SQL } from './video-sql'

const bindings = env as Cloudflare.Env & { DB: D1Database }

type CreateVideoInput = Readonly<{
  title: string
  production: Video['production']
  publishDate: string | null
  script: RichDocument
}>

type EditVideoInput = CreateVideoInput & Readonly<{
  id: VideoId
  expectedRevision: VideoRevision
  status: Video['status']
}>

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stored planning record is invalid.')
  }
  return value as Record<string, unknown>
}

function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Stored ${name} is invalid.`)
  }
  return value
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`Stored ${name} is invalid.`)
  return value
}

function parseVideoRow(value: unknown): Video {
  const row = asRecord(value)
  let scriptValue: unknown
  try { scriptValue = JSON.parse(String(row.script_json)) } catch { throw new Error('Stored script is invalid.') }
  return {
    id: parseVideoId(row.id),
    title: parseTitle(row.title),
    production: parseProduction({ format: row.format, promotion: row.promotion }),
    status: parseStatus(row.status),
    publishDate: parsePublishDate(nullableString(row.publish_date, 'publish date')),
    script: parseRichDocument(scriptValue),
    revision: parseRevision(number(row.revision, 'revision')),
    createdAt: number(row.created_at, 'creation time'),
    updatedAt: number(row.updated_at, 'update time'),
  }
}

function parseVideoSummaryRow(value: unknown): VideoSummary {
  const row = asRecord(value)
  return {
    id: parseVideoId(row.id),
    title: parseTitle(row.title),
    production: parseProduction({ format: row.format, promotion: row.promotion }),
    status: parseStatus(row.status),
    publishDate: parsePublishDate(nullableString(row.publish_date, 'publish date')),
    revision: parseRevision(number(row.revision, 'revision')),
    createdAt: number(row.created_at, 'creation time'),
    updatedAt: number(row.updated_at, 'update time'),
  }
}

function parseSavedViewRow(value: unknown): SavedView {
  const row = asRecord(value)
  return {
    id: parseSavedViewId(row.id),
    name: parseSavedViewName(row.name),
    config: parseListConfig({
      layout: row.layout,
      groupBy: row.group_by,
      status: row.status_filter,
      format: row.format_filter,
      sort: row.sort,
    }),
    createdAt: number(row.created_at, 'saved view creation time'),
    updatedAt: number(row.updated_at, 'saved view update time'),
  }
}

function orderBy(sort: VideoSort): string {
  if (sort === 'title-asc') return 'title COLLATE NOCASE ASC, id ASC'
  if (sort === 'publish-date-asc') return 'publish_date IS NULL ASC, publish_date ASC, id ASC'
  return 'updated_at DESC, id ASC'
}

function scriptJson(script: RichDocument): string {
  const value = JSON.stringify(script)
  if (new TextEncoder().encode(value).byteLength > 32 * 1024) {
    throw new Error('Rich text must be at most 32 KiB.')
  }
  return value
}

async function activeVideo(id: VideoId): Promise<Video | null> {
  const row = await bindings.DB.prepare(
    `SELECT id, title, format, promotion, status, publish_date, script_json, revision, created_at, updated_at
     FROM video WHERE id = ? AND ${ACTIVE_VIDEO_SQL}`,
  ).bind(id).first<unknown>()
  return row === null ? null : parseVideoRow(row)
}

async function saveResult(id: VideoId): Promise<SaveVideoResult> {
  return failedSave(await activeVideo(id))
}

export async function listVideos(
  config: VideoListConfig,
  limit: number,
  offset: number,
): Promise<VideoSummary[]> {
  const clauses = [ACTIVE_VIDEO_SQL]
  const values: string[] = []
  if (config.status !== 'all') {
    clauses.push('status = ?')
    values.push(config.status)
  }
  if (config.format !== 'all') {
    clauses.push('format = ?')
    values.push(config.format)
  }
  const result = await bindings.DB.prepare(
    `SELECT id, title, format, promotion, status, publish_date, revision, created_at, updated_at
     FROM video WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy(config.sort)} LIMIT ? OFFSET ?`,
  ).bind(...values, limit, offset).all<unknown>()
  return result.results.map(parseVideoSummaryRow)
}

export async function getVideo(id: VideoId): Promise<Video | null> {
  return activeVideo(id)
}

export async function createVideo(input: CreateVideoInput): Promise<Video> {
  const id = parseVideoId(crypto.randomUUID())
  const now = Date.now()
  await bindings.DB.prepare(
    `INSERT INTO video (
      id, title, format, promotion, status, publish_date, script_json, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'not-started', ?, ?, 1, ?, ?)`,
  ).bind(
    id,
    input.title,
    input.production.format,
    input.production.promotion,
    input.publishDate,
    scriptJson(input.script),
    now,
    now,
  ).run()
  const video = await activeVideo(id)
  if (!video) throw new Error('Created video could not be loaded.')
  return video
}

export async function updateVideo(input: EditVideoInput): Promise<SaveVideoResult> {
  const now = Date.now()
  const result = await bindings.DB.prepare(
    `UPDATE video SET
      title = ?, format = ?, promotion = ?, status = ?, publish_date = ?, script_json = ?,
      revision = revision + 1, updated_at = ?
     WHERE id = ? AND revision = ? AND ${ACTIVE_VIDEO_SQL}`,
  ).bind(
    input.title,
    input.production.format,
    input.production.promotion,
    input.status,
    input.publishDate,
    scriptJson(input.script),
    now,
    input.id,
    input.expectedRevision,
  ).run()
  if (result.meta.changes !== 1) return saveResult(input.id)
  const video = await activeVideo(input.id)
  if (!video) throw new Error('Updated video could not be loaded.')
  return { kind: 'saved', video }
}

export async function moveVideoStatus(
  id: VideoId,
  expectedRevision: VideoRevision,
  status: Video['status'],
): Promise<SaveVideoResult> {
  const result = await bindings.DB.prepare(
    `UPDATE video SET status = ?, revision = revision + 1, updated_at = ?
     WHERE id = ? AND revision = ? AND ${ACTIVE_VIDEO_SQL}`,
  ).bind(status, Date.now(), id, expectedRevision).run()
  if (result.meta.changes !== 1) return saveResult(id)
  const video = await activeVideo(id)
  if (!video) throw new Error('Moved video could not be loaded.')
  return { kind: 'saved', video }
}

export async function deleteVideo(
  id: VideoId,
  expectedRevision: VideoRevision,
): Promise<SaveVideoResult | { kind: 'deleted' }> {
  const result = await bindings.DB.prepare(
    `UPDATE video SET deleted_at = ?, revision = revision + 1, updated_at = ?
     WHERE id = ? AND revision = ? AND ${ACTIVE_VIDEO_SQL}`,
  ).bind(Date.now(), Date.now(), id, expectedRevision).run()
  return result.meta.changes === 1 ? { kind: 'deleted' } : saveResult(id)
}

export async function listSavedViews(ownerUserId: string): Promise<SavedView[]> {
  const result = await bindings.DB.prepare(
    `SELECT id, name, layout, group_by, status_filter, format_filter, sort, created_at, updated_at
     FROM saved_view WHERE owner_user_id = ? ORDER BY updated_at DESC, id ASC`,
  ).bind(ownerUserId).all<unknown>()
  return result.results.map(parseSavedViewRow)
}

export async function createSavedView(
  ownerUserId: string,
  name: string,
  config: VideoListConfig,
): Promise<SavedView> {
  const id = parseSavedViewId(crypto.randomUUID())
  const now = Date.now()
  await bindings.DB.prepare(
    `INSERT INTO saved_view (
      id, owner_user_id, name, layout, group_by, status_filter, format_filter, sort, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, ownerUserId, name, config.layout, config.groupBy, config.status, config.format, config.sort, now, now).run()
  const row = await bindings.DB.prepare(
    `SELECT id, name, layout, group_by, status_filter, format_filter, sort, created_at, updated_at
     FROM saved_view WHERE id = ? AND owner_user_id = ?`,
  ).bind(id, ownerUserId).first<unknown>()
  if (row === null) throw new Error('Saved view could not be loaded.')
  return parseSavedViewRow(row)
}

export async function deleteSavedView(ownerUserId: string, id: SavedViewId): Promise<boolean> {
  const result = await bindings.DB.prepare(
    'DELETE FROM saved_view WHERE id = ? AND owner_user_id = ?',
  ).bind(id, ownerUserId).run()
  return result.meta.changes === 1
}

export function parseCreateVideoInput(value: unknown): CreateVideoInput {
  const input = asRecord(value)
  return {
    title: parseTitle(input.title),
    production: parseProduction(input.production),
    publishDate: parsePublishDate(input.publishDate),
    script: parseRichDocument(input.script),
  }
}

export function parseEditVideoInput(value: unknown): EditVideoInput {
  const input = asRecord(value)
  return {
    ...parseCreateVideoInput(input),
    id: parseVideoId(input.id),
    expectedRevision: parseRevision(input.expectedRevision),
    status: parseStatus(input.status),
  }
}

export function parseSavedViewInput(value: unknown): Readonly<{
  name: string
  config: VideoListConfig
}> {
  const input = asRecord(value)
  return { name: parseSavedViewName(input.name), config: parseListConfig(input.config) }
}

export function parseMoveVideoInput(value: unknown): Readonly<{
  id: VideoId
  expectedRevision: VideoRevision
  status: Video['status']
}> {
  const input = asRecord(value)
  return {
    id: parseVideoId(input.id),
    expectedRevision: parseRevision(input.expectedRevision),
    status: parseStatus(input.status),
  }
}

export function parseDeleteVideoInput(value: unknown): Readonly<{
  id: VideoId
  expectedRevision: VideoRevision
}> {
  const input = asRecord(value)
  return { id: parseVideoId(input.id), expectedRevision: parseRevision(input.expectedRevision) }
}
