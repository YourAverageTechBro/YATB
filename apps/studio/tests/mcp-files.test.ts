import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  FILE_KINDS,
  contentTypeFilter,
  parseListFilesInput,
  parseSetFileTagsInput,
  parseTag,
  parseTags,
} from '../src/domain/mcp-files'
import { parseBeginUpload } from '../src/domain/media'
import { parseMcpScopes } from '../src/domain/mcp-tokens'

const ids = {
  user: '6c04e985-3580-4ea9-9c4e-5af7d30ca441',
  video: '1b0e913b-645c-4306-a71d-78115390b46d',
  file: '28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27',
  draft: '3879b960-ec74-4c13-b823-c6d32cb15b7d',
  postDraft: '4b0e913b-645c-4306-a71d-78115390b46d',
  post: '5b0e913b-645c-4306-a71d-78115390b46d',
  media: '6b0e913b-645c-4306-a71d-78115390b46d',
} as const

describe('file tags and list filters', () => {
  it('normalizes, dedupes, and caps tags', () => {
    expect(parseTag(' B-Roll ')).toBe('b-roll')
    expect(parseTags(['Product Shot', 'product shot', ' b-roll '])).toEqual(['product shot', 'b-roll'])
    expect(() => parseTags(['x'.repeat(41)])).toThrow(/40/)
    expect(() => parseTags(Array.from({ length: 21 }, (_, index) => `tag-${index}`))).toThrow(/20/)
    expect(() => parseListFilesInput({ kind: 'clip' })).toThrow()
    expect(parseListFilesInput({ kind: 'footage', page: 2, limit: 10 })).toEqual({
      kind: 'footage',
      video_id: undefined,
      post_id: undefined,
      tag: undefined,
      name: undefined,
      content_type: undefined,
      created_after: undefined,
      created_before: undefined,
      page: 2,
      limit: 10,
    })
    expect(contentTypeFilter('video/')).toEqual({ prefix: 'video/' })
    expect(contentTypeFilter('image')).toEqual({ prefix: 'image/' })
    expect(contentTypeFilter('video/mp4')).toEqual({ exact: 'video/mp4' })
    expect(parseSetFileTagsInput({
      id: ids.file,
      kind: 'footage',
      tags: [' B-Roll ', 'b-roll'],
    })).toEqual({ id: ids.file, kind: 'footage', tags: ['b-roll'] })
  })

  it('stores optional footage duration on begin upload without changing draft rules', () => {
    const footage = parseBeginUpload({
      videoId: ids.video,
      clientRequestId: ids.file,
      displayName: 'take.mp4',
      byteSize: 20,
      contentType: 'video/mp4',
      purpose: { kind: 'footage' },
      durationMs: 1500,
    })
    expect(footage.durationMs).toBe(1500)
    expect(parseBeginUpload({
      videoId: ids.video,
      clientRequestId: ids.file,
      displayName: 'take.mp4',
      byteSize: 20,
      contentType: 'video/mp4',
      purpose: { kind: 'footage' },
    }).durationMs).toBeNull()
  })

  it('exposes files scopes as mintable names', () => {
    expect(parseMcpScopes(['files:write', 'files:read'])).toEqual(['files:read', 'files:write'])
    expect(FILE_KINDS).toEqual(['footage', 'review_cut', 'post_media'])
  })
})

describe('0016_file_catalog.sql', () => {
  it('tags the three catalog kinds and stores footage duration', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    const dir = resolve(process.cwd(), 'migrations')
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
      db.exec(readFileSync(resolve(dir, file), 'utf8'))
    }
    db.prepare('INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, 1, 1)')
      .run(ids.user, 'T', 'files@youraveragetechbro.com')
    db.prepare(`INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
      VALUES (?, 'Cut', 'short', 'organic', 'filming', '{"type":"doc","content":[]}', 1, 1, 1)`).run(ids.video)
    const upload = crypto.randomUUID()
    db.prepare(`INSERT INTO upload_session (
      id, video_id, created_by_user_id, client_request_id, file_id, object_key, display_name, byte_size,
      content_type, part_size, part_count, state, purpose, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'take.mp4', 20, 'video/mp4', 33554432, 1, 'ready', 'footage', 1, 1)`).run(
      upload, ids.video, ids.user, crypto.randomUUID(), ids.file, `videos/${ids.video}/footage/${ids.file}`,
    )
    db.prepare(`INSERT INTO media_file (
      id, video_id, created_by_user_id, upload_session_id, object_key, display_name, byte_size,
      content_type, object_etag, purpose, created_at, updated_at, duration_ms
    ) VALUES (?, ?, ?, ?, ?, 'take.mp4', 20, 'video/mp4', 'etag', 'footage', 1, 1, 1500)`).run(
      ids.file, ids.video, ids.user, upload, `videos/${ids.video}/footage/${ids.file}`,
    )
    db.prepare('INSERT INTO file_tag (kind, file_id, tag) VALUES (?, ?, ?)').run('footage', ids.file, 'b-roll')
    expect(() => db.prepare('INSERT INTO file_tag (kind, file_id, tag) VALUES (?, ?, ?)').run('footage', ids.file, 'B-Roll'))
      .toThrow()
    db.prepare(`INSERT INTO post_draft (id, target, x_premium, status, revision, updated_by_user_id, created_at, updated_at)
      VALUES (?, 'x', 0, 'draft', 1, ?, 1, 1)`).run(ids.postDraft, ids.user)
    db.prepare('INSERT INTO post (id, draft_id, position, body) VALUES (?, ?, 0, ?)').run(ids.post, ids.postDraft, 'hello')
    db.prepare(`INSERT INTO post_media (
      id, post_id, position, object_key, display_name, byte_size, content_type, duration_ms, alt, created_at
    ) VALUES (?, ?, 0, ?, 'clip.mp4', 20, 'video/mp4', 900, NULL, 1)`).run(
      ids.media, ids.post, `posts/${ids.post}/${ids.media}`,
    )
    const footage = db.prepare('SELECT duration_ms FROM media_file WHERE id = ?').get(ids.file) as { duration_ms: number }
    expect(footage.duration_ms).toBe(1500)
    const tagged = db.prepare('SELECT tag FROM file_tag WHERE kind = ? AND file_id = ?').get('footage', ids.file) as { tag: string }
    expect(tagged.tag).toBe('b-roll')
  })
})
