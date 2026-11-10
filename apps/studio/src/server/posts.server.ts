import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  canMarkReady,
  duplicateAsDraft,
  getPost,
  listPosts,
  parseAlt,
  parsePostBody,
  parsePostId,
  parsePostItemId,
  parsePostMediaId,
  parsePostRevision,
  parsePostTarget,
  postObjectKey,
  type PostDraft,
  type PostSummary,
} from '#/domain/posts'

const bindings = env as Cloudflare.Env & { DB: D1Database; MEDIA: R2Bucket }

export type SavePostResult =
  | { kind: 'saved'; draft: PostDraft }
  | { kind: 'conflict'; latest: PostDraft }
  | { kind: 'not-found' }
  | { kind: 'posted' }

export type ReadyPostResult =
  | { kind: 'ready'; draft: PostDraft }
  | { kind: 'invalid'; draft: PostDraft }
  | { kind: 'conflict'; latest: PostDraft }
  | { kind: 'not-found' }
  | { kind: 'posted' }

type SaveItem = Readonly<{
  id: string
  body: string
  media: ReadonlyArray<{ id: string; alt: string | null }>
}>

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

export function parseSavePostInput(value: unknown): {
  id: string
  expectedRevision: number
  target: PostDraft['target']
  xPremium: boolean
  items: readonly SaveItem[]
} {
  const input = asRecord(value, 'Save data is required.')
  const items = input.items
  if (!Array.isArray(items) || items.length < 1) throw new Error('A draft needs at least one post.')
  return {
    id: parsePostId(input.id),
    expectedRevision: parsePostRevision(input.expectedRevision),
    target: parsePostTarget(input.target),
    xPremium: input.xPremium === true,
    items: items.map((item) => {
      const row = asRecord(item, 'Post data is required.')
      const media = row.media
      if (!Array.isArray(media)) throw new Error('Post media is required.')
      return {
        id: parsePostItemId(row.id),
        body: parsePostBody(row.body),
        media: media.map((file) => {
          const mediaRow = asRecord(file, 'Media data is required.')
          return { id: parsePostMediaId(mediaRow.id), alt: parseAlt(mediaRow.alt) }
        }),
      }
    }),
  }
}

async function loadDraft(id: string): Promise<PostDraft | null> {
  const draft = await bindings.DB.prepare('SELECT * FROM post_draft WHERE id = ?').bind(id).first()
  if (!draft) return null
  const posts = await bindings.DB.prepare(
    'SELECT id, position, body FROM post WHERE draft_id = ? ORDER BY position ASC',
  ).bind(id).all()
  const media = await bindings.DB.prepare(
    `SELECT m.id, m.post_id, m.position, m.object_key, m.display_name, m.byte_size,
            m.content_type, m.duration_ms, m.alt, m.created_at
     FROM post_media m JOIN post p ON p.id = m.post_id
     WHERE p.draft_id = ?`,
  ).bind(id).all()
  const publications = await bindings.DB.prepare(
    'SELECT platform, post_ids_json, urls_json, posted_at FROM post_publication WHERE draft_id = ?',
  ).bind(id).all()
  return getPost({
    draft,
    posts: posts.results,
    media: media.results,
    publications: publications.results,
  })
}

export async function listPostDrafts(): Promise<readonly PostSummary[]> {
  const rows = await bindings.DB.prepare(`
    SELECT d.id, d.target, d.x_premium, d.status, d.revision, d.updated_at,
           (SELECT count(*) FROM post p WHERE p.draft_id = d.id) AS post_count,
           (SELECT body FROM post p WHERE p.draft_id = d.id ORDER BY position ASC LIMIT 1) AS body
    FROM post_draft d
    ORDER BY d.updated_at DESC, d.id ASC
  `).all()
  return listPosts(rows.results)
}

export async function getPostDraft(id: string): Promise<PostDraft | null> {
  return loadDraft(parsePostId(id))
}

