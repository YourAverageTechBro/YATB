import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import type { MediaFile } from '#/domain/media'
import type { MediaDerivativeState } from '#/domain/derivatives'
import { parseShareToken } from '#/domain/file-library'
import {
  parseReviewAnchor,
  type CreateGuestReviewComment,
  type CreateReviewComment,
  type Draft,
  type EditReviewComment,
  type ReviewAnchor,
  type ReviewAuthor,
  type ReviewComment,
} from '#/domain/reviews'
import type { RichDocument } from './rich-document'
import { parseRichDocument, plainTextDocument } from './rich-document'
import { draftStreamFromRow } from './stream.server'
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
  derivative_state: MediaDerivativeState | null
  derivative_byte_size: number | null
  stream_uid: string | null
  stream_state: string | null
  share_token: string | null
}

type CommentRow = {
  id: string
  video_id: string
  draft_id: string
  parent_id: string | null
  resolved_at: number | null
  guest_email: string | null
  guest_name: string | null
  anchor_kind: 'point' | 'range'
  start_ms: number
  end_ms: number | null
  body_json: string
  revision: number
  created_at: number
  updated_at: number
  user_id: string | null
  user_name: string | null
  user_email: string | null
}

export type SharedDraftMedia = Readonly<{
  draft: Draft
  videoTitle: string
  stored: Readonly<{
    object_key: string
    display_name: string
    byte_size: number
    content_type: string
  }>
}>

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

function author(row: {
  user_id: string | null
  user_name: string | null
  user_email: string | null
  guest_email?: string | null
  guest_name?: string | null
}): ReviewAuthor {
  if (row.user_id && row.user_name && row.user_email) {
    return { id: row.user_id, name: row.user_name, email: row.user_email }
  }
  return {
    id: '',
    name: row.guest_name || 'Guest',
    email: row.guest_email ?? '',
    guest: true,
  }
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
    compactMp4: {
      state: row.derivative_state ?? 'queued',
      byteSize: row.derivative_byte_size,
    },
    stream: draftStreamFromRow(row.stream_state, row.stream_uid),
    author: author(row),
    createdAt: row.created_at,
    shareToken: row.share_token,
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
    parentId: row.parent_id,
    resolvedAt: row.resolved_at,
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
            d.stream_uid, d.stream_state,
            f.id AS file_id, f.display_name, f.byte_size, f.content_type,
            f.created_at AS file_created_at, f.updated_at AS file_updated_at,
            x.state AS derivative_state, x.byte_size AS derivative_byte_size,
            u.id AS user_id, u.name AS user_name, u.email AS user_email,
            s.token AS share_token
     FROM draft d
     JOIN media_file f ON f.id = d.media_file_id AND f.video_id = d.video_id AND f.purpose = 'draft'
     JOIN user u ON u.id = d.created_by_user_id
     LEFT JOIN media_derivative x ON x.source_media_file_id = f.id AND x.profile = 'compact-mp4-v1'
     LEFT JOIN draft_review_share s ON s.draft_id = d.id
     WHERE d.video_id = ? ORDER BY d.version DESC`,
  ).bind(videoId).all<DraftRow>()
  return result.results.map(draft)
}

export async function listComments(
  videoId: string,
  draftId: string,
  unresolvedOnly = false,
): Promise<ReviewComment[]> {
  await draftDuration(videoId, draftId)
  const visibility = unresolvedOnly
    ? `AND c.resolved_at IS NULL AND (
         c.parent_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM review_comment p
           WHERE p.id = c.parent_id AND p.video_id = c.video_id AND p.resolved_at IS NOT NULL
         )
       )`
    : ''
  const [comments, attachmentRows] = await Promise.all([
    bindings.DB.prepare(
      `SELECT c.*, u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM review_comment c LEFT JOIN user u ON u.id = c.author_user_id
       WHERE c.video_id = ? AND c.draft_id = ? ${visibility}
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
  authorId: string,
  validAnchor: ReviewAnchor,
): boolean {
  return comment.author.id === authorId
    && comment.parentId === input.parentId
    && JSON.stringify(comment.anchor) === JSON.stringify(validAnchor)
    && JSON.stringify(comment.body) === bodyJson(input.body)
    && comment.attachments.map((entry) => entry.id).join(',') === input.attachmentIds.join(',')
}

