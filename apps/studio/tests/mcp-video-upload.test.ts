import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  MCP_DRAFT_UPLOAD_MAX_BYTES,
  MCP_DRAFT_UPLOAD_TTL_MS,
  MCP_DRAFT_UPLOAD_URL_TTL_MS,
  parseListDraftVersionsInput,
  parseRequestVideoUploadInput,
} from '../src/domain/mcp-videos'
import { readMp4DurationMs, testMp4 } from '../src/domain/mp4-duration'
import { presignR2Url } from '../src/domain/r2-presign'
import { isMcpScope } from '../src/domain/mcp-tokens'
import { migratedDatabase } from './support/draft-ai-db'

const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))

vi.mock('@tanstack/react-start/server-only', () => ({}))
vi.mock('cloudflare:workers', () => ({ env: runtime.env }))

const videoId = 'ca3af5e3-07d0-4cd2-b1e3-bd32553610b8'
const userId = '7b0e913b-645c-4306-a71d-78115390b46d'
const origin = 'https://studio.youraveragetechbro.com'

type StoredObject = { bytes: Uint8Array }

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
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      for (const statement of statements) await statement.run()
    },
  } as unknown as D1Database
}

function mediaBucket(objects: Map<string, StoredObject>): R2Bucket {
  return {
    async head(key: string) {
      const object = objects.get(key)
      return object ? { size: object.bytes.byteLength, etag: 'etag' } : null
    },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const object = objects.get(key)
      if (!object) return null
      const start = options?.range?.offset ?? 0
      const end = options?.range ? start + options.range.length : object.bytes.byteLength
      const bytes = object.bytes.slice(start, end)
      return {
        size: object.bytes.byteLength,
        etag: 'etag',
        body: new Blob([bytes]).stream(),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }
    },
    async delete(key: string) {
      objects.delete(key)
    },
  } as unknown as R2Bucket
}