export async function createPostDraft(userId: string): Promise<PostDraft> {
  const id = parsePostId(crypto.randomUUID())
  const postId = parsePostItemId(crypto.randomUUID())
  const now = Date.now()
  await bindings.DB.batch([
    bindings.DB.prepare(`
      INSERT INTO post_draft (id, target, x_premium, status, revision, updated_by_user_id, created_at, updated_at)
      VALUES (?, 'both', 0, 'draft', 1, ?, ?, ?)
    `).bind(id, userId, now, now),
    bindings.DB.prepare('INSERT INTO post (id, draft_id, position, body) VALUES (?, ?, 0, ?)').bind(postId, id, ''),
  ])
  const draft = await loadDraft(id)
  if (!draft) throw new Error('Created draft could not be loaded.')
  return draft
}

async function latestOrMissing(id: string, expectedRevision: number): Promise<SavePostResult> {
  const latest = await loadDraft(id)
  if (!latest) return { kind: 'not-found' }
  if (latest.status === 'posted') return { kind: 'posted' }
  return latest.revision === expectedRevision ? { kind: 'not-found' } : { kind: 'conflict', latest }
}

export async function savePostDraft(input: ReturnType<typeof parseSavePostInput>, userId: string): Promise<SavePostResult> {
  const current = await loadDraft(input.id)
  if (!current) return { kind: 'not-found' }
  if (current.status === 'posted') return { kind: 'posted' }
  const now = Date.now()
  const keepMedia = new Set(input.items.flatMap((item) => item.media.map((file) => file.id)))
  const removedMedia = current.items.flatMap((item) => item.media).filter((file) => !keepMedia.has(file.id))
  const claimed = await bindings.DB.prepare(`
    UPDATE post_draft
    SET target = ?, x_premium = ?, status = 'draft', revision = revision + 1,
        updated_by_user_id = ?, updated_at = ?
    WHERE id = ? AND revision = ? AND status != 'posted'
  `).bind(input.target, input.xPremium ? 1 : 0, userId, now, input.id, input.expectedRevision).run()
  if (claimed.meta.changes !== 1) return latestOrMissing(input.id, input.expectedRevision)
  const statements = [
    bindings.DB.prepare(
      `DELETE FROM post WHERE draft_id = ? AND id NOT IN (${input.items.map(() => '?').join(', ')})`,
    ).bind(input.id, ...input.items.map((item) => item.id)),
  ]
  input.items.forEach((item, position) => {
    const owned = new Set(current.items.find((row) => row.id === item.id)?.media.map((file) => file.id) ?? [])
    statements.push(bindings.DB.prepare(`
      INSERT INTO post (id, draft_id, position, body) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET position = excluded.position, body = excluded.body
      WHERE post.draft_id = excluded.draft_id
    `).bind(item.id, input.id, position, item.body))
    const previousMedia = current.items.find((row) => row.id === item.id)?.media.map((file) => file.id) ?? []
    const removedIds = previousMedia.filter((id) => !item.media.some((file) => file.id === id))
    if (removedIds.length > 0) {
      statements.push(bindings.DB.prepare(
        `DELETE FROM post_media WHERE post_id = ? AND id IN (${removedIds.map(() => '?').join(', ')})`,
      ).bind(item.id, ...removedIds))
    }
    item.media.forEach((file, order) => {
      if (!owned.has(file.id)) return
      statements.push(bindings.DB.prepare(
        'UPDATE post_media SET position = ?, alt = ? WHERE id = ? AND post_id = ?',
      ).bind(order, file.alt, file.id, item.id))
    })
  })
  await bindings.DB.batch(statements)
  await Promise.all(removedMedia.map((file) => bindings.MEDIA.delete(file.objectKey).catch(() => undefined)))
  const draft = await loadDraft(input.id)
  if (!draft) return { kind: 'not-found' }
  return { kind: 'saved', draft }
}

