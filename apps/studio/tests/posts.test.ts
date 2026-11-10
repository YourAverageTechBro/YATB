import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { parseTweet } from 'twitter-text'
import {
  canMarkReady,
  countThreads,
  countX,
  duplicateAsDraft,
  evaluateComposer,
  getPost,
  listPosts,
  markPosted,
  parsePostId,
  publicationUrl,
  rejectPostUpload,
  threadsHashtags,
  type PostDraft,
  type PostItem,
  type PostMedia,
} from '../src/domain/posts'

const ids = {
  draft: '1b0e913b-645c-4306-a71d-78115390b46d',
  post: '28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27',
  post2: '3879b960-ec74-4c13-b823-c6d32cb15b7d',
  media: '4a686415-fc7e-47ec-818b-775817a66c7e',
  media2: '5b93d874-2479-4d98-8b3d-49e6c2fb9330',
  user: '6c04e985-3580-4ea9-9c4e-5af7d30ca441',
  copy: '7d15fa96-4691-4fba-ad5f-6b08e41db552',
  copyPost: '8e26gb07-57a2-40cb-be60-7c19f52ec663',
} as const

function media(partial: Partial<PostMedia> & Pick<PostMedia, 'id'>): PostMedia {
  return {
    order: 0,
    mime: 'image/jpeg',
    alt: 'A cat',
    byteSize: 1000,
    durationMs: null,
    objectKey: `posts/${ids.draft}/${partial.id}`,
    displayName: 'cat.jpg',
    ...partial,
  }
}

function item(partial: Partial<PostItem> = {}): PostItem {
  return { id: ids.post, order: 0, body: 'Hello from Studio.', media: [], ...partial }
}

