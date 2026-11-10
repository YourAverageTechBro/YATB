import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  expectedPartBytes,
  parseContentType,
  parseDisplayName,
  parseMediaId,
  parsePartNumber,
  parseSingleByteRange,
  partCount,
  UPLOAD_PART_SIZE,
} from '#/domain/media'
import {
  parsePostId,
  parsePostItemId,
  postObjectKey,
  rejectPostUpload,
} from '#/domain/posts'
import { PRIVATE_NO_STORE, requireStudioMutationOrigin, requireStudioSession } from './auth.server'
import { MediaError } from './media.server'
import { attachPostMedia, getPostDraft } from './posts.server'

const bindings = env as Cloudflare.Env & { DB: D1Database; MEDIA: R2Bucket }

type UploadRow = {
  id: string
  draft_id: string
  post_id: string
  media_id: string
  object_key: string
  r2_upload_id: string | null
  initializer_token: string | null
  initializer_lease_until: number | null
  display_name: string
  byte_size: number
  content_type: string
  duration_ms: number | null
  part_size: number
  part_count: number
  state: string
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': PRIVATE_NO_STORE } })
}

function errorResponse(error: unknown): Response {
  if (error instanceof Response) return error
  if (error instanceof MediaError) return json({ error: error.message }, error.status)
  if (error instanceof Error && /(?:required|invalid|between|supported|smaller|shorter|duration)/i.test(error.message)) {
    return json({ error: error.message }, 400)
  }
  console.error('Post media request failed', error)
  return json({ error: 'Media operation failed.' }, 500)
}

async function run(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action()
  } catch (error) {
    return errorResponse(error)
  }
}

async function mutation() {
  const session = await requireStudioSession()
  requireStudioMutationOrigin()
  return session
}

function snapshot(row: UploadRow, uploadedParts: number[] = []) {
  return {
    id: row.id,
    fileId: row.media_id,
    draftId: row.draft_id,
    postId: row.post_id,
    displayName: row.display_name,
    byteSize: row.byte_size,
    contentType: row.content_type,
    partSize: row.part_size,
    partCount: row.part_count,
    uploadedParts,
    state: row.state,
  }
}

async function uploadRow(id: string, draftId: string): Promise<UploadRow | null> {
  return bindings.DB.prepare('SELECT * FROM post_upload WHERE id = ? AND draft_id = ?').bind(id, draftId).first<UploadRow>()
}

async function initialize(row: UploadRow, token: string): Promise<UploadRow> {
  if (row.initializer_token !== token) {
    if (row.state !== 'initializing' || (row.initializer_lease_until ?? 0) > Date.now()) return row
    const claimed = await bindings.DB.prepare(`
      UPDATE post_upload SET initializer_token = ?, initializer_lease_until = ?, updated_at = ?
      WHERE id = ? AND state = 'initializing' AND initializer_lease_until <= ?
    `).bind(token, Date.now() + 30_000, Date.now(), row.id, Date.now()).run()
    if (claimed.meta.changes !== 1) return row
  }
  const upload = await bindings.MEDIA.createMultipartUpload(row.object_key, {
    httpMetadata: { contentType: row.content_type },
    customMetadata: { uploadSession: row.id, expectedSize: String(row.byte_size) },
  })
  await bindings.DB.prepare(`
    UPDATE post_upload SET r2_upload_id = ?, state = 'uploading', initializer_token = NULL,
      initializer_lease_until = NULL, updated_at = ?
    WHERE id = ? AND state = 'initializing' AND initializer_token = ?
  `).bind(upload.uploadId, Date.now(), row.id, token).run()
  const current = await uploadRow(row.id, row.draft_id)
  if (!current) throw new MediaError(404, 'Upload not found.')
  return current
}

