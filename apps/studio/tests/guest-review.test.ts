import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { GuestReviewPage } from '../src/components/guest-review-page'
import { guestReviewPlaybackSrc, type Draft } from '../src/domain/reviews'
import { UPLOAD_PART_SIZE } from '../src/domain/media'

vi.mock('../src/server/reviews.functions', () => ({
  addGuestComment: vi.fn(),
  loadSharedReview: vi.fn(),
}))

const videoId = '1b0e913b-645c-4306-a71d-78115390b46d'
const fileId = '3b0e913b-645c-4306-a71d-78115390b46d'
const draftId = '5b0e913b-645c-4306-a71d-78115390b46d'
const commentId = '9b0e913b-645c-4306-a71d-78115390b46d'

function applyMigrations(db: DatabaseSync, files: readonly string[]) {
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of files) db.exec(readFileSync(resolve(process.cwd(), `migrations/${file}`), 'utf8'))
}

function seedDraft(db: DatabaseSync) {
  db.exec(`
    INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES ('user-1', 'Studio User', 'studio@example.com', 1, 1, 1);
    INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
    VALUES ('${videoId}', 'Guest cut', 'long', 'organic', 'ready-to-review', '{"type":"doc","content":[]}', 1, 1, 1);
  `)
  const uploadId = crypto.randomUUID()
  db.prepare(`INSERT INTO upload_session (
    id, video_id, created_by_user_id, client_request_id, file_id, object_key,
    display_name, byte_size, content_type, part_size, part_count, state, purpose,
    draft_id, draft_duration_ms, created_at, updated_at
  ) VALUES (?, ?, 'user-1', ?, ?, ?, 'v1.mp4', 20, 'video/mp4', ?, 1, 'ready', 'draft', ?, 2000, 1, 1)`).run(
    uploadId, videoId, crypto.randomUUID(), fileId, `videos/${videoId}/draft/${fileId}`, UPLOAD_PART_SIZE, draftId,
  )
  db.prepare(`INSERT INTO media_file (
    id, video_id, created_by_user_id, upload_session_id, object_key, display_name,
    byte_size, content_type, object_etag, purpose, created_at, updated_at
  ) VALUES (?, ?, 'user-1', ?, ?, 'v1.mp4', 20, 'video/mp4', 'etag', 'draft', 1, 1)`).run(
    fileId, videoId, uploadId, `videos/${videoId}/draft/${fileId}`,
  )
  db.prepare(`INSERT INTO draft (
    id, video_id, media_file_id, version, duration_ms, created_by_user_id, created_at
  ) VALUES (?, ?, ?, 1, 2000, 'user-1', 1)`).run(draftId, videoId, fileId)
}

const draft: Draft = {
  id: draftId,
  videoId,
  version: 1,
  durationMs: 2000,
  compactMp4: { state: 'queued', byteSize: null },
  stream: { state: 'queued', uid: null, playbackUrl: null, thumbnailUrl: null },
  file: {
    id: fileId, videoId, purpose: 'draft', displayName: 'v1.mp4',
    byteSize: 20, contentType: 'video/mp4', createdAt: 1, updatedAt: 1,
  },
  author: { id: 'user-1', name: 'Studio User', email: 'studio@example.com' },
  createdAt: 1,
  shareToken: 'a'.repeat(64),
}