export async function markPostReady(id: string, expectedRevision: number): Promise<ReadyPostResult> {
  const current = await loadDraft(parsePostId(id))
  if (!current) return { kind: 'not-found' }
  if (current.status === 'posted') return { kind: 'posted' }
  if (current.revision !== expectedRevision) return { kind: 'conflict', latest: current }
  if (!canMarkReady(current)) return { kind: 'invalid', draft: current }
  const now = Date.now()
  const result = await bindings.DB.prepare(`
    UPDATE post_draft SET status = 'ready', revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ? AND status != 'posted'
  `).bind(now, id, expectedRevision).run()
  if (result.meta.changes !== 1) {
    const missed = await latestOrMissing(id, expectedRevision)
    if (missed.kind === 'conflict' || missed.kind === 'not-found' || missed.kind === 'posted') return missed
    return { kind: 'not-found' }
  }
  const draft = await loadDraft(id)
  if (!draft) return { kind: 'not-found' }
  return { kind: 'ready', draft }
}

export async function duplicatePostDraft(id: string, userId: string): Promise<PostDraft | null> {
  const source = await loadDraft(parsePostId(id))
  if (!source) return null
  const copyId = parsePostId(crypto.randomUUID())
  const items = source.items.map((item) => ({
    id: parsePostItemId(crypto.randomUUID()),
    mediaIds: item.media.map(() => parsePostMediaId(crypto.randomUUID())),
  }))
  const copy = duplicateAsDraft(source, { draftId: copyId, items }, Date.now(), userId)
  const statements = [
    bindings.DB.prepare(`
      INSERT INTO post_draft (id, target, x_premium, status, revision, updated_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', 1, ?, ?, ?)
    `).bind(copy.id, copy.target, copy.xPremium ? 1 : 0, userId, copy.createdAt, copy.updatedAt),
  ]
  for (const item of copy.items) {
    statements.push(bindings.DB.prepare(
      'INSERT INTO post (id, draft_id, position, body) VALUES (?, ?, ?, ?)',
    ).bind(item.id, copy.id, item.order, item.body))
    for (const file of item.media) {
      statements.push(bindings.DB.prepare(`
        INSERT INTO post_media (
          id, post_id, position, object_key, display_name, byte_size, content_type, duration_ms, alt, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        file.id, item.id, file.order, file.objectKey, file.displayName, file.byteSize,
        file.mime, file.durationMs, file.alt, copy.createdAt,
      ))
    }
  }
  await bindings.DB.batch(statements)
  for (const [index, item] of source.items.entries()) {
    for (const [mediaIndex, file] of item.media.entries()) {
      const next = copy.items[index]?.media[mediaIndex]
      if (!next) continue
      const object = await bindings.MEDIA.get(file.objectKey)
      if (!object) continue
      await bindings.MEDIA.put(next.objectKey, object.body, {
        httpMetadata: object.httpMetadata,
        customMetadata: { source: file.objectKey },
      })
    }
  }
  const draft = await loadDraft(copy.id)
  if (!draft) throw new Error('Duplicated draft could not be loaded.')
  return draft
}

export async function attachPostMedia(input: {
  draftId: string
  postId: string
  media: {
    id: string
    objectKey: string
    displayName: string
    byteSize: number
    contentType: string
    durationMs: number | null
  }
}): Promise<PostDraft | null> {
  const draft = await loadDraft(input.draftId)
  if (!draft || draft.status === 'posted') return draft
  const post = draft.items.find((item) => item.id === input.postId)
  if (!post) return null
  const position = post.media.length
  const now = Date.now()
  await bindings.DB.prepare(`
    INSERT INTO post_media (
      id, post_id, position, object_key, display_name, byte_size, content_type, duration_ms, alt, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).bind(
    input.media.id, input.postId, position, input.media.objectKey, input.media.displayName,
    input.media.byteSize, input.media.contentType, input.media.durationMs, now,
  ).run()
  return loadDraft(input.draftId)
}

export { postObjectKey }