export function handlePostUploadCollection(request: Request, draftIdValue: string): Promise<Response> {
  return run(async () => {
    const session = await mutation()
    const draftId = parsePostId(draftIdValue)
    const body = await request.json() as Record<string, unknown>
    const postId = parsePostItemId(body.postId)
    const draft = await getPostDraft(draftId)
    if (!draft) throw new MediaError(404, 'Draft not found.')
    if (draft.status === 'posted') throw new MediaError(409, 'Posted drafts are read-only.')
    if (!draft.items.some((item) => item.id === postId)) throw new MediaError(404, 'Post not found.')
    const contentType = parseContentType(body.contentType)
    const byteSize = typeof body.byteSize === 'number' ? body.byteSize : 0
    const durationMs = typeof body.durationMs === 'number' ? body.durationMs : null
    const rejected = rejectPostUpload({ target: draft.target, mime: contentType, byteSize, durationMs })
    if (rejected) throw new MediaError(400, rejected)
    const now = Date.now()
    const id = crypto.randomUUID()
    const mediaId = crypto.randomUUID()
    const token = crypto.randomUUID()
    const clientRequestId = parseMediaId(body.clientRequestId)
    await bindings.DB.prepare(`
      INSERT OR IGNORE INTO post_upload (
        id, draft_id, post_id, created_by_user_id, client_request_id, media_id, object_key,
        initializer_token, initializer_lease_until, display_name, byte_size, content_type, duration_ms,
        part_size, part_count, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initializing', ?, ?)
    `).bind(
      id, draftId, postId, session.user.id, clientRequestId, mediaId, postObjectKey(draftId, mediaId),
      token, now + 30_000, parseDisplayName(body.displayName), byteSize, contentType, durationMs,
      UPLOAD_PART_SIZE, partCount(byteSize), now, now,
    ).run()
    const row = await bindings.DB.prepare(
      'SELECT * FROM post_upload WHERE draft_id = ? AND created_by_user_id = ? AND client_request_id = ?',
    ).bind(draftId, session.user.id, clientRequestId).first<UploadRow>()
    if (!row) throw new MediaError(500, 'Upload session could not be created.')
    const ready = await initialize(row, row.initializer_token ?? token)
    return json(snapshot(ready), ready.state === 'initializing' ? 202 : 201)
  })
}

export function handlePostUpload(request: Request, draftIdValue: string, uploadIdValue: string): Promise<Response> {
  return run(async () => {
    const draftId = parsePostId(draftIdValue)
    const uploadId = parseMediaId(uploadIdValue)
    if (request.method === 'GET') {
      await requireStudioSession()
      const row = await uploadRow(uploadId, draftId)
      if (!row) throw new MediaError(404, 'Upload not found.')
      if (row.state === 'initializing' && (row.initializer_lease_until ?? 0) <= Date.now()) {
        return json(snapshot(await initialize(row, crypto.randomUUID())))
      }
      const parts = await bindings.DB.prepare(
        'SELECT part_number FROM post_upload_part WHERE upload_id = ?',
      ).bind(uploadId).all<{ part_number: number }>()
      return json(snapshot(row, parts.results.map((part) => part.part_number)))
    }
    await mutation()
    const row = await uploadRow(uploadId, draftId)
    if (!row) throw new MediaError(404, 'Upload not found.')
    if (row.r2_upload_id) {
      await bindings.MEDIA.resumeMultipartUpload(row.object_key, row.r2_upload_id).abort().catch(() => undefined)
    }
    await bindings.DB.prepare(
      `UPDATE post_upload SET state = 'cancelled', updated_at = ? WHERE id = ? AND state != 'ready'`,
    ).bind(Date.now(), row.id).run()
    return json(snapshot({ ...row, state: 'cancelled' }))
  })
}

