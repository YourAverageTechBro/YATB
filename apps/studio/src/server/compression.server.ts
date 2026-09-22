import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  COMPACT_MP4_PROFILE,
  derivativeId,
  derivativeObjectKey,
  supportsCompression,
  type CompressionJob,
  type MediaDerivativeState,
} from '#/domain/derivatives'

type CompressionBindings = Cloudflare.Env & {
  DB: D1Database
  MEDIA: R2Bucket
  VIDEO_COMPRESSION_QUEUE: Queue<CompressionJob>
  VIDEO_TRANSCODER: DurableObjectNamespace
}

type DerivativeRow = {
  id: string
  video_id: string
  source_media_file_id: string
  profile: string
  state: MediaDerivativeState
  object_key: string
  byte_size: number | null
  content_type: string | null
  object_etag: string | null
  attempts: number
  lease_until: number | null
  display_name: string
  source_byte_size: number
  source_content_type: string
  source_object_key: string
  duration_ms: number
}

const bindings = env as CompressionBindings
const MAX_ATTEMPTS = 4
const LEASE_MS = 20 * 60 * 1000

function job(row: Pick<DerivativeRow, 'id' | 'source_media_file_id'>): CompressionJob {
  return {
    derivativeId: row.id,
    sourceFileId: row.source_media_file_id,
    profile: COMPACT_MP4_PROFILE,
  }
}

async function derivativeRow(
  derivativeIdValue: string,
  envBindings: CompressionBindings,
): Promise<DerivativeRow | null> {
  return envBindings.DB.prepare(
    `SELECT x.*, f.display_name, f.byte_size AS source_byte_size,
            f.content_type AS source_content_type, f.object_key AS source_object_key,
            d.duration_ms
     FROM media_derivative x
     JOIN media_file f ON f.id = x.source_media_file_id AND f.video_id = x.video_id
     JOIN draft d ON d.media_file_id = f.id AND d.video_id = f.video_id
     WHERE x.id = ? AND x.profile = ?`,
  ).bind(derivativeIdValue, COMPACT_MP4_PROFILE).first<DerivativeRow>()
}

