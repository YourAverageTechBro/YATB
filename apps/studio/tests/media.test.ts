import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { isRetryableStatus } from '../src/client/upload'
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_PART_SIZE,
  cleanupDelay,
  expectedPartBytes,
  parseBeginUpload,
  parseDisplayName,
  parseSingleByteRange,
  sameUpload,
} from '../src/domain/media'

const videoId = '1b0e913b-645c-4306-a71d-78115390b46d'
const requestId = '28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27'

describe('footage domain', () => {
  it('bounds files and gives every non-final multipart part the fixed size', () => {
    const size = UPLOAD_PART_SIZE * 2 + 17
    expect(expectedPartBytes(size, 1)).toBe(UPLOAD_PART_SIZE)
    expect(expectedPartBytes(size, 2)).toBe(UPLOAD_PART_SIZE)
    expect(expectedPartBytes(size, 3)).toBe(17)
    expect(() => expectedPartBytes(size, 4)).toThrow('Part number')
    expect(() => parseBeginUpload({ videoId, clientRequestId: requestId, displayName: 'x', byteSize: MAX_UPLOAD_BYTES + 1, contentType: 'video/mp4' })).toThrow('size')
  })

  it('treats an idempotency key as reusable only for identical metadata', () => {
    const input = parseBeginUpload({ videoId, clientRequestId: requestId, displayName: 'take.mp4', byteSize: 20, contentType: 'video/mp4' })
    expect(sameUpload(input, input)).toBe(true)
    expect(sameUpload(input, { ...input, displayName: 'other.mp4' })).toBe(false)
  })

  it('parses one satisfiable byte range and rejects multiple or impossible ranges', () => {
    expect(parseSingleByteRange(null, 100)).toBeNull()
    expect(parseSingleByteRange('bytes=10-19', 100)).toEqual({ offset: 10, length: 10 })
    expect(parseSingleByteRange('bytes=90-', 100)).toEqual({ offset: 90, length: 10 })
    expect(parseSingleByteRange('bytes=-12', 100)).toEqual({ offset: 88, length: 12 })
    expect(() => parseSingleByteRange('bytes=120-', 100)).toThrow('Range')
    expect(() => parseSingleByteRange('bytes=0-1,4-5', 100)).toThrow('Range')
  })

  it('normalizes rename input and caps cleanup retry delay', () => {
    expect(parseDisplayName('  final\u0000 take.mp4  ')).toBe('final take.mp4')
    expect(cleanupDelay(1)).toBe(120_000)
    expect(cleanupDelay(30)).toBe(86_400_000)
  })

  it('retries only transient upload failures', () => {
    expect(isRetryableStatus(null)).toBe(true)
    expect(isRetryableStatus(408)).toBe(true)
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(403)).toBe(false)
  })
})

describe('footage migration', () => {
  it('keeps an immutable object identity when display metadata is renamed', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    for (const migration of ['0001_auth.sql', '0002_planning.sql', '0003_footage.sql']) {
      db.exec(readFileSync(resolve(process.cwd(), `migrations/${migration}`), 'utf8'))
    }
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('user-1', 'Studio', 'studio@example.com', 1, 1, 1);
      INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
      VALUES ('${videoId}', 'Footage', 'short', 'organic', 'filming', '{"type":"doc","content":[]}', 1, 1, 1);
      INSERT INTO upload_session (
        id, video_id, created_by_user_id, client_request_id, file_id, object_key,
        r2_upload_id, display_name, byte_size, content_type, part_size, part_count,
        state, object_etag, created_at, updated_at, completed_at
      ) VALUES (
        '${requestId}', '${videoId}', 'user-1', '7d68d858-03b5-4786-ad6a-0802c8469b57',
        'c734d128-fd78-4270-b862-ce6d5b677d12', 'videos/${videoId}/footage/c734d128-fd78-4270-b862-ce6d5b677d12',
        'private-upload', 'take.mp4', 20, 'video/mp4', ${UPLOAD_PART_SIZE}, 1,
        'ready', 'private-etag', 1, 1, 1
      );
      INSERT INTO media_file (
        id, video_id, created_by_user_id, upload_session_id, object_key, display_name,
        byte_size, content_type, object_etag, created_at, updated_at
      ) VALUES (
        'c734d128-fd78-4270-b862-ce6d5b677d12', '${videoId}', 'user-1', '${requestId}',
        'videos/${videoId}/footage/c734d128-fd78-4270-b862-ce6d5b677d12', 'take.mp4',
        20, 'video/mp4', 'private-etag', 1, 1
      );
      UPDATE media_file SET display_name = 'renamed.mp4', updated_at = 2
      WHERE id = 'c734d128-fd78-4270-b862-ce6d5b677d12';
    `)
    expect(db.prepare('SELECT display_name, object_key, object_etag FROM media_file').get()).toEqual({
      display_name: 'renamed.mp4',
      object_key: `videos/${videoId}/footage/c734d128-fd78-4270-b862-ce6d5b677d12`,
      object_etag: 'private-etag',
    })
    db.close()
  })
})
