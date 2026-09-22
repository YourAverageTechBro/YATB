import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  COMPACT_MP4_PROFILE,
  MAX_COMPRESSION_BYTES,
  MAX_COMPRESSION_DURATION_MS,
  compressedDisplayName,
  derivativeId,
  derivativeObjectKey,
  supportsCompression,
} from '../src/domain/derivatives'

const videoId = '1b0e913b-645c-4306-a71d-78115390b46d'
const sourceFileId = '3b0e913b-645c-4306-a71d-78115390b46d'

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    '0001_auth.sql', '0002_planning.sql', '0003_footage.sql',
    '0004_reviews.sql', '0005_integration_organic_link.sql', '0006_media_derivatives.sql',
  ]) db.exec(readFileSync(resolve(process.cwd(), `migrations/${migration}`), 'utf8'))
  return db
}

describe('compact MP4 domain', () => {
  it('uses a versioned deterministic identity and a safe download name', () => {
    expect(derivativeId(sourceFileId)).toBe(`${sourceFileId}:${COMPACT_MP4_PROFILE}`)
    expect(derivativeObjectKey(videoId, sourceFileId)).toBe(
      `videos/${videoId}/derivatives/${sourceFileId}/${COMPACT_MP4_PROFILE}.mp4`,
    )
    expect(compressedDisplayName('launch.final.mov')).toBe('launch.final - smaller.mp4')
  })

  it('bounds container work without restricting original uploads', () => {
    expect(supportsCompression({ byteSize: MAX_COMPRESSION_BYTES, durationMs: MAX_COMPRESSION_DURATION_MS, contentType: 'video/mp4' })).toBe(true)
    expect(supportsCompression({ byteSize: MAX_COMPRESSION_BYTES + 1, durationMs: 1, contentType: 'video/mp4' })).toBe(false)
    expect(supportsCompression({ byteSize: 1, durationMs: MAX_COMPRESSION_DURATION_MS + 1, contentType: 'video/mp4' })).toBe(false)
    expect(supportsCompression({ byteSize: 1, durationMs: 1, contentType: 'image/png' })).toBe(false)
  })
})

describe('media derivative migration', () => {
  it('stores one independent derivative per source and profile and cascades with its video', () => {
    const db = database()
    db.exec(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('user-1', 'Studio', 'studio@example.com', 1, 1, 1);
      INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
      VALUES ('${videoId}', 'Video', 'short', 'organic', 'filming', '{"type":"doc","content":[]}', 1, 1, 1);
      INSERT INTO upload_session (
        id, video_id, created_by_user_id, client_request_id, file_id, object_key,
        display_name, byte_size, content_type, purpose, draft_id, draft_duration_ms,
        part_size, part_count, state, created_at, updated_at
      ) VALUES (
        'upload-1', '${videoId}', 'user-1', 'request-1', '${sourceFileId}', 'original-key',
        'video.mp4', 100, 'video/mp4', 'draft', 'draft-1', 1000,
        33554432, 1, 'ready', 1, 1
      );
      INSERT INTO media_file (
        id, video_id, created_by_user_id, upload_session_id, object_key, display_name,
        byte_size, content_type, object_etag, purpose, created_at, updated_at
      ) VALUES (
        '${sourceFileId}', '${videoId}', 'user-1', 'upload-1', 'original-key', 'video.mp4',
        100, 'video/mp4', 'original-etag', 'draft', 1, 1
      );
      INSERT INTO media_derivative (
        id, video_id, source_media_file_id, profile, state, object_key, attempts, created_at, updated_at
      ) VALUES (
        '${derivativeId(sourceFileId)}', '${videoId}', '${sourceFileId}', '${COMPACT_MP4_PROFILE}',
        'queued', 'derivative-key', 0, 1, 1
      );
    `)
    expect(() => db.exec(`INSERT INTO media_derivative (
      id, video_id, source_media_file_id, profile, state, object_key, attempts, created_at, updated_at
    ) VALUES ('duplicate', '${videoId}', '${sourceFileId}', '${COMPACT_MP4_PROFILE}', 'queued', 'other-key', 0, 1, 1)`)).toThrow('UNIQUE')
    expect(() => db.exec(`UPDATE media_derivative SET state = 'ready'`)).toThrow('CHECK')
    db.exec(`UPDATE video SET deleted_at = 1 WHERE id = '${videoId}'; DELETE FROM video WHERE id = '${videoId}'`)
    expect(db.prepare('SELECT COUNT(*) AS count FROM media_derivative').get()).toEqual({ count: 0 })
    db.close()
  })
})

