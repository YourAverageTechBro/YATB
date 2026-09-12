import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  cleanupDelay,
  expectedPartBytes,
  partCount,
  sameUpload,
  UPLOAD_PART_SIZE,
  type BeginUpload,
  type MediaPurpose,
  type MediaFile,
  type ReadyUpload,
  type UploadSnapshot,
  type UploadState,
} from '#/domain/media'
import type { Draft, ReviewAuthor } from '#/domain/reviews'
import { ACTIVE_VIDEO_SQL } from './video-sql'

type Bindings = Cloudflare.Env & { DB: D1Database; MEDIA: R2Bucket }
const bindings = env as Bindings

export class MediaError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

type UploadRow = {
  id: string
  video_id: string
  created_by_user_id: string
  client_request_id: string
  file_id: string
  object_key: string
  r2_upload_id: string | null
  initializer_token: string | null
  initializer_lease_until: number | null
  display_name: string
  byte_size: number
  content_type: string
  purpose: MediaPurpose
  draft_id: string | null
  draft_duration_ms: number | null
  part_size: number
  part_count: number
  state: UploadState
  object_etag: string | null
  created_at: number
  updated_at: number
}

type FileRow = {
  id: string
  video_id: string
  display_name: string
  byte_size: number
  content_type: string
  purpose: MediaPurpose
  created_at: number
  updated_at: number
}

type StoredFileRow = FileRow & { object_key: string; object_etag: string }

type DraftRow = {
  id: string
  video_id: string
  version: number
  duration_ms: number
  created_at: number
  user_id: string
  user_name: string
  user_email: string
}