export function handlePostUploadPart(
  request: Request,
  draftIdValue: string,
  uploadIdValue: string,
  partNumberValue: string,
): Promise<Response> {
  return run(async () => {
    await mutation()
    const row = await uploadRow(parseMediaId(uploadIdValue), parsePostId(draftIdValue))
    if (!row || row.state !== 'uploading' || !row.r2_upload_id) throw new MediaError(409, 'Upload is not accepting parts.')
    const partNumber = parsePartNumber(partNumberValue)
    const expected = expectedPartBytes(row.byte_size, partNumber)
    const rawLength = request.headers.get('content-length')
    if (!rawLength || Number(rawLength) !== expected) throw new MediaError(400, `Part must contain exactly ${expected} bytes.`)
    if (!request.body) throw new MediaError(400, 'Part body is required.')
    const uploaded = await bindings.MEDIA.resumeMultipartUpload(row.object_key, row.r2_upload_id)
      .uploadPart(partNumber, request.body)
    await bindings.DB.prepare(`
      INSERT INTO post_upload_part (upload_id, part_number, byte_size, etag, uploaded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(upload_id, part_number) DO UPDATE SET
        byte_size = excluded.byte_size, etag = excluded.etag, uploaded_at = excluded.uploaded_at
    `).bind(row.id, uploaded.partNumber, expected, uploaded.etag, Date.now()).run()
    return json({ partNumber: uploaded.partNumber, acceptedBytes: expected })
  })
}

export function handlePostUploadComplete(draftIdValue: string, uploadIdValue: string): Promise<Response> {
  return run(async () => {
    await mutation()
    const draftId = parsePostId(draftIdValue)
    const row = await uploadRow(parseMediaId(uploadIdValue), draftId)
    if (!row) throw new MediaError(404, 'Upload not found.')
    if (row.state === 'ready') return json({ ...snapshot(row), result: { id: row.media_id } })
    if (row.state !== 'uploading' || !row.r2_upload_id) throw new MediaError(409, 'Upload is not ready to complete.')
    const receipts = await bindings.DB.prepare(
      'SELECT part_number, etag FROM post_upload_part WHERE upload_id = ? ORDER BY part_number ASC',
    ).bind(row.id).all<{ part_number: number; etag: string }>()
    const object = await bindings.MEDIA.resumeMultipartUpload(row.object_key, row.r2_upload_id)
      .complete(receipts.results.map((part) => ({ partNumber: part.part_number, etag: part.etag })))
    await bindings.DB.prepare(
      `UPDATE post_upload SET state = 'ready', object_etag = ?, updated_at = ? WHERE id = ?`,
    ).bind(object.etag, Date.now(), row.id).run()
    const draft = await attachPostMedia({
      draftId,
      postId: row.post_id,
      media: {
        id: row.media_id,
        objectKey: row.object_key,
        displayName: row.display_name,
        byteSize: row.byte_size,
        contentType: row.content_type,
        durationMs: row.duration_ms,
      },
    })
    if (!draft) throw new MediaError(404, 'Post not found.')
    const file = draft.items.flatMap((item) => item.media).find((item) => item.id === row.media_id)
    return json({ ...snapshot(row), state: 'ready', result: file ?? { id: row.media_id } })
  })
}

export function handlePostMediaRead(request: Request, draftIdValue: string, mediaIdValue: string): Promise<Response> {
  return run(async () => {
    await requireStudioSession()
    const draft = await getPostDraft(parsePostId(draftIdValue))
    if (!draft) throw new MediaError(404, 'Draft not found.')
    const file = draft.items.flatMap((item) => item.media).find((item) => item.id === parsePostId(mediaIdValue))
    if (!file) throw new MediaError(404, 'File not found.')
    const object = await bindings.MEDIA.get(file.objectKey, (() => {
      const range = parseSingleByteRange(request.headers.get('range'), file.byteSize)
      return range ? { range } : undefined
    })())
    if (!object) throw new MediaError(404, 'File not found.')
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': PRIVATE_NO_STORE,
      'Content-Type': file.mime,
      'Content-Length': String(object.size),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    return new Response(object.body, { status: request.headers.get('range') ? 206 : 200, headers })
  })
}
