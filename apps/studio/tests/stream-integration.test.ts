import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STREAM_MAX_BYTES, hmacHex } from '../src/domain/stream'
import { commentSeekMs, reviewPlaybackSrc, type Draft } from '../src/domain/reviews'

vi.mock('@tanstack/react-start/server-only', () => ({}))
vi.mock('cloudflare:workers', () => ({
  env: {
    APP_ORIGIN: 'https://studio.youraveragetechbro.com',
    BETTER_AUTH_SECRET: 'prove-it-works-secret-at-least-32-chars',
  },
}))

const videoId = '1b0e913b-645c-4306-a71d-78115390b46d'
const fileId = '3b0e913b-645c-4306-a71d-78115390b46d'
const draftId = '5b0e913b-645c-4306-a71d-78115390b46d'
const userId = '7b0e913b-645c-4306-a71d-78115390b46d'
const objectKey = `videos/${videoId}/drafts/${fileId}`
const originalBytes = new Uint8Array([1, 2, 3, 4, 5, 9])

function d1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      const bound = (params: Array<string | number | null>) => ({
        bind: (...next: Array<string | number | null>) => bound(next),
        first: async () => db.prepare(sql).get(...params) ?? null,
        run: async () => {
          const result = db.prepare(sql).run(...params)
          return { meta: { changes: result.changes } }
        },
        all: async () => ({ results: db.prepare(sql).all(...params) }),
      })
      return bound([])
    },
  } as unknown as D1Database
}

function mediaBucket(objects: Map<string, Uint8Array>): R2Bucket {
  return {
    async head(key: string) {
      const body = objects.get(key)
      return body ? { size: body.byteLength } : null
    },
    async get(key: string) {
      const body = objects.get(key)
      return body ? { size: body.byteLength, body: new Blob([new Uint8Array(body)]).stream() } : null
    },
  } as unknown as R2Bucket
}

function draftRow(db: DatabaseSync) {
  return db.prepare('SELECT stream_state, stream_uid, stream_error FROM draft WHERE id = ?').get(draftId) as {
    stream_state: string
    stream_uid: string | null
    stream_error: string | null
  }
}

function seed(db: DatabaseSync, byteSize = originalBytes.byteLength) {
  db.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    '0001_auth.sql', '0002_planning.sql', '0003_footage.sql', '0004_reviews.sql', '0010_draft_stream.sql',
  ]) db.exec(readFileSync(resolve(process.cwd(), `migrations/${migration}`), 'utf8'))
  db.exec(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES ('${userId}', 'Studio User', 'studio@example.com', 1, 1, 1);
    INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
    VALUES ('${videoId}', 'A', 'long', 'organic', 'ready-to-review', '{"type":"doc","content":[]}', 1, 1, 1);
  `)
  const uploadId = crypto.randomUUID()
  db.prepare(`INSERT INTO upload_session (
    id, video_id, created_by_user_id, client_request_id, file_id, object_key,
    display_name, byte_size, content_type, part_size, part_count, state, purpose,
    draft_id, draft_duration_ms, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'draft.mp4', ?, 'video/mp4', 33554432, 1, 'ready', 'draft', ?, ?, 1, 1)`).run(
    uploadId, videoId, userId, crypto.randomUUID(), fileId, objectKey, byteSize, draftId, 12_000,
  )
  db.prepare(`INSERT INTO media_file (
    id, video_id, created_by_user_id, upload_session_id, object_key, display_name,
    byte_size, content_type, object_etag, purpose, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'draft.mp4', ?, 'video/mp4', 'etag', 'draft', 1, 1)`).run(
    fileId, videoId, userId, uploadId, objectKey, byteSize,
  )
  db.prepare(`INSERT INTO draft (
    id, video_id, media_file_id, version, duration_ms, created_by_user_id, created_at
  ) VALUES (?, ?, ?, 1, 12000, ?, 1)`).run(draftId, videoId, fileId, userId)
}

function fakeStream(options?: { readyOnUpload?: boolean; throwOnUpload?: boolean; readyOnPoll?: boolean }) {
  const uploads: Array<{ url: string; params: { requireSignedURLs?: boolean; allowedOrigins?: string[]; meta?: Record<string, string> } }> = []
  const stream = {
    uploads,
    async upload(url: string, params: { requireSignedURLs?: boolean; allowedOrigins?: string[]; meta?: Record<string, string> }) {
      if (options?.throwOnUpload) throw new Error('copy exploded')
      uploads.push({ url, params })
      return {
        id: 'stream-uid-1',
        readyToStream: options?.readyOnUpload === true,
        hlsPlaybackUrl: 'https://customer-test.cloudflarestream.com/stream-uid-1/manifest/video.m3u8',
        status: { state: options?.readyOnUpload ? 'ready' : 'downloading' },
      }
    },
    video(id: string) {
      return {
        async details() {
          return {
            id,
            readyToStream: options?.readyOnPoll !== false,
            hlsPlaybackUrl: `https://customer-test.cloudflarestream.com/${id}/manifest/video.m3u8`,
            status: { state: options?.readyOnPoll === false ? 'inprogress' : 'ready' },
          }
        },
        async generateToken() { return 'signed-token' },
        async delete() { return undefined },
      }
    },
  }
  return stream
}