function draft(partial: Partial<PostDraft> = {}): PostDraft {
  return {
    id: ids.draft,
    target: 'both',
    xPremium: false,
    status: 'ready',
    revision: 1,
    items: [item()],
    publications: [],
    updatedByUserId: ids.user,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

describe('X counting via twitter-text parseTweet', () => {
  it('counts a t.co-weighted URL, not the raw href length', () => {
    const url = 'https://example.com/this/is/a/very/long/path/that/would-blow-a-naive-count'
    const counted = countX(url, false)
    expect(counted.used).toBe(parseTweet(url).weightedLength)
    expect(counted.used).toBeLessThan(url.length)
    expect(counted.over).toBe(false)
  })

  it('weights CJK above latin and treats a ZWJ sequence as twitter-text does', () => {
    const cjk = '漢字漢字'
    expect(countX(cjk, false).used).toBe(parseTweet(cjk).weightedLength)
    expect(countX(cjk, false).used).toBeGreaterThan(cjk.length)
    const flag = '🇯🇵'
    const family = '👨‍👩‍👧‍👦'
    expect(countX(flag, false).used).toBe(parseTweet(flag).weightedLength)
    expect(countX(family, false).used).toBe(parseTweet(family).weightedLength)
  })

  it('uses 280 unless Premium long post raises the parseTweet max to 25000', () => {
    const text = 'a'.repeat(281)
    expect(countX(text, false)).toMatchObject({ limit: 280, over: true })
    expect(countX(text, true)).toMatchObject({ limit: 25_000, over: false })
    expect(countX('a'.repeat(25_001), true).over).toBe(true)
  })
})

describe('Threads counting', () => {
  it('counts every code point, including the full URL', () => {
    const url = 'https://example.com/this/is/a/very/long/path/that/would-blow-a-naive-count'
    expect(countThreads(url).used).toBe([...url].length)
    expect(countThreads(url).used).toBe(url.length)
  })

  it('counts ZWJ emoji, flags, CJK, and NFC vs NFD as code points', () => {
    expect(countThreads('👨‍👩‍👧‍👦').used).toBe([...'👨‍👩‍👧‍👦'].length)
    expect(countThreads('🇯🇵').used).toBe([...'🇯🇵'].length)
    expect(countThreads('漢字').used).toBe(2)
    const nfc = 'é'
    const nfd = 'e\u0301'
    expect(countThreads(nfc).used).toBe(1)
    expect(countThreads(nfd).used).toBe(2)
    expect(nfc.normalize('NFC')).toBe(nfd.normalize('NFC'))
  })

  it('warns when a post has more than one hashtag', () => {
    expect(threadsHashtags('#one and #two')).toEqual(['one', 'two'])
    const report = evaluateComposer(draft({
      items: [item({ body: '#one talk #two' })],
    }))
    expect(report.issues.some((issue) => issue.code === 'extra-hashtags' && issue.severity === 'warning')).toBe(true)
    expect(canMarkReady(draft({ items: [item({ body: '#one talk #two' })] }))).toBe(true)
  })
})

describe('media rules', () => {
  it('rejects X mix of images and video, oversized files, and long video', () => {
    expect(rejectPostUpload({ target: 'x', mime: 'image/jpeg', byteSize: 5 * 1024 * 1024 + 1, durationMs: null })).toMatch(/5 MB/)
    expect(rejectPostUpload({ target: 'threads', mime: 'image/jpeg', byteSize: 6 * 1024 * 1024, durationMs: null })).toBeNull()
    expect(rejectPostUpload({ target: 'x', mime: 'video/mp4', byteSize: 1000, durationMs: 141_000 })).toMatch(/140/)
    const mixed = draft({
      items: [item({
        media: [
          media({ id: ids.media, mime: 'image/jpeg' }),
          media({ id: ids.media2, mime: 'video/mp4', durationMs: 1000, order: 1 }),
        ],
      })],
    })
    expect(evaluateComposer(mixed).issues.some((issue) => issue.code === 'x-media-mix')).toBe(true)
    expect(canMarkReady(mixed)).toBe(false)
  })

  it('allows four X images and twenty Threads items, and warns on missing alt', () => {
    const images = [0, 1, 2, 3].map((order) => media({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${order}`,
      order,
    }))
    expect(canMarkReady(draft({ items: [item({ media: images })] }))).toBe(true)
    const five = [...images, media({ id: ids.media2, order: 4 })]
    expect(canMarkReady(draft({ items: [item({ media: five })] }))).toBe(false)
    const carousel = Array.from({ length: 20 }, (_, order) => media({
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(order).padStart(12, '0')}`,
      order,
    }))
    expect(canMarkReady(draft({ target: 'threads', items: [item({ media: carousel })] }))).toBe(true)
    expect(canMarkReady(draft({
      target: 'threads',
      items: [item({ media: [...carousel, media({ id: ids.media2, order: 20 })] })],
    }))).toBe(false)
    const missingAlt = draft({ items: [item({ media: [media({ id: ids.media, alt: null })] })] })
    expect(evaluateComposer(missingAlt).issues.some((issue) => issue.code === 'missing-alt')).toBe(true)
    expect(canMarkReady(missingAlt)).toBe(true)
  })
})

describe('listPosts, getPost, markPosted', () => {
  it('parses list rows and a full draft, then records platform ids without a posting action', () => {
    const summaries = listPosts([{
      id: ids.draft,
      target: 'both',
      x_premium: 0,
      status: 'ready',
      revision: 2,
      post_count: 2,
      body: 'Hello from Studio.',
      updated_at: 9,
    }])
    expect(summaries).toEqual([{
      id: ids.draft,
      target: 'both',
      xPremium: false,
      status: 'ready',
      revision: 2,
      postCount: 2,
      preview: 'Hello from Studio.',
      updatedAt: 9,
    }])
    const loaded = getPost({
      draft: {
        id: ids.draft,
        target: 'x',
        x_premium: 1,
        status: 'ready',
        revision: 1,
        updated_by_user_id: ids.user,
        created_at: 1,
        updated_at: 2,
      },
      posts: [
        { id: ids.post2, position: 1, body: 'Second' },
        { id: ids.post, position: 0, body: 'First' },
      ],
      media: [{
        id: ids.media,
        post_id: ids.post,
        position: 0,
        object_key: 'posts/key',
        display_name: 'a.jpg',
        byte_size: 12,
        content_type: 'image/jpeg',
        duration_ms: null,
        alt: 'alt',
        created_at: 1,
      }],
      publications: [],
    })
    expect(loaded.items.map((entry) => entry.body)).toEqual(['First', 'Second'])
    expect(loaded.items[0]?.media[0]?.objectKey).toBe('posts/key')
    const posted = markPosted(loaded, 'x', ['111', '222'], 50)
    expect(posted.kind).toBe('ok')
    if (posted.kind !== 'ok') return
    expect(posted.draft.status).toBe('posted')
    expect(posted.draft.publications[0]).toEqual({
      platform: 'x',
      postIds: ['111', '222'],
      urls: [publicationUrl('x', '111'), publicationUrl('x', '222')],
      postedAt: 50,
    })
    expect(markPosted(loaded, 'threads', ['111', '222'], 50).kind).toBe('invalid')
    expect(markPosted(draft({ status: 'draft' }), 'x', ['111'], 1).kind).toBe('invalid')
  })

  it('stays ready until every selected platform has ids, and duplicateAsDraft clears publications', () => {
    const both = draft({ target: 'both', items: [item(), item({ id: ids.post2, order: 1, body: 'Two' })] })
    const xOnly = markPosted(both, 'x', ['a', 'b'], 3)
    expect(xOnly.kind).toBe('ok')
    if (xOnly.kind !== 'ok') return
    expect(xOnly.draft.status).toBe('ready')
    const done = markPosted(xOnly.draft, 'threads', ['c', 'd'], 4)
    expect(done.kind).toBe('ok')
    if (done.kind !== 'ok') return
    expect(done.draft.status).toBe('posted')
    const copy = duplicateAsDraft(done.draft, {
      draftId: ids.copy,
      items: [
        { id: ids.copyPost, mediaIds: [] },
        { id: '9f370c18-68b3-41dc-8f71-8d20a63fd774', mediaIds: [] },
      ],
    }, 8, ids.user)
    expect(copy.status).toBe('draft')
    expect(copy.publications).toEqual([])
    expect(copy.items.map((entry) => entry.body)).toEqual(['Hello from Studio.', 'Two'])
  })
})

describe('0014_posts.sql', () => {
  it('creates the MCP-stable tables on D1-shaped sqlite', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" ("id" TEXT PRIMARY KEY NOT NULL);')
    db.exec(readFileSync(resolve(process.cwd(), 'migrations/0014_posts.sql'), 'utf8'))
    db.prepare('INSERT INTO "user" ("id") VALUES (?)').run(ids.user)
    db.prepare(`INSERT INTO post_draft (
      id, target, x_premium, status, revision, updated_by_user_id, created_at, updated_at
    ) VALUES (?, 'both', 0, 'draft', 1, ?, 1, 1)`).run(ids.draft, ids.user)
    db.prepare('INSERT INTO post (id, draft_id, position, body) VALUES (?, ?, 0, ?)').run(ids.post, ids.draft, 'Hello')
    const row = db.prepare(`
      SELECT d.id, d.target, d.x_premium, d.status, d.revision, d.updated_at,
             (SELECT count(*) FROM post p WHERE p.draft_id = d.id) AS post_count,
             (SELECT body FROM post p WHERE p.draft_id = d.id ORDER BY position LIMIT 1) AS body
      FROM post_draft d
    `).get()
    expect(listPosts([row])[0]?.preview).toBe('Hello')
    expect(parsePostId(ids.draft)).toBe(ids.draft)
  })
})