describe('guest draft review migration', () => {
  it('copies existing comments then accepts guest authors and pinned draft shares', () => {
    const db = new DatabaseSync(':memory:')
    const prior = readdirSync(resolve(process.cwd(), 'migrations'))
      .filter((name) => name.endsWith('.sql') && name < '0012_guest_draft_review.sql')
      .sort()
    applyMigrations(db, prior)
    seedDraft(db)
    db.prepare(`INSERT INTO review_comment (
      id, video_id, draft_id, author_user_id, anchor_kind, start_ms, end_ms, body_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'user-1', 'point', 250, NULL, '{"type":"doc","content":[]}', 1, 1)`).run(commentId, videoId, draftId)
    applyMigrations(db, ['0012_guest_draft_review.sql'])
    const migrated = db.prepare('SELECT author_user_id, guest_email, parent_id, resolved_at FROM review_comment WHERE id = ?').get(commentId)
    expect(migrated).toEqual({ author_user_id: 'user-1', guest_email: null, parent_id: null, resolved_at: null })
    const guestId = crypto.randomUUID()
    db.prepare(`INSERT INTO review_comment (
      id, video_id, draft_id, author_user_id, guest_email, guest_name, parent_id, resolved_at,
      anchor_kind, start_ms, end_ms, body_json, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 'alex@example.com', 'Alex', ?, NULL, 'point', 500, NULL, '{"type":"doc","content":[]}', 1, 1)`).run(
      guestId, videoId, draftId, commentId,
    )
    expect(db.prepare('SELECT guest_email, parent_id FROM review_comment WHERE id = ?').get(guestId)).toEqual({
      guest_email: 'alex@example.com', parent_id: commentId,
    })
    db.prepare(`INSERT INTO draft_review_share (draft_id, video_id, token, created_by_user_id, created_at)
      VALUES (?, ?, ?, 'user-1', 1)`).run(draftId, videoId, 'b'.repeat(64))
    expect(db.prepare('SELECT length(token) AS n FROM draft_review_share').get()).toEqual({ n: 64 })
    expect(() => db.prepare(`INSERT INTO review_comment (
      id, video_id, draft_id, author_user_id, guest_email, guest_name, parent_id, resolved_at,
      anchor_kind, start_ms, end_ms, body_json, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'point', 1, NULL, '{"type":"doc","content":[]}', 1, 1)`).run(
      crypto.randomUUID(), videoId, draftId,
    )).toThrow()
    db.close()
  })
})

describe('guest review page', () => {
  it('shows a revoked message and never offers download', () => {
    const revoked = renderToStaticMarkup(createElement(GuestReviewPage, {
      token: 'a'.repeat(64),
      data: { available: false },
    }))
    expect(revoked).toContain('Link no longer available')
    expect(revoked).not.toContain('download=')
    const token = 'a'.repeat(64)
    const live = renderToStaticMarkup(createElement(GuestReviewPage, {
      token,
      data: { available: true, videoTitle: 'Guest cut', draft, comments: [] },
    }))
    expect(live).toContain(`data-playback-src="/api/shared-reviews/${token}"`)
    expect(live).toContain(`data-fallback-src="/api/shared-reviews/${token}"`)
    expect(live).toContain('Email')
    expect(live).toContain('Continue as guest')
    expect(live).not.toContain('Download')
    expect(live).not.toContain('?download')
    expect(guestReviewPlaybackSrc(token, draft)).toBe(`/api/shared-reviews/${token}`)
  })

  it('keeps progressive fallback when the guest page plays a Stream-ready draft', () => {
    const token = 'a'.repeat(64)
    const playbackUrl = 'https://customer-test.cloudflarestream.com/tok/manifest/video.m3u8'
    const live = renderToStaticMarkup(createElement(GuestReviewPage, {
      token,
      data: {
        available: true,
        videoTitle: 'Guest cut',
        draft: {
          ...draft,
          stream: { state: 'ready', uid: 'stream-1', playbackUrl, thumbnailUrl: null },
        },
        comments: [],
      },
    }))
    expect(live).toContain(`data-playback-src="${playbackUrl}"`)
    expect(live).toContain(`data-fallback-src="/api/shared-reviews/${token}"`)
    expect(guestReviewPlaybackSrc(token, { ...draft, stream: { state: 'ready', uid: 'stream-1', playbackUrl, thumbnailUrl: null } })).toBe(playbackUrl)
  })

  it('sends only the origin from the guest page and keeps no-referrer on shared media', () => {
    const reviews = readFileSync(resolve(process.cwd(), 'src/server/reviews.functions.ts'), 'utf8')
    const media = readFileSync(resolve(process.cwd(), 'src/server/media-http.server.ts'), 'utf8')
    expect(reviews).toContain("setResponseHeader('Referrer-Policy', 'strict-origin')")
    expect(reviews).not.toMatch(/loadSharedReview[\s\S]*?setResponseHeader\('Referrer-Policy', 'no-referrer'\)/)
    expect(media).toContain("'Referrer-Policy': 'no-referrer'")
  })
})