function envFor(db: DatabaseSync, stream: ReturnType<typeof fakeStream> | null, extras: Record<string, unknown> = {}) {
  const objects = new Map<string, Uint8Array>([[objectKey, originalBytes]])
  return {
    APP_ORIGIN: 'https://studio.youraveragetechbro.com',
    BETTER_AUTH_SECRET: 'prove-it-works-secret-at-least-32-chars',
    STREAM_WEBHOOK_SECRET: 'webhook-secret',
    DB: d1(db),
    MEDIA: mediaBucket(objects),
    STREAM: stream ?? undefined,
    objects,
    ...extras,
  } as unknown as Cloudflare.Env & { STREAM_WEBHOOK_SECRET?: string; STREAM?: ReturnType<typeof fakeStream> }
}

function sampleDraft(stream: Draft['stream']): Draft {
  return {
    id: draftId,
    videoId,
    version: 1,
    durationMs: 12_000,
    compactMp4: { state: 'queued', byteSize: null },
    stream,
    file: {
      id: fileId, videoId, purpose: 'draft', displayName: 'draft.mp4',
      byteSize: 6, contentType: 'video/mp4', createdAt: 1, updatedAt: 1,
    },
    author: { id: userId, name: 'Studio User', email: 'studio@example.com' },
    createdAt: 1,
  }
}

const { ensureDraftStream, handleStreamWebhook, readStreamSource, reconcileDraftStreams, signDraftPlayback } =
  await import('../src/server/stream.server')

afterEach(() => vi.restoreAllMocks())

describe('stream copy, webhook, cron, and signed loadDrafts', () => {
  it('copies R2 through a signed ingest URL, marks ready, and attaches signed HLS', async () => {
    const db = new DatabaseSync(':memory:')
    seed(db)
    const stream = fakeStream()
    const env = envFor(db, stream)

    await ensureDraftStream(fileId, env)
    expect(draftRow(db)).toMatchObject({ stream_state: 'copying', stream_uid: 'stream-uid-1' })
    expect(stream.uploads).toHaveLength(1)
    expect(stream.uploads[0]?.params.requireSignedURLs).toBe(true)
    expect(stream.uploads[0]?.params.allowedOrigins).toEqual(['studio.youraveragetechbro.com'])
    expect(stream.uploads[0]?.params.meta).toEqual({ draftId, fileId, videoId })
    expect(stream.uploads[0]?.url).toContain(`/api/stream-source/${fileId}?`)
    expect(stream.uploads[0]?.url).not.toContain('r2.dev')

    const ingest = new URL(stream.uploads[0]!.url)
    const source = await readStreamSource(
      fileId, ingest.searchParams.get('exp'), ingest.searchParams.get('mac'), new Request(ingest), env,
    )
    expect(source.status).toBe(200)
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(originalBytes)

    const forged = await readStreamSource(fileId, ingest.searchParams.get('exp'), '00'.repeat(32), new Request(ingest), env)
    expect(forged.status).toBe(404)

    const unsigned = await handleStreamWebhook(new Request('https://studio.youraveragetechbro.com/api/stream-webhook', {
      method: 'POST',
      body: JSON.stringify({ uid: 'stream-uid-1', readyToStream: true, status: { state: 'ready' } }),
    }), { ...env, STREAM_WEBHOOK_SECRET: undefined })
    expect(unsigned.status).toBe(503)

    const body = JSON.stringify({ uid: 'stream-uid-1', readyToStream: true, status: { state: 'ready' } })
    const time = Math.floor(Date.now() / 1000)
    const sig1 = await hmacHex('webhook-secret', `${time}.${body}`)
    const ready = await handleStreamWebhook(new Request('https://studio.youraveragetechbro.com/api/stream-webhook', {
      method: 'POST',
      headers: { 'Webhook-Signature': `time=${time},sig1=${sig1}` },
      body,
    }), env)
    expect(ready.status).toBe(204)
    expect(draftRow(db).stream_state).toBe('ready')

    const signed = await signDraftPlayback([sampleDraft({
      state: 'ready', uid: 'stream-uid-1', playbackUrl: null, thumbnailUrl: null,
    })], env)
    expect(signed[0]?.stream.playbackUrl).toBe(
      'https://customer-test.cloudflarestream.com/signed-token/manifest/video.m3u8',
    )
    expect(signed[0]?.stream.thumbnailUrl).toBe(
      'https://customer-test.cloudflarestream.com/signed-token/thumbnails/thumbnail.jpg',
    )
    expect(reviewPlaybackSrc(signed[0]!)).toContain('/manifest/video.m3u8')
    expect(reviewPlaybackSrc(signed[0]!)).not.toContain(`/api/videos/${videoId}/media/${fileId}`)
    db.close()
  })

  it('lets cron poll a copying draft to ready without a webhook', async () => {
    const db = new DatabaseSync(':memory:')
    seed(db)
    const stream = fakeStream({ readyOnPoll: true })
    const env = envFor(db, stream)
    await ensureDraftStream(fileId, env)
    expect(draftRow(db).stream_state).toBe('copying')
    await reconcileDraftStreams(env)
    expect(draftRow(db).stream_state).toBe('ready')
    db.close()
  })
})