function seed(db: DatabaseSync) {
  db.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES (?, 'Studio User', 'studio@example.com', 1, 1, 1)`).run(userId)
  db.prepare(`INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
    VALUES (?, 'Carrier', 'long', 'organic', 'ready-to-review', '{"type":"doc","content":[]}', 1, 1, 1)`).run(videoId)
}

function useEnv(db: DatabaseSync, objects: Map<string, StoredObject>, extra: Record<string, unknown> = {}) {
  for (const key of Object.keys(runtime.env)) delete runtime.env[key]
  Object.assign(runtime.env, {
    DB: d1(db),
    MEDIA: mediaBucket(objects),
    APP_ORIGIN: origin,
    CLOUDFLARE_ACCOUNT_ID: '2a59d9e0842dc0b3d920f591fe82702c',
    R2_ACCESS_KEY_ID: 'test-access-key-id',
    R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
    VIDEO_COMPRESSION_QUEUE: { send: async () => undefined },
    ...extra,
  })
}

describe('MCP draft upload parsing', () => {
  it('accepts a video type under the R2 single-PUT cap and rejects the rest', () => {
    expect(MCP_DRAFT_UPLOAD_MAX_BYTES).toBe(Math.floor(4.9 * 1024 * 1024 * 1024))
    expect(parseRequestVideoUploadInput({
      video_id: videoId,
      filename: 'cut.mp4',
      content_type: 'video/mp4',
      size: 12,
    })).toMatchObject({ videoId, filename: 'cut.mp4', contentType: 'video/mp4', size: 12 })
    expect(parseRequestVideoUploadInput({
      video_id: videoId,
      filename: 'cut.mp4',
      content_type: 'video/mp4',
      size: MCP_DRAFT_UPLOAD_MAX_BYTES,
    }).size).toBe(MCP_DRAFT_UPLOAD_MAX_BYTES)
    expect(() => parseRequestVideoUploadInput({
      video_id: videoId, filename: 'cut.mp4', content_type: 'image/png', size: 12,
    })).toThrow(/video type/)
    expect(() => parseRequestVideoUploadInput({
      video_id: videoId, filename: 'cut.mp4', content_type: 'video/mp4', size: MCP_DRAFT_UPLOAD_MAX_BYTES + 1,
    })).toThrow(/size/)
    expect(parseListDraftVersionsInput({ video_id: videoId })).toBe(videoId)
  })

  it('keeps the pending row alive after the presigned PUT window', () => {
    expect(MCP_DRAFT_UPLOAD_URL_TTL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000)
    expect(MCP_DRAFT_UPLOAD_TTL_MS).toBeGreaterThan(MCP_DRAFT_UPLOAD_URL_TTL_MS)
  })

  it('reads duration from an mvhd box', () => {
    expect(readMp4DurationMs(testMp4(2500))).toBe(2500)
  })

  it('keeps videos:write off a read-only token', () => {
    expect(isMcpScope(['videos:read'], 'videos:write')).toBe(false)
    expect(isMcpScope(['videos:write'], 'videos:write')).toBe(true)
    const source = readFileSync(resolve(process.cwd(), 'src/server/mcp.server.ts'), 'utf8')
    expect(source).toMatch(/request_video_upload[\s\S]*isMcpScope\(scopes, 'videos:write'\)/)
    expect(source).toMatch(/finalize_video_upload[\s\S]*isMcpScope\(scopes, 'videos:write'\)/)
    expect(source).toMatch(/list_draft_versions[\s\S]*isMcpScope\(scopes, 'videos:read'\)/)
    expect(source).not.toMatch(/files:write/)
  })
})

describe('presigned R2 PUT', () => {
  it('signs a PUT that requires Content-Type', async () => {
    const url = await presignR2Url({
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'yatb-studio-media',
      key: `videos/${videoId}/drafts/file`,
      method: 'PUT',
      contentType: 'video/mp4',
      expiresInSeconds: 3600,
      now: new Date('2026-11-16T17:00:00.000Z'),
    })
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
    expect(url).toContain('X-Amz-SignedHeaders=content-type%3Bhost')
    expect(url).toContain('X-Amz-Signature=')
    const other = await presignR2Url({
      accessKeyId: 'AKIA',
      secretAccessKey: 'other',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'yatb-studio-media',
      key: `videos/${videoId}/drafts/file`,
      method: 'PUT',
      contentType: 'video/mp4',
      expiresInSeconds: 3600,
      now: new Date('2026-11-16T17:00:00.000Z'),
    })
    expect(other).not.toBe(url)
  })
})

describe('MCP draft upload', () => {
  afterEach(() => {
    for (const key of Object.keys(runtime.env)) delete runtime.env[key]
  })

  it('requests a presigned PUT for an existing video', async () => {
    const db = migratedDatabase()
    seed(db)
    useEnv(db, new Map())
    const { requestVideoUpload } = await import('../src/server/media.server')
    const result = await requestVideoUpload({
      videoId, filename: 'cut.mp4', contentType: 'video/mp4', size: 2048,
    }, userId, 1_700_000_000_000)
    expect(result.upload_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.headers).toEqual({ 'Content-Type': 'video/mp4' })
    expect(result.upload_url).toContain('yatb-studio-media/videos/')
    expect(result.expires_at).toBe(1_700_000_000_000 + MCP_DRAFT_UPLOAD_TTL_MS)
  })

  it('fails clearly when R2 S3 secrets are missing', async () => {
    const db = migratedDatabase()
    seed(db)
    useEnv(db, new Map(), { R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' })
    const { requestVideoUpload } = await import('../src/server/media.server')
    await expect(requestVideoUpload({
      videoId, filename: 'cut.mp4', contentType: 'video/mp4', size: 2048,
    }, userId)).rejects.toThrow(/R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY/)
  })

  it('rejects finalize when the object is missing or the size does not match', async () => {
    const db = migratedDatabase()
    seed(db)
    const objects = new Map<string, StoredObject>()
    useEnv(db, objects)
    const { requestVideoUpload, finalizeVideoUpload } = await import('../src/server/media.server')
    const pending = await requestVideoUpload({
      videoId, filename: 'cut.mp4', contentType: 'video/mp4', size: 2048,
    }, userId)
    await expect(finalizeVideoUpload(pending.upload_id)).rejects.toThrow('Upload object is missing.')
    const key = db.prepare('SELECT object_key FROM mcp_video_upload WHERE id = ?').get(pending.upload_id) as { object_key: string }
    objects.set(key.object_key, { bytes: new Uint8Array(16) })
    await expect(finalizeVideoUpload(pending.upload_id)).rejects.toThrow('Upload size does not match.')
  })

  it('publishes a draft once and returns the same version on retry', async () => {
    const db = migratedDatabase()
    seed(db)
    const bytes = testMp4(4000)
    const objects = new Map<string, StoredObject>()
    useEnv(db, objects)
    const { requestVideoUpload, finalizeVideoUpload } = await import('../src/server/media.server')
    const pending = await requestVideoUpload({
      videoId, filename: 'cut.mp4', contentType: 'video/mp4', size: bytes.byteLength,
    }, userId)
    const key = db.prepare('SELECT object_key FROM mcp_video_upload WHERE id = ?').get(pending.upload_id) as { object_key: string }
    objects.set(key.object_key, { bytes })
    const first = await finalizeVideoUpload(pending.upload_id)
    const second = await finalizeVideoUpload(pending.upload_id)
    expect(first.version).toBe(1)
    expect(first.durationMs).toBe(4000)
    expect(first.file.displayName).toBe('cut.mp4')
    expect(second.id).toBe(first.id)
    expect(second.version).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS count FROM draft WHERE video_id = ?').get(videoId)).toEqual({ count: 1 })
  })
})
