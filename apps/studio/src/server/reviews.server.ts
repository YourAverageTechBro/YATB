import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import type { MediaFile } from '#/domain/media'
import {
  parseReviewAnchor,
  type CreateReviewComment,
  type Draft,
  type EditReviewComment,
  type ReviewAnchor,
  type ReviewAuthor,
  type ReviewComment,
} from '#/domain/reviews'
import type { RichDocument } from './rich-document'
import { parseRichDocument } from './rich-document'
import { ACTIVE_VIDEO_SQL } from './video-sql'

const bindings = env as Cloudflare.Env & { DB: D1Database }

export class ReviewError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

type DraftRow = {
  id: string
  video_id: string
  version: number
  duration_ms: number
  created_at: number
  file_id: string
  display_name: string
  byte_size: number
  content_type: string
  file_created_at: number
  file_updated_at: number
  user_id: string
  user_name: string
  user_email: string
}

type CommentRow = {
  id: string
  video_id: string
  draft_id: string
  anchor_kind: 'point' | 'range'
  start_ms: number
  end_ms: number | null
  body_json: string
  revision: number
  created_at: number
  updated_at: number
  user_id: string
  user_name: string
  user_email: string
}

type AttachmentRow = {
  comment_id: string
  id: string
  video_id: string
  display_name: string
  byte_size: number
  content_type: string
  created_at: number
  updated_at: number
}

function author(row: { user_id: string; user_name: string; user_email: string }): ReviewAuthor {
  return { id: row.user_id, name: row.user_name, email: row.user_email }
}

function file(row: AttachmentRow | DraftRow): MediaFile {
  const draft = 'file_id' in row
  return {
    id: draft ? row.file_id : row.id,
    videoId: row.video_id,
    purpose: draft ? 'draft' : 'footage',
    displayName: row.display_name,
    byteSize: row.byte_size,
    contentType: row.content_type,
    createdAt: draft ? row.file_created_at : row.created_at,
    updatedAt: draft ? row.file_updated_at : row.updated_at,
  }
}

function draft(row: DraftRow): Draft {
  return {
    id: row.id,
    videoId: row.video_id,
    version: row.version,
    durationMs: row.duration_ms,
    file: file(row),
    author: author(row),
    createdAt: row.created_at,
  }
}

function anchor(row: CommentRow): ReviewAnchor {
  return row.anchor_kind === 'point'
    ? { kind: 'point', atMs: row.start_ms }
    : { kind: 'range', startMs: row.start_ms, endMs: row.end_ms ?? row.start_ms }
}

function document(value: string): RichDocument {
  try { return parseRichDocument(JSON.parse(value)) } catch { throw new ReviewError(500, 'Stored comment is invalid.') }
}

