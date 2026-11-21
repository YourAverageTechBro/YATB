import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { UPLOAD_PART_SIZE } from '../src/domain/media'
import {
  guestReviewUrl,
  parseCreateGuestLinkInput,
  parseListVideoCommentsInput,
} from '../src/domain/mcp-videos'
import { isMcpScope } from '../src/domain/mcp-tokens'
import { handleStudioMcp } from '../src/server/mcp.server'
import { createMcpToken } from '../src/server/mcp-tokens.server'
import { d1, ids, migratedDatabase, seedDraft } from './support/draft-ai-db'

const runtime = vi.hoisted(() => ({ env: {} as Record<string, unknown> }))

vi.mock('@tanstack/react-start/server-only', () => ({}))
vi.mock('cloudflare:workers', () => ({ env: runtime.env }))

const origin = 'https://studio.youraveragetechbro.com'
const emptyVideoId = '2b0e913b-645c-4306-a71d-78115390b46d'
const missingVideoId = '9b0e913b-645c-4306-a71d-78115390b46d'
const draftV2 = '6b0e913b-645c-4306-a71d-78115390b46d'
const fileV2 = '8b0e913b-645c-4306-a71d-78115390b46d'
const userCommentId = 'a1e0913b-645c-4306-a71d-78115390b46d'
const guestCommentId = 'a2e0913b-645c-4306-a71d-78115390b46d'
const replyId = 'a3e0913b-645c-4306-a71d-78115390b46d'
const resolvedId = 'a4e0913b-645c-4306-a71d-78115390b46d'
const v2CommentId = 'a5e0913b-645c-4306-a71d-78115390b46d'

function useEnv(db: DatabaseSync) {
  for (const key of Object.keys(runtime.env)) delete runtime.env[key]
  Object.assign(runtime.env, {
    DB: d1(db),
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: 'prove-it-works-secret-at-least-32-chars',
  })
}

function bodyJson(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

function addDraftVersion(db: DatabaseSync, draftId: string, fileId: string, version: number) {
  const uploadId = crypto.randomUUID()
  const objectKey = `videos/${ids.video}/drafts/${fileId}`
  db.prepare(`INSERT INTO upload_session (
    id, video_id, created_by_user_id, client_request_id, file_id, object_key,
    display_name, byte_size, content_type, part_size, part_count, state, purpose,
    draft_id, draft_duration_ms, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'v2.mp4', 20, 'video/mp4', ?, 1, 'ready', 'draft', ?, 5000, 1, 1)`).run(
    uploadId, ids.video, ids.user, crypto.randomUUID(), fileId, objectKey, UPLOAD_PART_SIZE, draftId,
  )
  db.prepare(`INSERT INTO media_file (
    id, video_id, created_by_user_id, upload_session_id, object_key, display_name,
    byte_size, content_type, object_etag, purpose, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'v2.mp4', 20, 'video/mp4', 'etag', 'draft', 1, 1)`).run(
    fileId, ids.video, ids.user, uploadId, objectKey,
  )
  db.prepare(`INSERT INTO draft (
    id, video_id, media_file_id, version, duration_ms, created_by_user_id, created_at
  ) VALUES (?, ?, ?, ?, 5000, ?, 2)`).run(draftId, ids.video, fileId, version, ids.user)
}

function addComment(
  db: DatabaseSync,
  row: {
    id: string
    draftId: string
    createdAt: number
    text: string
    startMs?: number
    parentId?: string | null
    resolvedAt?: number | null
    guest?: { email: string; name: string }
  },
) {
  db.prepare(`INSERT INTO review_comment (
    id, video_id, draft_id, author_user_id, guest_email, guest_name, parent_id, resolved_at,
    anchor_kind, start_ms, end_ms, body_json, revision, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'point', ?, NULL, ?, 1, ?, ?)`).run(
    row.id,
    ids.video,
    row.draftId,
    row.guest ? null : ids.user,
    row.guest?.email ?? null,
    row.guest?.name ?? null,
    row.parentId ?? null,
    row.resolvedAt ?? null,
    row.startMs ?? 250,
    bodyJson(row.text),
    row.createdAt,
    row.createdAt,
  )
}

function seedComments(db: DatabaseSync) {
  addComment(db, { id: userCommentId, draftId: ids.draft, createdAt: 30, text: 'Trim the intro', startMs: 250 })
  addComment(db, {
    id: guestCommentId, draftId: ids.draft, createdAt: 10, text: 'Guest note', startMs: 400,
    guest: { email: 'alex@example.com', name: 'Alex' },
  })
  addComment(db, {
    id: replyId, draftId: ids.draft, createdAt: 40, text: 'Will trim', startMs: 250, parentId: userCommentId,
  })
  addComment(db, {
    id: resolvedId, draftId: ids.draft, createdAt: 20, text: 'Resolved beat', startMs: 100, resolvedAt: 50,
  })
}

async function mcpFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init)
  return handleStudioMcp(request)
}