async function requireParent(videoId: string, draftId: string, parentId: string | null): Promise<void> {
  if (!parentId) return
  const parent = await bindings.DB.prepare(
    `SELECT parent_id, resolved_at FROM review_comment
     WHERE id = ? AND video_id = ? AND draft_id = ?`,
  ).bind(parentId, videoId, draftId).first<{ parent_id: string | null; resolved_at: number | null }>()
  if (!parent || parent.parent_id || parent.resolved_at) throw new ReviewError(400, 'Reply parent is invalid.')
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
  await requireParent(input.videoId, input.draftId, input.parentId)
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
           id, video_id, draft_id, author_user_id, parent_id, anchor_kind, start_ms, end_ms,
           body_json, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        id, input.videoId, input.draftId, userId, input.parentId, validAnchor.kind, startMs, endMs,
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

export async function resolveComment(videoId: string, id: string, expectedRevision: number): Promise<ReviewComment> {
  const draftId = await commentDraft(videoId, id)
  if (!draftId) throw new ReviewError(404, 'Comment not found.')
  const result = await bindings.DB.prepare(
    `UPDATE review_comment SET resolved_at = ?, revision = revision + 1, updated_at = ?
     WHERE id = ? AND video_id = ? AND revision = ? AND parent_id IS NULL AND resolved_at IS NULL`,
  ).bind(Date.now(), Date.now(), id, videoId, expectedRevision).run()
  if (result.meta.changes !== 1) throw new ReviewError(409, 'This comment changed in another session.')
  const updated = (await listComments(videoId, draftId)).find((entry) => entry.id === id)
  if (!updated) throw new ReviewError(500, 'Comment could not be loaded.')
  return updated
}

function shareToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createDraftShare(videoId: string, draftId: string, userId: string): Promise<string> {
  await draftDuration(videoId, draftId)
  await bindings.DB.prepare(
    `INSERT OR IGNORE INTO draft_review_share (draft_id, video_id, token, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(draftId, videoId, shareToken(), userId, Date.now()).run()
  const share = await bindings.DB.prepare(
    'SELECT token FROM draft_review_share WHERE draft_id = ? AND video_id = ?',
  ).bind(draftId, videoId).first<{ token: string }>()
  if (!share) throw new ReviewError(404, 'Draft not found.')
  return share.token
}

export async function revokeDraftShare(videoId: string, draftId: string): Promise<void> {
  await bindings.DB.prepare(
    'DELETE FROM draft_review_share WHERE draft_id = ? AND video_id = ?',
  ).bind(draftId, videoId).run()
}

const SHARED_DRAFT_SQL = `
  SELECT d.id, d.video_id, d.version, d.duration_ms, d.created_at,
         d.stream_uid, d.stream_state,
         f.id AS file_id, f.display_name, f.byte_size, f.content_type,
         f.created_at AS file_created_at, f.updated_at AS file_updated_at,
         f.object_key,
         x.state AS derivative_state, x.byte_size AS derivative_byte_size,
         u.id AS user_id, u.name AS user_name, u.email AS user_email,
         s.token AS share_token, v.title AS video_title
  FROM draft_review_share s
  JOIN draft d ON d.id = s.draft_id AND d.video_id = s.video_id
  JOIN video v ON v.id = d.video_id
  JOIN media_file f ON f.id = d.media_file_id AND f.video_id = d.video_id AND f.purpose = 'draft'
  JOIN user u ON u.id = d.created_by_user_id
  LEFT JOIN media_derivative x ON x.source_media_file_id = f.id AND x.profile = 'compact-mp4-v1'
  WHERE s.token = ? AND v.${ACTIVE_VIDEO_SQL}`

type SharedDraftRow = DraftRow & { object_key: string; video_title: string }

export async function getSharedDraft(tokenValue: string): Promise<SharedDraftMedia | null> {
  let token: string
  try { token = parseShareToken(tokenValue) } catch { return null }
  const row = await bindings.DB.prepare(SHARED_DRAFT_SQL).bind(token).first<SharedDraftRow>()
  if (!row) return null
  return {
    draft: draft(row),
    videoTitle: row.video_title,
    stored: {
      object_key: row.object_key,
      display_name: row.display_name,
      byte_size: row.byte_size,
      content_type: row.content_type,
    },
  }
}

async function rateLimitGuest(token: string, ip: string): Promise<void> {
  const key = `${token}:${ip || 'local'}`
  const windowMs = 60_000
  const now = Date.now()
  const row = await bindings.DB.prepare(
    'SELECT window_started_at, hit_count FROM guest_review_rate WHERE key = ?',
  ).bind(key).first<{ window_started_at: number; hit_count: number }>()
  if (!row || now - row.window_started_at >= windowMs) {
    await bindings.DB.prepare(
      'INSERT OR REPLACE INTO guest_review_rate (key, window_started_at, hit_count) VALUES (?, ?, 1)',
    ).bind(key, now).run()
    return
  }
  if (row.hit_count >= 30) throw new ReviewError(429, 'Too many comments. Try again shortly.')
  await bindings.DB.prepare(
    'UPDATE guest_review_rate SET hit_count = hit_count + 1 WHERE key = ?',
  ).bind(key).run()
}

export async function createGuestComment(
  input: CreateGuestReviewComment,
  ip: string,
): Promise<ReviewComment> {
  const shared = await getSharedDraft(input.token)
  if (!shared) throw new ReviewError(404, 'This review link is no longer available.')
  await rateLimitGuest(input.token, ip)
  const create: CreateReviewComment = {
    clientRequestId: input.clientRequestId,
    videoId: shared.draft.videoId,
    draftId: shared.draft.id,
    parentId: input.parentId,
    anchor: input.anchor,
    body: plainTextDocument(input.text),
    attachmentIds: [],
  }
  const durationMs = await draftDuration(create.videoId, create.draftId)
  const validAnchor = parseReviewAnchor(create.anchor, durationMs)
  await requireParent(create.videoId, create.draftId, create.parentId)
  const existing = (await listComments(create.videoId, create.draftId)).find((entry) => entry.id === create.clientRequestId)
  if (existing) {
    if (
      existing.author.guest !== true
      || existing.author.email !== input.identity.email
      || existing.parentId !== create.parentId
      || JSON.stringify(existing.anchor) !== JSON.stringify(validAnchor)
      || JSON.stringify(existing.body) !== bodyJson(create.body)
    ) {
      throw new ReviewError(409, 'This comment request was already used for different content.')
    }
    return existing
  }
  const now = Date.now()
  const startMs = validAnchor.kind === 'point' ? validAnchor.atMs : validAnchor.startMs
  const endMs = validAnchor.kind === 'range' ? validAnchor.endMs : null
  try {
    await bindings.DB.prepare(
      `INSERT INTO review_comment (
         id, video_id, draft_id, author_user_id, guest_email, guest_name, parent_id,
         anchor_kind, start_ms, end_ms, body_json, revision, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(
      create.clientRequestId, create.videoId, create.draftId, input.identity.email, input.identity.name,
      create.parentId, validAnchor.kind, startMs, endMs, bodyJson(create.body), now, now,
    ).run()
  } catch (error) {
    const winner = (await listComments(create.videoId, create.draftId)).find((entry) => entry.id === create.clientRequestId)
    if (!winner) throw error
    return winner
  }
  const created = (await listComments(create.videoId, create.draftId)).find((entry) => entry.id === create.clientRequestId)
  if (!created) throw new ReviewError(500, 'Comment could not be loaded.')
  return created
}