function comment(row: CommentRow, attachments: readonly MediaFile[]): ReviewComment {
  return {
    id: row.id,
    videoId: row.video_id,
    draftId: row.draft_id,
    anchor: anchor(row),
    body: document(row.body_json),
    revision: row.revision,
    author: author(row),
    attachments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function activeVideo(videoId: string): Promise<boolean> {
  return (await bindings.DB.prepare(
    `SELECT 1 AS present FROM video WHERE id = ? AND ${ACTIVE_VIDEO_SQL}`,
  ).bind(videoId).first()) !== null
}

async function draftDuration(videoId: string, draftId: string): Promise<number> {
  const row = await bindings.DB.prepare(
    `SELECT d.duration_ms FROM draft d JOIN video v ON v.id = d.video_id
     WHERE d.id = ? AND d.video_id = ? AND v.${ACTIVE_VIDEO_SQL}`,
  ).bind(draftId, videoId).first<{ duration_ms: number }>()
  if (!row) throw new ReviewError(404, 'Draft not found.')
  return row.duration_ms
}

export async function listDrafts(videoId: string): Promise<Draft[]> {
  if (!(await activeVideo(videoId))) throw new ReviewError(404, 'Video not found.')
  const result = await bindings.DB.prepare(
    `SELECT d.id, d.video_id, d.version, d.duration_ms, d.created_at,
            f.id AS file_id, f.display_name, f.byte_size, f.content_type,
            f.created_at AS file_created_at, f.updated_at AS file_updated_at,
            u.id AS user_id, u.name AS user_name, u.email AS user_email
     FROM draft d
     JOIN media_file f ON f.id = d.media_file_id AND f.video_id = d.video_id AND f.purpose = 'draft'
     JOIN user u ON u.id = d.created_by_user_id
     WHERE d.video_id = ? ORDER BY d.version DESC`,
  ).bind(videoId).all<DraftRow>()
  return result.results.map(draft)
}

export async function listComments(videoId: string, draftId: string): Promise<ReviewComment[]> {
  await draftDuration(videoId, draftId)
  const [comments, attachmentRows] = await Promise.all([
    bindings.DB.prepare(
      `SELECT c.*, u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM review_comment c JOIN user u ON u.id = c.author_user_id
       WHERE c.video_id = ? AND c.draft_id = ?
       ORDER BY c.start_ms ASC, c.created_at ASC, c.id ASC`,
    ).bind(videoId, draftId).all<CommentRow>(),
    bindings.DB.prepare(
      `SELECT a.comment_id, f.id, f.video_id, f.display_name, f.byte_size, f.content_type,
              f.created_at, f.updated_at
       FROM comment_attachment a
       JOIN review_comment c ON c.id = a.comment_id AND c.video_id = a.video_id
       JOIN media_file f ON f.id = a.media_file_id AND f.video_id = a.video_id
       WHERE c.video_id = ? AND c.draft_id = ? ORDER BY a.comment_id, a.position`,
    ).bind(videoId, draftId).all<AttachmentRow>(),
  ])
  const attachments = new Map<string, MediaFile[]>()
  for (const row of attachmentRows.results) {
    attachments.set(row.comment_id, [...(attachments.get(row.comment_id) ?? []), file(row)])
  }
  return comments.results.map((row) => comment(row, attachments.get(row.id) ?? []))
}

function bodyJson(body: RichDocument): string {
  return JSON.stringify(body)
}

function matchesRequest(
  comment: ReviewComment,
  input: CreateReviewComment,
  userId: string,
  validAnchor: ReviewAnchor,
): boolean {
  return comment.author.id === userId
    && JSON.stringify(comment.anchor) === JSON.stringify(validAnchor)
    && JSON.stringify(comment.body) === bodyJson(input.body)
    && comment.attachments.map((entry) => entry.id).join(',') === input.attachmentIds.join(',')
}

async function requireAttachments(videoId: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  const row = await bindings.DB.prepare(
    `SELECT COUNT(*) AS count FROM media_file
     WHERE video_id = ? AND purpose = 'footage' AND id IN (${placeholders})`,
  ).bind(videoId, ...ids).first<{ count: number }>()
  if (row?.count !== ids.length) throw new ReviewError(400, 'Every attachment must be footage from this video.')
}

export async function createComment(input: CreateReviewComment, userId: string): Promise<ReviewComment> {
  const durationMs = await draftDuration(input.videoId, input.draftId)
  const validAnchor = parseReviewAnchor(input.anchor, durationMs)
  await requireAttachments(input.videoId, input.attachmentIds)
  const existing = (await listComments(input.videoId, input.draftId)).find((entry) => entry.id === input.clientRequestId)
  if (existing) {
    if (!matchesRequest(existing, input, userId, validAnchor)) {
      throw new ReviewError(409, 'This comment request was already used for different content.')
    }
    return existing
  }
  const id = input.clientRequestId
  const now = Date.now()
  const startMs = validAnchor.kind === 'point' ? validAnchor.atMs : validAnchor.startMs
  const endMs = validAnchor.kind === 'range' ? validAnchor.endMs : null
  try {
    await bindings.DB.batch([
      bindings.DB.prepare(
        `INSERT INTO review_comment (
           id, video_id, draft_id, author_user_id, anchor_kind, start_ms, end_ms,
           body_json, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        id, input.videoId, input.draftId, userId, validAnchor.kind, startMs, endMs,
        bodyJson(input.body), now, now,
      ),
      ...input.attachmentIds.map((fileId, position) => bindings.DB.prepare(
        `INSERT INTO comment_attachment (comment_id, video_id, media_file_id, position)
         VALUES (?, ?, ?, ?)`,
      ).bind(id, input.videoId, fileId, position)),
    ])
  } catch (error) {
    const winner = (await listComments(input.videoId, input.draftId)).find((entry) => entry.id === id)
    if (!winner) throw error
    if (!matchesRequest(winner, input, userId, validAnchor)) throw error
    return winner
  }
  const created = (await listComments(input.videoId, input.draftId)).find((entry) => entry.id === id)
  if (!created) throw new ReviewError(500, 'Comment could not be loaded.')
  return created
}

async function commentDraft(videoId: string, id: string): Promise<string | null> {
  const row = await bindings.DB.prepare(
    `SELECT c.draft_id FROM review_comment c JOIN video v ON v.id = c.video_id
     WHERE c.id = ? AND c.video_id = ? AND v.${ACTIVE_VIDEO_SQL}`,
  ).bind(id, videoId).first<{ draft_id: string }>()
  return row?.draft_id ?? null
}

export async function updateComment(input: EditReviewComment): Promise<ReviewComment> {
  const draftId = await commentDraft(input.videoId, input.id)
  if (!draftId) throw new ReviewError(404, 'Comment not found.')
  const result = await bindings.DB.prepare(
    `UPDATE review_comment SET body_json = ?, revision = revision + 1, updated_at = ?
     WHERE id = ? AND video_id = ? AND revision = ?`,
  ).bind(bodyJson(input.body), Date.now(), input.id, input.videoId, input.expectedRevision).run()
  if (result.meta.changes !== 1) throw new ReviewError(409, 'This comment changed in another session.')
  const updated = (await listComments(input.videoId, draftId)).find((entry) => entry.id === input.id)
  if (!updated) throw new ReviewError(500, 'Comment could not be loaded.')
  return updated
}

export async function deleteComment(videoId: string, id: string, expectedRevision: number): Promise<void> {
  const result = await bindings.DB.prepare(
    `DELETE FROM review_comment WHERE id = ? AND video_id = ? AND revision = ?
       AND EXISTS (SELECT 1 FROM video WHERE id = ? AND ${ACTIVE_VIDEO_SQL})`,
  ).bind(id, videoId, expectedRevision, videoId).run()
  if (result.meta.changes === 1) return
  if (await commentDraft(videoId, id)) throw new ReviewError(409, 'This comment changed in another session.')
  throw new ReviewError(404, 'Comment not found.')
}