async function withClient<T>(bearer: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'mcp-guest-review-test', version: '0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    authProvider: { token: async () => bearer },
    fetch: mcpFetch,
  })
  await client.connect(transport)
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

function parseTool(result: { isError?: boolean; content?: Array<{ type: string; text?: string }> }) {
  const text = result.content?.find((part) => part.type === 'text')?.text
  if (!text) throw new Error('Tool result had no text')
  return { isError: result.isError === true, body: JSON.parse(text) as Record<string, unknown> }
}

async function mint(scopes: string[]) {
  return createMcpToken('test', scopes, ids.user)
}

describe('MCP guest review parsing', () => {
  it('defaults include_resolved to true and builds the guest URL from APP_ORIGIN', () => {
    expect(parseListVideoCommentsInput({ video_id: ids.video })).toEqual({
      videoId: ids.video,
      draftId: undefined,
      includeResolved: true,
    })
    expect(parseCreateGuestLinkInput({ video_id: ids.video, draft_id: ids.draft })).toEqual({
      videoId: ids.video,
      draftId: ids.draft,
    })
    expect(guestReviewUrl(origin, 'ab'.repeat(32))).toBe(`${origin}/shared-reviews/${'ab'.repeat(32)}`)
  })
})

describe('MCP guest review tools', () => {
  afterEach(() => {
    for (const key of Object.keys(runtime.env)) delete runtime.env[key]
  })

  it('creates a link for the newest draft, reuses it, and honors an explicit version', async () => {
    const db = migratedDatabase()
    seedDraft(db)
    addDraftVersion(db, draftV2, fileV2, 2)
    db.prepare(`INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
      VALUES (?, 'Empty', 'short', 'organic', 'not-started', '{"type":"doc","content":[]}', 1, 1, 1)`).run(emptyVideoId)
    useEnv(db)
    const write = await mint(['videos:read', 'videos:write'])
    const newest = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'create_guest_link', arguments: { video_id: ids.video },
    })))
    expect(newest.isError).toBe(false)
    expect(newest.body).toMatchObject({
      share_id: draftV2,
      draft_id: draftV2,
      draft_version: 2,
    })
    expect(newest.body.url).toMatch(new RegExp(`^${origin}/shared-reviews/[0-9a-f]{64}$`))
    const share = db.prepare(
      'SELECT created_by_user_id, token FROM draft_review_share WHERE draft_id = ?',
    ).get(draftV2) as { created_by_user_id: string; token: string }
    expect(share.created_by_user_id).toBe(ids.user)
    expect(newest.body.url).toBe(`${origin}/shared-reviews/${share.token}`)
    expect(newest.body.created_at).toEqual(expect.any(Number))

    const video = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'get_video', arguments: { id: ids.video },
    })))
    const versions = video.body.draft_versions as Array<{ id: string; guest_url: string | null }>
    expect(versions.find((draft) => draft.id === draftV2)?.guest_url).toBe(newest.body.url)
    expect(versions.find((draft) => draft.id === ids.draft)?.guest_url).toBeNull()

    const again = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'create_guest_link', arguments: { video_id: ids.video },
    })))
    expect(again.body.url).toBe(newest.body.url)
    expect(again.body.created_at).toBe(newest.body.created_at)
    expect(db.prepare('SELECT COUNT(*) AS count FROM draft_review_share').get()).toEqual({ count: 1 })

    const explicit = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'create_guest_link', arguments: { video_id: ids.video, draft_id: ids.draft },
    })))
    expect(explicit.isError).toBe(false)
    expect(explicit.body).toMatchObject({ share_id: ids.draft, draft_id: ids.draft, draft_version: 1 })
    expect(explicit.body.url).not.toBe(newest.body.url)

    const none = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'create_guest_link', arguments: { video_id: emptyVideoId },
    })))
    expect(none).toEqual({ isError: true, body: { error: 'Video has no drafts.' } })

    const missing = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'create_guest_link', arguments: { video_id: missingVideoId },
    })))
    expect(missing).toEqual({ isError: true, body: { error: 'Video not found.' } })
  })

  it('lists comments oldest first with guest and user authors, replies, and resolved filtering', async () => {
    const db = migratedDatabase()
    seedDraft(db)
    addDraftVersion(db, draftV2, fileV2, 2)
    seedComments(db)
    addComment(db, { id: v2CommentId, draftId: draftV2, createdAt: 60, text: 'On version two', startMs: 10 })
    useEnv(db)
    const write = await mint(['videos:read', 'videos:write'])

    const all = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'list_video_comments', arguments: { video_id: ids.video },
    })))
    expect(all.isError).toBe(false)
    const comments = all.body.comments as Array<Record<string, unknown>>
    expect(comments.map((comment) => comment.id)).toEqual([
      guestCommentId, resolvedId, userCommentId, replyId, v2CommentId,
    ])
    expect(comments[0]).toMatchObject({
      draft_id: ids.draft,
      draft_version: 1,
      timestamp_ms: 400,
      body: 'Guest note',
      author: { type: 'guest', name: 'Alex', email: 'alex@example.com' },
      parent_id: null,
      resolved_at: null,
    })
    expect(comments[2]).toMatchObject({
      body: 'Trim the intro',
      author: { type: 'user', name: 'Studio User' },
      timestamp_ms: 250,
    })
    expect(comments[2]?.author).toEqual({ type: 'user', name: 'Studio User' })
    expect(comments[3]).toMatchObject({ parent_id: userCommentId, body: 'Will trim' })
    expect(comments[4]).toMatchObject({ draft_id: draftV2, draft_version: 2, body: 'On version two' })

    const open = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'list_video_comments', arguments: { video_id: ids.video, include_resolved: false },
    })))
    expect((open.body.comments as Array<{ id: string }>).map((comment) => comment.id)).toEqual([
      guestCommentId, userCommentId, replyId, v2CommentId,
    ])

    const one = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'list_video_comments', arguments: { video_id: ids.video, draft_id: draftV2 },
    })))
    expect((one.body.comments as Array<{ id: string }>).map((comment) => comment.id)).toEqual([v2CommentId])

    const missing = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'list_video_comments', arguments: { video_id: missingVideoId },
    })))
    expect(missing).toEqual({ isError: true, body: { error: 'Video not found.' } })
  })

  it('enforces videos:write to create a link and videos:read to list comments', async () => {
    const db = migratedDatabase()
    seedDraft(db)
    seedComments(db)
    useEnv(db)
    const read = await mint(['videos:read'])
    const write = await mint(['videos:write'])
    expect(isMcpScope(['videos:read'], 'videos:write')).toBe(false)
    const source = readFileSync(resolve(process.cwd(), 'src/server/mcp.server.ts'), 'utf8')
    expect(source).toMatch(/create_guest_link[\s\S]*isMcpScope\(scopes, 'videos:write'\)/)
    expect(source).toMatch(/list_video_comments[\s\S]*isMcpScope\(scopes, 'videos:read'\)/)

    const deniedCreate = parseTool(await withClient(read.plaintext, (client) => client.callTool({
      name: 'create_guest_link', arguments: { video_id: ids.video },
    })))
    expect(deniedCreate).toEqual({ isError: true, body: { error: 'Missing scope videos:write' } })

    const deniedList = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'list_video_comments', arguments: { video_id: ids.video },
    })))
    expect(deniedList).toEqual({ isError: true, body: { error: 'Missing scope videos:read' } })

    const created = parseTool(await withClient(write.plaintext, (client) => client.callTool({
      name: 'create_guest_link', arguments: { video_id: ids.video },
    })))
    expect(created.isError).toBe(false)
    const listed = parseTool(await withClient(read.plaintext, (client) => client.callTool({
      name: 'list_video_comments', arguments: { video_id: ids.video },
    })))
    expect(listed.isError).toBe(false)
    expect((listed.body.comments as unknown[]).length).toBeGreaterThan(0)
  })
})
