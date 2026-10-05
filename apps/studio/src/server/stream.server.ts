import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import { parseMediaId } from '#/domain/media'
import type { Draft } from '#/domain/reviews'
import {
  STREAM_INGEST_TTL_MS,
  emptyDraftStream,
  ingestMac,
  parseDraftStreamState,
  parseStreamWebhook,
  signedManifestUrl,
  signedThumbnailUrl,
  streamFits,
  streamHlsUrl,
  streamTokenValue,
  streamVideoId,
  type DraftStream,
  type DraftStreamState,
  verifyIngestMac,
  verifyWebhookSignature,
} from '#/domain/stream'
import { ACTIVE_VIDEO_SQL } from './video-sql'

type StreamStatusInput = {
  id?: string
  uid?: string
  readyToStream?: boolean
  status?: { state?: string; errorReasonText?: string; errReasonText?: string }
}

type StreamBindings = Cloudflare.Env & {
  STREAM_WEBHOOK_SECRET?: string
}

type DraftStreamRow = {
  id: string
  video_id: string
  media_file_id: string
  stream_uid: string | null
  stream_state: DraftStreamState
  byte_size: number
  display_name: string
  created_by_user_id: string
  object_key: string
}

const bindings = env as StreamBindings

function streamApi(envBindings: StreamBindings = bindings): StreamBinding | null {
  return envBindings.STREAM ?? null
}

function publicStream(state: DraftStreamState, uid: string | null = null): DraftStream {
  return { ...emptyDraftStream(state), uid }
}

async function mark(
  draftId: string,
  state: DraftStreamState,
  uid: string | null,
  error: string | null,
  envBindings: StreamBindings,
): Promise<void> {
  await envBindings.DB.prepare(
    `UPDATE draft SET stream_state = ?, stream_uid = ?, stream_error = ?, stream_updated_at = ?
     WHERE id = ? AND stream_state != 'ready'`,
  ).bind(state, uid, error, Date.now(), draftId).run()
}

async function draftRow(fileId: string, envBindings: StreamBindings): Promise<DraftStreamRow | null> {
  return envBindings.DB.prepare(
    `SELECT d.id, d.video_id, d.media_file_id, d.stream_uid, d.stream_state,
            f.byte_size, f.display_name, f.created_by_user_id, f.object_key
     FROM draft d
     JOIN media_file f ON f.id = d.media_file_id AND f.video_id = d.video_id
     JOIN video v ON v.id = d.video_id
     WHERE f.id = ? AND v.${ACTIVE_VIDEO_SQL}`,
  ).bind(fileId).first<DraftStreamRow>()
}

export function draftStreamFromRow(
  state: unknown,
  uid: string | null | undefined,
): DraftStream {
  return publicStream(parseDraftStreamState(state), uid ?? null)
}

export async function createIngestUrl(
  fileId: string,
  envBindings: StreamBindings = bindings,
): Promise<string> {
  const exp = Date.now() + STREAM_INGEST_TTL_MS
  const mac = await ingestMac(envBindings.BETTER_AUTH_SECRET, fileId, exp)
  return `${new URL(envBindings.APP_ORIGIN).origin}/api/stream-source/${fileId}?exp=${exp}&mac=${mac}`
}

export async function readStreamSource(
  fileIdValue: string,
  expValue: string | null,
  macValue: string | null,
  request: Request,
  envBindings: StreamBindings = bindings,
): Promise<Response> {
  const fileId = parseMediaId(fileIdValue)
  const exp = Number(expValue)
  const mac = macValue ?? ''
  if (!(await verifyIngestMac(envBindings.BETTER_AUTH_SECRET, fileId, exp, mac))) {
    return new Response('Not found.', { status: 404 })
  }
  const row = await draftRow(fileId, envBindings)
  if (!row) return new Response('Not found.', { status: 404 })
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${row.display_name.replace(/[^\x20-\x7e]/g, '_')}"`,
  })
  if (request.method === 'HEAD') {
    const object = await envBindings.MEDIA.head(row.object_key)
    if (!object) return new Response('Not found.', { status: 404 })
    headers.set('Content-Length', String(object.size))
    return new Response(null, { status: 200, headers })
  }
  const object = await envBindings.MEDIA.get(row.object_key)
  if (!object) return new Response('Not found.', { status: 404 })
  headers.set('Content-Length', String(object.size))
  return new Response(object.body, { status: 200, headers })
}

async function copyDraft(row: DraftStreamRow, envBindings: StreamBindings): Promise<void> {
  if (!streamFits(row.byte_size)) {
    await mark(row.id, 'oversized', null, 'File exceeds the 30 GB Stream upload limit.', envBindings)
    return
  }
  const stream = streamApi(envBindings)
  if (!stream) {
    await mark(row.id, 'unavailable', row.stream_uid, 'Stream binding is not configured.', envBindings)
    return
  }
  if (row.stream_state === 'ready' && row.stream_uid) return
  if (row.stream_state === 'copying' && row.stream_uid) return
  const origin = new URL(envBindings.APP_ORIGIN).host
  const video = await stream.upload(await createIngestUrl(row.media_file_id, envBindings), {
    creator: row.created_by_user_id,
    requireSignedURLs: true,
    allowedOrigins: [origin],
    meta: { draftId: row.id, fileId: row.media_file_id, videoId: row.video_id },
  })
  const uid = streamVideoId(video)
  if (!uid) throw new Error('Stream copy did not return a video id.')
  const ready = video.readyToStream === true
  await envBindings.DB.prepare(
    `UPDATE draft SET stream_state = ?, stream_uid = ?, stream_error = NULL, stream_updated_at = ?
     WHERE id = ? AND stream_state != 'ready'`,
  ).bind(ready ? 'ready' : 'copying', uid, Date.now(), row.id).run()
}

