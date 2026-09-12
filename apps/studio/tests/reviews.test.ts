import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { parseBeginUpload, UPLOAD_PART_SIZE } from '../src/domain/media'
import { anchorStartMs, formatTimestamp, parseReviewAnchor } from '../src/domain/reviews'

const videoA = '1b0e913b-645c-4306-a71d-78115390b46d'
const videoB = '2b0e913b-645c-4306-a71d-78115390b46d'
const fileA = '3b0e913b-645c-4306-a71d-78115390b46d'
const fileB = '4b0e913b-645c-4306-a71d-78115390b46d'
const draftA = '5b0e913b-645c-4306-a71d-78115390b46d'
const draftB = '6b0e913b-645c-4306-a71d-78115390b46d'

function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const migration of ['0001_auth.sql', '0002_planning.sql', '0003_footage.sql', '0004_reviews.sql']) {
    db.exec(readFileSync(resolve(process.cwd(), `migrations/${migration}`), 'utf8'))
  }
  db.exec(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES ('user-1', 'Studio User', 'studio@example.com', 1, 1, 1);
    INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
    VALUES
      ('${videoA}', 'A', 'long', 'organic', 'ready-to-review', '{"type":"doc","content":[]}', 1, 1, 1),
      ('${videoB}', 'B', 'long', 'organic', 'ready-to-review', '{"type":"doc","content":[]}', 1, 1, 1);
  `)
  return db
}

function insertMedia(db: DatabaseSync, videoId: string, fileId: string, purpose: 'footage' | 'draft') {
  const uploadId = crypto.randomUUID()
  db.prepare(`INSERT INTO upload_session (
    id, video_id, created_by_user_id, client_request_id, file_id, object_key,
    display_name, byte_size, content_type, part_size, part_count, state, purpose,
    draft_id, draft_duration_ms, created_at, updated_at
  ) VALUES (?, ?, 'user-1', ?, ?, ?, 'file.mp4', 20, 'video/mp4', ?, 1, 'ready', ?, ?, ?, 1, 1)`).run(
    uploadId, videoId, crypto.randomUUID(), fileId, `videos/${videoId}/${purpose}/${fileId}`,
    UPLOAD_PART_SIZE, purpose, purpose === 'draft' ? crypto.randomUUID() : null,
    purpose === 'draft' ? 12_000 : null,
  )
  db.prepare(`INSERT INTO media_file (
    id, video_id, created_by_user_id, upload_session_id, object_key, display_name,
    byte_size, content_type, object_etag, purpose, created_at, updated_at
  ) VALUES (?, ?, 'user-1', ?, ?, 'file.mp4', 20, 'video/mp4', 'etag', ?, 1, 1)`).run(
    fileId, videoId, uploadId, `videos/${videoId}/${purpose}/${fileId}`, purpose,
  )
}

describe('review domain', () => {
  it('accepts bounded video draft intent and rejects unsupported media', () => {
    const draft = parseBeginUpload({
      videoId: videoA,
      clientRequestId: crypto.randomUUID(),
      displayName: 'draft.mp4',
      byteSize: 100,
      contentType: 'video/mp4',
      purpose: { kind: 'draft', durationMs: 12_345 },
    })
    expect(draft.purpose).toEqual({ kind: 'draft', durationMs: 12_345 })
    expect(() => parseBeginUpload({ ...draft, contentType: 'image/png' })).toThrow('video format')
  })

  it('validates point and range anchors against known duration', () => {
    expect(parseReviewAnchor({ kind: 'point', atMs: 4000 }, 5000)).toEqual({ kind: 'point', atMs: 4000 })
    const range = parseReviewAnchor({ kind: 'range', startMs: 1000, endMs: 5000 }, 5000)
    expect(anchorStartMs(range)).toBe(1000)
    expect(() => parseReviewAnchor({ kind: 'range', startMs: 5000, endMs: 4000 }, 6000)).toThrow('after')
    expect(() => parseReviewAnchor({ kind: 'point', atMs: 5001 }, 5000)).toThrow('duration')
    expect(formatTimestamp(3_723_000)).toBe('1:02:03')
  })
})

describe('review migration', () => {
  it('allocates unique task-local versions and rejects a second draft for one file', () => {
    const db = migratedDatabase()
    insertMedia(db, videoA, fileA, 'draft')
    insertMedia(db, videoA, fileB, 'draft')
    const insert = db.prepare(`INSERT INTO draft (
      id, video_id, media_file_id, version, duration_ms, created_by_user_id, created_at
    ) SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, 12000, 'user-1', 1 FROM draft WHERE video_id = ?`)
    insert.run(draftA, videoA, fileA, videoA)
    insert.run(draftB, videoA, fileB, videoA)
    expect(db.prepare('SELECT version FROM draft ORDER BY version').all()).toEqual([{ version: 1 }, { version: 2 }])
    expect(() => insert.run(crypto.randomUUID(), videoA, fileA, videoA)).toThrow('UNIQUE')
    db.close()
  })

  it('enforces draft and attachment purpose and same-task relationships', () => {
    const db = migratedDatabase()
    insertMedia(db, videoA, fileA, 'draft')
    insertMedia(db, videoB, fileB, 'footage')
    db.prepare(`INSERT INTO draft (
      id, video_id, media_file_id, version, duration_ms, created_by_user_id, created_at
    ) VALUES (?, ?, ?, 1, 12000, 'user-1', 1)`).run(draftA, videoA, fileA)
    const commentId = crypto.randomUUID()
    db.prepare(`INSERT INTO review_comment (
      id, video_id, draft_id, author_user_id, anchor_kind, start_ms, end_ms, body_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'user-1', 'range', 1000, 2000, '{"type":"doc","content":[]}', 1, 1)`).run(commentId, videoA, draftA)
    expect(() => db.prepare(
      'INSERT INTO comment_attachment (comment_id, video_id, media_file_id, position) VALUES (?, ?, ?, 0)',
    ).run(commentId, videoA, fileB)).toThrow('footage attachment')
    expect(() => db.prepare(`INSERT INTO review_comment (
      id, video_id, draft_id, author_user_id, anchor_kind, start_ms, end_ms, body_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'user-1', 'range', 2000, 1000, '{"type":"doc","content":[]}', 1, 1)`).run(
      crypto.randomUUID(), videoA, draftA,
    )).toThrow('CHECK')
    db.close()
  })
})