function publicFile(row: FileRow): MediaFile {
  return {
    id: row.id,
    videoId: row.video_id,
    purpose: row.purpose,
    displayName: row.display_name,
    byteSize: row.byte_size,
    contentType: row.content_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function activeVideoExists(videoId: string): Promise<boolean> {
  return (await bindings.DB.prepare(
    `SELECT 1 AS present FROM video WHERE id = ? AND ${ACTIVE_VIDEO_SQL}`,
  ).bind(videoId).first()) !== null
}

async function uploadRow(id: string, videoId: string): Promise<UploadRow | null> {
  return bindings.DB.prepare(
    `SELECT * FROM upload_session WHERE id = ? AND video_id = ?`,
  ).bind(id, videoId).first<UploadRow>()
}

async function uploadByRequest(input: BeginUpload, userId: string): Promise<UploadRow | null> {
  return bindings.DB.prepare(
    `SELECT * FROM upload_session
     WHERE video_id = ? AND created_by_user_id = ? AND client_request_id = ?`,
  ).bind(input.videoId, userId, input.clientRequestId).first<UploadRow>()
}

async function parts(id: string): Promise<Array<{ part_number: number; byte_size: number; etag: string }>> {
  const result = await bindings.DB.prepare(
    `SELECT part_number, byte_size, etag FROM upload_part
     WHERE upload_session_id = ? ORDER BY part_number ASC`,
  ).bind(id).all<{ part_number: number; byte_size: number; etag: string }>()
  return result.results
}

async function storedFile(fileId: string, videoId: string): Promise<StoredFileRow | null> {
  return bindings.DB.prepare(
    `SELECT f.id, f.video_id, f.display_name, f.byte_size, f.content_type, f.purpose,
            f.object_key, f.object_etag, f.created_at, f.updated_at
     FROM media_file f JOIN video v ON v.id = f.video_id
     WHERE f.id = ? AND f.video_id = ? AND v.${ACTIVE_VIDEO_SQL}`,
  ).bind(fileId, videoId).first<StoredFileRow>()
}

function publicAuthor(row: DraftRow): ReviewAuthor {
  return { id: row.user_id, name: row.user_name, email: row.user_email }
}

async function storedDraft(fileId: string, videoId: string, file: MediaFile): Promise<Draft | null> {
  const row = await bindings.DB.prepare(
    `SELECT d.id, d.video_id, d.version, d.duration_ms, d.created_at,
            u.id AS user_id, u.name AS user_name, u.email AS user_email
     FROM draft d JOIN user u ON u.id = d.created_by_user_id
     WHERE d.media_file_id = ? AND d.video_id = ?`,
  ).bind(fileId, videoId).first<DraftRow>()
  return row && {
    id: row.id,
    videoId: row.video_id,
    version: row.version,
    durationMs: row.duration_ms,
    file,
    author: publicAuthor(row),
    createdAt: row.created_at,
  }
}

function uploadPurpose(row: UploadRow): BeginUpload['purpose'] {
  if (row.purpose === 'footage') return { kind: 'footage' }
  if (row.draft_duration_ms === null) throw new MediaError(500, 'Draft duration is missing.')
  return { kind: 'draft', durationMs: row.draft_duration_ms }
}

async function snapshot(row: UploadRow): Promise<UploadSnapshot> {
  const [receipts, stored] = await Promise.all([
    parts(row.id),
    row.state === 'ready' ? storedFile(row.file_id, row.video_id) : Promise.resolve(null),
  ])
  let result: ReadyUpload | null = null
  if (stored) {
    const file = publicFile(stored)
    if (row.purpose === 'footage') result = { kind: 'footage', file }
    else {
      const draft = await storedDraft(row.file_id, row.video_id, file)
      if (!draft) throw new MediaError(500, 'Draft publication is incomplete.')
      result = { kind: 'draft', file, draft }
    }
  }
  const base = {
    id: row.id,
    fileId: row.file_id,
    videoId: row.video_id,
    displayName: row.display_name,
    byteSize: row.byte_size,
    contentType: row.content_type,
    purpose: uploadPurpose(row),
    partSize: row.part_size,
    partCount: row.part_count,
    uploadedParts: receipts.map((part) => part.part_number),
    state: row.state,
  }
  if (row.state === 'ready') {
    if (!result) throw new MediaError(500, 'Upload publication is incomplete.')
    return { ...base, state: 'ready', result }
  }
  return { ...base, state: row.state, result: null }
}

function matchesInput(row: UploadRow, input: BeginUpload): boolean {
  return sameUpload(input, {
    clientRequestId: row.client_request_id,
    displayName: row.display_name,
    byteSize: row.byte_size,
    contentType: row.content_type,
    purpose: uploadPurpose(row),
  })
}

async function acquireInitializer(row: UploadRow, token: string): Promise<boolean> {
  if (row.initializer_token === token) return true
  if (row.state !== 'initializing' || (row.initializer_lease_until ?? 0) > Date.now()) return false
  const result = await bindings.DB.prepare(
    `UPDATE upload_session SET initializer_token = ?, initializer_lease_until = ?, updated_at = ?
     WHERE id = ? AND state = 'initializing' AND initializer_lease_until <= ?`,
  ).bind(token, Date.now() + 30_000, Date.now(), row.id, Date.now()).run()
  return result.meta.changes === 1
}

async function initializeUpload(row: UploadRow, token: string): Promise<UploadRow> {
  if (!(await acquireInitializer(row, token))) return row
  const upload = await bindings.MEDIA.createMultipartUpload(row.object_key, {
    httpMetadata: { contentType: row.content_type },
    customMetadata: { uploadSession: row.id, expectedSize: String(row.byte_size) },
  })
  const result = await bindings.DB.prepare(
    `UPDATE upload_session SET r2_upload_id = ?, state = 'uploading', initializer_token = NULL,
       initializer_lease_until = NULL, updated_at = ?
     WHERE id = ? AND state = 'initializing' AND initializer_token = ?`,
  ).bind(upload.uploadId, Date.now(), row.id, token).run()
  if (result.meta.changes !== 1) {
    await upload.abort().catch(() => undefined)
  }
  const current = await uploadRow(row.id, row.video_id)
  if (!current) throw new MediaError(404, 'Upload not found.')
  return current
}

export async function beginUpload(input: BeginUpload, userId: string): Promise<UploadSnapshot> {
  if (!(await activeVideoExists(input.videoId))) throw new MediaError(404, 'Video not found.')
  const now = Date.now()
  const id = crypto.randomUUID()
  const fileId = crypto.randomUUID()
  const token = crypto.randomUUID()
  await bindings.DB.prepare(
    `INSERT OR IGNORE INTO upload_session (
       id, video_id, created_by_user_id, client_request_id, file_id, object_key,
       initializer_token, initializer_lease_until, display_name, byte_size, content_type,
       purpose, draft_id, draft_duration_ms,
       part_size, part_count, state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initializing', ?, ?)`,
  ).bind(
    id, input.videoId, userId, input.clientRequestId, fileId,
    `videos/${input.videoId}/${input.purpose.kind === 'draft' ? 'drafts' : 'footage'}/${fileId}`,
    token, now + 30_000, input.displayName, input.byteSize, input.contentType,
    input.purpose.kind, input.purpose.kind === 'draft' ? crypto.randomUUID() : null,
    input.purpose.kind === 'draft' ? input.purpose.durationMs : null, UPLOAD_PART_SIZE,
    partCount(input.byteSize), now, now,
  ).run()
  let row = await uploadByRequest(input, userId)
  if (!row) throw new MediaError(500, 'Upload session could not be created.')
  if (!matchesInput(row, input)) throw new MediaError(409, 'This upload request was already used for another file.')
  row = await initializeUpload(row, token)
  return snapshot(row)
}

export async function getUpload(videoId: string, id: string): Promise<UploadSnapshot> {
  if (!(await activeVideoExists(videoId))) throw new MediaError(404, 'Video not found.')
  const row = await uploadRow(id, videoId)
  if (!row) throw new MediaError(404, 'Upload not found.')
  if (row.state === 'initializing' && (row.initializer_lease_until ?? 0) <= Date.now()) {
    return snapshot(await initializeUpload(row, crypto.randomUUID()))
  }
  return snapshot(row)
}

export async function uploadPart(
  videoId: string,
  id: string,
  partNumber: number,
  contentLength: number,
  body: ReadableStream,
): Promise<{ partNumber: number; acceptedBytes: number }> {
  const row = await uploadRow(id, videoId)
  if (!row || !(await activeVideoExists(videoId))) throw new MediaError(404, 'Upload not found.')
  if (row.state !== 'uploading' || !row.r2_upload_id) throw new MediaError(409, 'Upload is not accepting parts.')
  const expected = expectedPartBytes(row.byte_size, partNumber)
  if (contentLength !== expected) throw new MediaError(400, `Part must contain exactly ${expected} bytes.`)
  const uploaded = await bindings.MEDIA.resumeMultipartUpload(row.object_key, row.r2_upload_id)
    .uploadPart(partNumber, body)
  const current = await uploadRow(id, videoId)
  if (!current || current.state !== 'uploading') throw new MediaError(409, 'Upload state changed while the part was sent.')
  await bindings.DB.prepare(
    `INSERT INTO upload_part (upload_session_id, part_number, byte_size, etag, uploaded_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(upload_session_id, part_number) DO UPDATE SET
       byte_size = excluded.byte_size, etag = excluded.etag, uploaded_at = excluded.uploaded_at`,
  ).bind(id, uploaded.partNumber, expected, uploaded.etag, Date.now()).run()
  return { partNumber: uploaded.partNumber, acceptedBytes: expected }
}

function objectMatches(row: UploadRow, object: R2Object | null): object is R2Object {
  return object !== null
    && object.size === row.byte_size
    && object.customMetadata?.uploadSession === row.id
    && object.customMetadata?.expectedSize === String(row.byte_size)
}

function mediaInsert(row: UploadRow, object: R2Object, now: number): D1PreparedStatement {
  return bindings.DB.prepare(
    `INSERT OR IGNORE INTO media_file (
       id, video_id, created_by_user_id, upload_session_id, object_key, display_name,
       byte_size, content_type, object_etag, purpose, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    row.file_id, row.video_id, row.created_by_user_id, row.id, row.object_key,
    row.display_name, row.byte_size, row.content_type, object.etag, row.purpose, now, now,
  )
}

function readyUpdate(row: UploadRow, object: R2Object, now: number): D1PreparedStatement {
  return bindings.DB.prepare(
    `UPDATE upload_session SET state = 'ready', object_etag = ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND state IN ('completing', 'ready')`,
  ).bind(object.etag, now, now, row.id)
}

function draftVersionConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: draft\.video_id, draft\.version/.test(error.message)
}

async function publish(row: UploadRow, object: R2Object): Promise<UploadSnapshot> {
  const now = Date.now()
  if (row.purpose === 'footage') {
    await bindings.DB.batch([mediaInsert(row, object, now), readyUpdate(row, object, now)])
  } else {
    if (!row.draft_id || row.draft_duration_ms === null) throw new MediaError(500, 'Draft publication data is missing.')
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await bindings.DB.prepare(
        'SELECT id FROM draft WHERE media_file_id = ? AND video_id = ?',
      ).bind(row.file_id, row.video_id).first<{ id: string }>()
      if (existing) {
        await readyUpdate(row, object, now).run()
        break
      }
      try {
        await bindings.DB.batch([
          mediaInsert(row, object, now),
          bindings.DB.prepare(
            `INSERT INTO draft (
               id, video_id, media_file_id, version, duration_ms, created_by_user_id, created_at
             ) SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?
               FROM draft WHERE video_id = ?`,
          ).bind(
            row.draft_id, row.video_id, row.file_id, row.draft_duration_ms,
            row.created_by_user_id, now, row.video_id,
          ),
          readyUpdate(row, object, now),
        ])
        break
      } catch (error) {
        const winner = await bindings.DB.prepare(
          'SELECT id FROM draft WHERE media_file_id = ? AND video_id = ?',
        ).bind(row.file_id, row.video_id).first<{ id: string }>()
        if (winner) {
          await readyUpdate(row, object, now).run()
          break
        }
        if (!draftVersionConflict(error) || attempt === 7) throw error
      }
    }
  }
  const ready = await uploadRow(row.id, row.video_id)
  if (!ready || ready.state !== 'ready') throw new MediaError(500, 'File publication did not finish.')
  return snapshot(ready)
}

async function reconcileCompletion(row: UploadRow): Promise<UploadSnapshot | null> {
  const object = await bindings.MEDIA.head(row.object_key)
  return objectMatches(row, object) ? publish(row, object) : null
}

export async function completeUpload(videoId: string, id: string): Promise<UploadSnapshot> {
  let row = await uploadRow(id, videoId)
  if (!row || !(await activeVideoExists(videoId))) throw new MediaError(404, 'Upload not found.')
  if (row.state === 'ready') return snapshot(row)
  if (row.state === 'cancelled' || row.state === 'cancelling') throw new MediaError(409, 'Upload was cancelled.')
  if (row.state === 'initializing') throw new MediaError(409, 'Upload is still initializing.')
  if (row.state === 'completing') {
    const recovered = await reconcileCompletion(row)
    if (recovered) return recovered
    if (row.updated_at > Date.now() - 10_000) return snapshot(row)
  }
  const claimBefore = Date.now()
  const result = await bindings.DB.prepare(
    `UPDATE upload_session SET state = 'completing', updated_at = ?
     WHERE id = ? AND (state = 'uploading' OR (state = 'completing' AND updated_at <= ?))
       AND part_count = (SELECT COUNT(*) FROM upload_part WHERE upload_session_id = ?)
       AND byte_size = (SELECT COALESCE(SUM(byte_size), 0) FROM upload_part WHERE upload_session_id = ?)`,
  ).bind(claimBefore, id, claimBefore - 10_000, id, id).run()
  if (result.meta.changes !== 1) throw new MediaError(409, 'Upload has missing parts.')
  row = await uploadRow(id, videoId)
  if (!row || !row.r2_upload_id) throw new MediaError(409, 'Upload is not ready to complete.')
  const receipts = await parts(id)
  try {
    const object = await bindings.MEDIA.resumeMultipartUpload(row.object_key, row.r2_upload_id)
      .complete(receipts.map((part) => ({ partNumber: part.part_number, etag: part.etag })))
    return publish(row, object)
  } catch (error) {
    const recovered = await reconcileCompletion(row)
    if (recovered) return recovered
    await bindings.DB.prepare(
      `UPDATE upload_session SET state = 'uploading', updated_at = ? WHERE id = ? AND state = 'completing'`,
    ).bind(Date.now(), id).run()
    throw error
  }
}

export async function cancelUpload(videoId: string, id: string): Promise<UploadSnapshot> {
  let row = await uploadRow(id, videoId)
  if (!row || !(await activeVideoExists(videoId))) throw new MediaError(404, 'Upload not found.')
  if (row.state === 'ready') return snapshot(row)
  if (row.state === 'cancelled') return snapshot(row)
  if (row.state === 'completing') {
    const recovered = await reconcileCompletion(row)
    if (recovered) return recovered
    throw new MediaError(409, 'Upload is completing and cannot be cancelled.')
  }
  await bindings.DB.prepare(
    `UPDATE upload_session SET state = 'cancelling', updated_at = ?
     WHERE id = ? AND state IN ('initializing', 'uploading', 'cancelling')`,
  ).bind(Date.now(), id).run()
  row = await uploadRow(id, videoId)
  if (!row) throw new MediaError(404, 'Upload not found.')
  if (row.r2_upload_id) {
    try {
      await bindings.MEDIA.resumeMultipartUpload(row.object_key, row.r2_upload_id).abort()
    } catch (error) {
      const object = await bindings.MEDIA.head(row.object_key)
      if (objectMatches(row, object)) return publish(row, object)
      if (!isNoSuchUpload(error)) throw error
    }
  }
  const ready = await uploadRow(id, videoId)
  if (ready?.state === 'ready') return snapshot(ready)
  const now = Date.now()
  await bindings.DB.batch([
    bindings.DB.prepare('DELETE FROM upload_part WHERE upload_session_id = ?').bind(id),
    bindings.DB.prepare(
      `UPDATE upload_session SET state = 'cancelled', cancelled_at = ?, updated_at = ?
       WHERE id = ? AND state = 'cancelling'`,
    ).bind(now, now, id),
  ])
  const cancelled = await uploadRow(id, videoId)
  if (!cancelled) throw new MediaError(404, 'Upload not found.')
  return snapshot(cancelled)
}

export async function listMedia(videoId: string): Promise<MediaFile[]> {
  if (!(await activeVideoExists(videoId))) throw new MediaError(404, 'Video not found.')
  const result = await bindings.DB.prepare(
    `SELECT id, video_id, display_name, byte_size, content_type, purpose, created_at, updated_at
     FROM media_file WHERE video_id = ? AND purpose = 'footage' ORDER BY created_at DESC, id ASC`,
  ).bind(videoId).all<FileRow>()
  return result.results.map(publicFile)
}

export async function renameMedia(videoId: string, fileId: string, displayName: string): Promise<MediaFile> {
  const result = await bindings.DB.prepare(
    `UPDATE media_file SET display_name = ?, updated_at = ? WHERE id = ? AND video_id = ? AND purpose = 'footage'
       AND EXISTS (SELECT 1 FROM video WHERE id = ? AND ${ACTIVE_VIDEO_SQL})`,
  ).bind(displayName, Date.now(), fileId, videoId, videoId).run()
  if (result.meta.changes !== 1) throw new MediaError(404, 'File not found.')
  const file = await storedFile(fileId, videoId)
  if (!file) throw new MediaError(404, 'File not found.')
  return publicFile(file)
}

export async function getStoredMedia(videoId: string, fileId: string): Promise<StoredFileRow> {
  const file = await storedFile(fileId, videoId)
  if (!file) throw new MediaError(404, 'File not found.')
  return file
}

function isNoSuchUpload(error: unknown): boolean {
  return error instanceof Error && /(?:NoSuchUpload|10024)/.test(error.message)
}

export async function cleanupTombstonedVideos(envBindings: Bindings, now = Date.now()): Promise<number> {
  const due = await envBindings.DB.prepare(
    `SELECT id, cleanup_attempts FROM video
     WHERE deleted_at IS NOT NULL AND COALESCE(cleanup_after, 0) <= ?
     ORDER BY deleted_at ASC LIMIT 20`,
  ).bind(now).all<{ id: string; cleanup_attempts: number }>()
  let cleaned = 0
  for (const video of due.results) {
    try {
      const uploads = await envBindings.DB.prepare(
        `SELECT id, object_key, r2_upload_id, state FROM upload_session WHERE video_id = ?`,
      ).bind(video.id).all<{ id: string; object_key: string; r2_upload_id: string | null; state: UploadState }>()
      for (const upload of uploads.results) {
        if (upload.r2_upload_id && upload.state !== 'ready' && upload.state !== 'cancelled') {
          try {
            await envBindings.MEDIA.resumeMultipartUpload(upload.object_key, upload.r2_upload_id).abort()
          } catch (error) {
            if (!isNoSuchUpload(error)) throw error
          }
        }
      }
      const files = await envBindings.DB.prepare(
        'SELECT object_key FROM media_file WHERE video_id = ?',
      ).bind(video.id).all<{ object_key: string }>()
      for (let index = 0; index < files.results.length; index += 1000) {
        await envBindings.MEDIA.delete(files.results.slice(index, index + 1000).map((file) => file.object_key))
      }
      await envBindings.DB.prepare('DELETE FROM video WHERE id = ? AND deleted_at IS NOT NULL').bind(video.id).run()
      cleaned += 1
    } catch (error) {
      const attempt = video.cleanup_attempts + 1
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown cleanup failure'
      await envBindings.DB.prepare(
        `UPDATE video SET cleanup_attempts = ?, cleanup_after = ?, cleanup_error = ? WHERE id = ?`,
      ).bind(attempt, now + cleanupDelay(attempt), message, video.id).run()
    }
  }
  return cleaned
}