async function createDerivative(
  input: Readonly<{
    videoId: string
    sourceFileId: string
    byteSize: number
    contentType: string
    durationMs: number
  }>,
  envBindings: CompressionBindings,
): Promise<CompressionJob | null> {
  const supported = supportsCompression(input)
  const id = derivativeId(input.sourceFileId)
  const now = Date.now()
  await envBindings.DB.prepare(
    `INSERT OR IGNORE INTO media_derivative (
       id, video_id, source_media_file_id, profile, state, object_key,
       attempts, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).bind(
    id, input.videoId, input.sourceFileId, COMPACT_MP4_PROFILE,
    supported ? 'queued' : 'unsupported',
    derivativeObjectKey(input.videoId, input.sourceFileId), now, now,
  ).run()
  return supported ? { derivativeId: id, sourceFileId: input.sourceFileId, profile: COMPACT_MP4_PROFILE } : null
}

export async function ensureDraftDerivative(
  input: Readonly<{
    videoId: string
    sourceFileId: string
    byteSize: number
    contentType: string
    durationMs: number
  }>,
  envBindings: CompressionBindings = bindings,
): Promise<void> {
  const pending = await createDerivative(input, envBindings)
  if (pending) await envBindings.VIDEO_COMPRESSION_QUEUE.send(pending)
}

async function claim(row: DerivativeRow, envBindings: CompressionBindings): Promise<boolean> {
  if (!supportsCompression({
    byteSize: row.source_byte_size,
    contentType: row.source_content_type,
    durationMs: row.duration_ms,
  })) {
    await envBindings.DB.prepare(
      `UPDATE media_derivative SET state = 'unsupported', lease_until = NULL, last_error = NULL,
         updated_at = ? WHERE id = ? AND state != 'ready'`,
    ).bind(Date.now(), row.id).run()
    return false
  }
  const now = Date.now()
  const result = await envBindings.DB.prepare(
    `UPDATE media_derivative
     SET state = 'processing', attempts = attempts + 1, lease_until = ?, last_error = NULL, updated_at = ?
     WHERE id = ? AND attempts < ? AND (
       state IN ('queued', 'failed') OR (state = 'processing' AND lease_until <= ?)
     )`,
  ).bind(now + LEASE_MS, now, row.id, MAX_ATTEMPTS, now).run()
  return result.meta.changes === 1
}

async function mark(
  envBindings: CompressionBindings,
  id: string,
  state: 'not_beneficial' | 'failed',
  error: string | null,
): Promise<void> {
  await envBindings.DB.prepare(
    `UPDATE media_derivative SET state = ?, byte_size = NULL, content_type = NULL,
       object_etag = NULL, lease_until = NULL, last_error = ?, updated_at = ?
     WHERE id = ? AND state = 'processing'`,
  ).bind(state, error, Date.now(), id).run()
}

export async function processCompressionJob(
  message: CompressionJob,
  envBindings: CompressionBindings,
): Promise<'done' | 'ignored' | 'retry'> {
  if (message.profile !== COMPACT_MP4_PROFILE || message.derivativeId !== derivativeId(message.sourceFileId)) {
    return 'ignored'
  }
  let row = await derivativeRow(message.derivativeId, envBindings)
  if (!row || row.source_media_file_id !== message.sourceFileId || row.state === 'ready'
      || row.state === 'not_beneficial' || row.state === 'unsupported') return 'ignored'
  if (!(await claim(row, envBindings))) {
    const current = await derivativeRow(message.derivativeId, envBindings)
    return current?.state === 'processing' ? 'retry' : 'ignored'
  }
  row = await derivativeRow(message.derivativeId, envBindings)
  if (!row) return 'ignored'
  try {
    const source = await envBindings.MEDIA.get(row.source_object_key)
    if (!source) throw new Error('The original video object is missing.')
    const transcoder = envBindings.VIDEO_TRANSCODER.getByName('compact-mp4')
    const fixedLength = new FixedLengthStream(row.source_byte_size)
    const sourceTransfer = source.body.pipeTo(fixedLength.writable)
    const responsePromise = transcoder.fetch(new Request('http://container/transcode', {
      method: 'POST',
      headers: {
        'Content-Length': String(row.source_byte_size),
        'Content-Type': row.source_content_type,
      },
      body: fixedLength.readable,
    }))
    const [response] = await Promise.all([responsePromise, sourceTransfer])
    if (!response.ok || !response.body) {
      const detail = (await response.text()).slice(0, 400)
      throw new Error(`FFmpeg container returned ${response.status}${detail ? `: ${detail}` : '.'}`)
    }
    const outputSize = Number(response.headers.get('content-length'))
    if (!Number.isSafeInteger(outputSize) || outputSize < 1) {
      await response.body.cancel()
      throw new Error('FFmpeg container returned an invalid output size.')
    }
    if (outputSize >= row.source_byte_size) {
      await response.body.cancel()
      await mark(envBindings, row.id, 'not_beneficial', null)
      return 'done'
    }
    const fixedOutput = new FixedLengthStream(outputSize)
    const outputTransfer = response.body.pipeTo(fixedOutput.writable)
    const outputPromise = envBindings.MEDIA.put(row.object_key, fixedOutput.readable, {
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: {
        sourceFileId: row.source_media_file_id,
        profile: COMPACT_MP4_PROFILE,
      },
    })
    const [output] = await Promise.all([outputPromise, outputTransfer])
    const updated = await envBindings.DB.prepare(
      `UPDATE media_derivative SET state = 'ready', byte_size = ?, content_type = 'video/mp4',
         object_etag = ?, lease_until = NULL, last_error = NULL, updated_at = ?
       WHERE id = ? AND state = 'processing'`,
    ).bind(outputSize, output.httpEtag, Date.now(), row.id).run()
    if (updated.meta.changes !== 1) await envBindings.MEDIA.delete(row.object_key)
    return 'done'
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : 'Unknown compression failure.'
    await mark(envBindings, row.id, 'failed', detail)
    throw error
  }
}

export async function consumeCompressionQueue(
  batch: MessageBatch<unknown>,
  envBindings: CompressionBindings,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body
    if (!body || typeof body !== 'object'
        || typeof (body as CompressionJob).derivativeId !== 'string'
        || typeof (body as CompressionJob).sourceFileId !== 'string'
        || (body as CompressionJob).profile !== COMPACT_MP4_PROFILE) {
      message.ack()
      continue
    }
    const compressionJob = body as CompressionJob
    try {
      const result = await processCompressionJob(compressionJob, envBindings)
      if (result === 'retry') message.retry({ delaySeconds: 60 })
      else message.ack()
    } catch {
      const row = await derivativeRow(compressionJob.derivativeId, envBindings)
      if (!row || row.attempts >= MAX_ATTEMPTS) message.ack()
      else message.retry({ delaySeconds: Math.min(900, 30 * 2 ** row.attempts) })
    }
  }
}

export async function reconcileDerivatives(envBindings: CompressionBindings): Promise<number> {
  const missing = await envBindings.DB.prepare(
    `SELECT f.video_id, f.id AS source_media_file_id, f.byte_size, f.content_type, d.duration_ms
     FROM draft d JOIN media_file f ON f.id = d.media_file_id AND f.video_id = d.video_id
     LEFT JOIN media_derivative x ON x.source_media_file_id = f.id AND x.profile = ?
     WHERE x.id IS NULL LIMIT 50`,
  ).bind(COMPACT_MP4_PROFILE).all<{
    video_id: string
    source_media_file_id: string
    byte_size: number
    content_type: string
    duration_ms: number
  }>()
  for (const row of missing.results) {
    await createDerivative({
      videoId: row.video_id,
      sourceFileId: row.source_media_file_id,
      byteSize: row.byte_size,
      contentType: row.content_type,
      durationMs: row.duration_ms,
    }, envBindings)
  }
  const now = Date.now()
  const pending = await envBindings.DB.prepare(
    `SELECT id, source_media_file_id FROM media_derivative
     WHERE profile = ? AND attempts < ? AND (
       state = 'queued' OR state = 'failed' OR (state = 'processing' AND lease_until <= ?)
     ) ORDER BY updated_at ASC LIMIT 50`,
  ).bind(COMPACT_MP4_PROFILE, MAX_ATTEMPTS, now).all<Pick<DerivativeRow, 'id' | 'source_media_file_id'>>()
  for (const row of pending.results) await envBindings.VIDEO_COMPRESSION_QUEUE.send(job(row))
  return pending.results.length
}

export type StoredDerivative = Readonly<{
  state: MediaDerivativeState
  objectKey: string
  byteSize: number | null
  contentType: string | null
  objectEtag: string | null
  sourceDisplayName: string
}>

export async function getStoredDerivative(
  videoId: string,
  sourceFileId: string,
  envBindings: Pick<CompressionBindings, 'DB'> = bindings,
): Promise<StoredDerivative | null> {
  const row = await envBindings.DB.prepare(
    `SELECT x.state, x.object_key, x.byte_size, x.content_type, x.object_etag,
            f.display_name AS source_display_name
     FROM media_derivative x
     JOIN media_file f ON f.id = x.source_media_file_id AND f.video_id = x.video_id
     JOIN video v ON v.id = x.video_id
     WHERE x.video_id = ? AND x.source_media_file_id = ? AND x.profile = ?
       AND v.deleted_at IS NULL`,
  ).bind(videoId, sourceFileId, COMPACT_MP4_PROFILE).first<{
    state: MediaDerivativeState
    object_key: string
    byte_size: number | null
    content_type: string | null
    object_etag: string | null
    source_display_name: string
  }>()
  return row && {
    state: row.state,
    objectKey: row.object_key,
    byteSize: row.byte_size,
    contentType: row.content_type,
    objectEtag: row.object_etag,
    sourceDisplayName: row.source_display_name,
  }
}