describe('claimed failure modes', () => {
  it('keeps files over 30 GB on R2 and never calls Stream', async () => {
    const db = new DatabaseSync(':memory:')
    seed(db, STREAM_MAX_BYTES + 1)
    const stream = fakeStream()
    await ensureDraftStream(fileId, envFor(db, stream))
    expect(draftRow(db)).toMatchObject({ stream_state: 'oversized', stream_uid: null })
    expect(stream.uploads).toEqual([])
    expect(reviewPlaybackSrc(sampleDraft({ state: 'oversized', uid: null, playbackUrl: null, thumbnailUrl: null })))
      .toBe(`/api/videos/${videoId}/media/${fileId}`)
    db.close()
  })

  it('marks unavailable when STREAM is missing, matching local Vite', async () => {
    const db = new DatabaseSync(':memory:')
    seed(db)
    await ensureDraftStream(fileId, envFor(db, null))
    expect(draftRow(db)).toMatchObject({ stream_state: 'unavailable', stream_uid: null })
    const signed = await signDraftPlayback([sampleDraft({
      state: 'ready', uid: 'stream-uid-1', playbackUrl: null, thumbnailUrl: null,
    })], envFor(db, null))
    expect(signed[0]?.stream.playbackUrl).toBeNull()
    expect(reviewPlaybackSrc(signed[0]!)).toBe(`/api/videos/${videoId}/media/${fileId}`)
    db.close()
  })

  it('marks failed when Stream copy throws', async () => {
    const db = new DatabaseSync(':memory:')
    seed(db)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await ensureDraftStream(fileId, envFor(db, fakeStream({ throwOnUpload: true })))
    expect(draftRow(db)).toMatchObject({ stream_state: 'failed', stream_uid: null })
    expect(reviewPlaybackSrc(sampleDraft({ state: 'failed', uid: null, playbackUrl: null, thumbnailUrl: null })))
      .toBe(`/api/videos/${videoId}/media/${fileId}`)
    db.close()
  })
})

describe('comment time stays bound to the player clock', () => {
  it('seeks comments to the persisted anchor on the Stream duration', () => {
    expect(commentSeekMs({ kind: 'point', atMs: 4_200 }, 12_000)).toBe(4_200)
    expect(commentSeekMs({ kind: 'range', startMs: 1_000, endMs: 3_000 }, 12_000)).toBe(1_000)
    expect(commentSeekMs({ kind: 'point', atMs: 99_000 }, 12_000)).toBe(12_000)
  })
})