export async function ensureDraftStream(
  fileId: string,
  envBindings: StreamBindings = bindings,
): Promise<void> {
  const row = await draftRow(fileId, envBindings)
  if (!row || row.stream_state === 'ready' || row.stream_state === 'oversized') return
  try {
    await copyDraft(row, envBindings)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Stream copy failed.'
    await mark(row.id, 'failed', row.stream_uid, message, envBindings)
    console.error('Draft Stream copy failed', error)
  }
}

export async function applyStreamVideo(
  video: StreamStatusInput,
  envBindings: StreamBindings = bindings,
): Promise<void> {
  const uid = streamVideoId(video)
  if (!uid) return
  const ready = video.readyToStream === true && video.status?.state !== 'error'
  const error = video.status?.errorReasonText ?? video.status?.errReasonText ?? null
  if (ready) {
    await envBindings.DB.prepare(
      `UPDATE draft SET stream_state = 'ready', stream_error = NULL, stream_updated_at = ?
       WHERE stream_uid = ?`,
    ).bind(Date.now(), uid).run()
    return
  }
  if (video.status?.state === 'error') {
    await envBindings.DB.prepare(
      `UPDATE draft SET stream_state = 'failed', stream_error = ?, stream_updated_at = ?
       WHERE stream_uid = ? AND stream_state != 'ready'`,
    ).bind(error, Date.now(), uid).run()
  }
}

export async function handleStreamWebhook(
  request: Request,
  envBindings: StreamBindings = bindings,
): Promise<Response> {
  const secret = envBindings.STREAM_WEBHOOK_SECRET
  const body = await request.text()
  if (!secret) return new Response(null, { status: 503 })
  if (!(await verifyWebhookSignature(secret, request.headers.get('Webhook-Signature'), body))) {
    return new Response(null, { status: 401 })
  }
  const event = parseStreamWebhook(JSON.parse(body))
  await applyStreamVideo({
    uid: event.uid,
    readyToStream: event.ready,
    status: {
      state: event.ready ? 'ready' : event.error ? 'error' : 'inprogress',
      errorReasonText: event.error ?? undefined,
    },
  }, envBindings)
  return new Response(null, { status: 204 })
}

export async function signDraftPlayback(
  drafts: Draft[],
  envBindings: StreamBindings = bindings,
): Promise<Draft[]> {
  const stream = streamApi(envBindings)
  return Promise.all(drafts.map(async (draft) => {
    if (draft.stream.state !== 'ready' || !draft.stream.uid || !stream) return draft
    try {
      const [details, token] = await Promise.all([
        stream.video(draft.stream.uid).details(),
        stream.video(draft.stream.uid).generateToken(),
      ])
      const hls = streamHlsUrl(details)
      if (!hls) return draft
      const signed = streamTokenValue(token)
      return {
        ...draft,
        stream: {
          ...draft.stream,
          playbackUrl: signedManifestUrl(hls, draft.stream.uid, signed),
          thumbnailUrl: signedThumbnailUrl(hls, draft.stream.uid, signed),
        },
      }
    } catch (error) {
      console.error('Stream playback token failed', error)
      return draft
    }
  }))
}

export async function reconcileDraftStreams(envBindings: StreamBindings = bindings): Promise<number> {
  const missing = await envBindings.DB.prepare(
    `SELECT f.id AS file_id FROM draft d
     JOIN media_file f ON f.id = d.media_file_id AND f.video_id = d.video_id
     JOIN video v ON v.id = d.video_id
     WHERE v.${ACTIVE_VIDEO_SQL} AND (
       d.stream_state IS NULL OR d.stream_state IN ('queued', 'failed', 'unavailable')
       OR (d.stream_state = 'copying' AND d.stream_uid IS NULL)
     ) ORDER BY d.created_at ASC LIMIT 20`,
  ).all<{ file_id: string }>()
  for (const row of missing.results) await ensureDraftStream(row.file_id, envBindings)

  const stream = streamApi(envBindings)
  if (!stream) return missing.results.length
  const pending = await envBindings.DB.prepare(
    `SELECT stream_uid FROM draft
     WHERE stream_state = 'copying' AND stream_uid IS NOT NULL
     ORDER BY COALESCE(stream_updated_at, created_at) ASC LIMIT 20`,
  ).all<{ stream_uid: string }>()
  for (const row of pending.results) {
    try {
      await applyStreamVideo(await stream.video(row.stream_uid).details(), envBindings)
    } catch (error) {
      console.error('Stream status poll failed', error)
    }
  }
  return missing.results.length + pending.results.length
}

export async function deleteDraftStreams(
  videoId: string,
  envBindings: StreamBindings = bindings,
): Promise<void> {
  const stream = streamApi(envBindings)
  const rows = await envBindings.DB.prepare(
    'SELECT stream_uid FROM draft WHERE video_id = ? AND stream_uid IS NOT NULL',
  ).bind(videoId).all<{ stream_uid: string }>()
  if (!stream) return
  for (const row of rows.results) {
    await stream.video(row.stream_uid).delete().catch((error) => {
      console.error('Stream video delete failed', error)
    })
  }
}
