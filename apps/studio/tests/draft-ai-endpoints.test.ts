import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadDraftTranscript,
  loadDraftWriteups,
  requestDraftWriteup,
  saveDraftWriteup,
} from '../src/server/draft-ai.functions'
import { consumeDraftAiQueue } from '../src/server/draft-ai.server'
import { loadSharedReview } from '../src/server/reviews.functions'
import { Route as TranscriptRoute } from '../src/routes/api.videos.$videoId.drafts.$draftId.transcript'
import { ids, migratedDatabase, seedDraft } from './support/draft-ai-db'
import { draftAiEnv, drain, jobRows, target, type TestEnv } from './support/draft-ai-env'

const runtime = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  headers: new Headers(),
  responseHeaders: new Map<string, string>(),
}))

vi.mock('@tanstack/react-start/server-only', () => ({}))
vi.mock('cloudflare:workers', () => ({ env: runtime.env }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => runtime.headers,
  setResponseHeader: (name: string, value: string) => runtime.responseHeaders.set(name, value),
  setCookie: () => {},
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (parse: (value: unknown) => unknown) => ({
      handler: (run: (input: { data: unknown }) => unknown) => async (input: { data: unknown }) => run({ data: parse(input.data) }),
    }),
  }),
}))

const origin = 'https://studio.example.com'
const secret = 'draft-ai-endpoint-secret-at-least-32-chars'

let db: DatabaseSync
let test: TestEnv

function useEnv(next: TestEnv) {
  test = next
  for (const key of Object.keys(runtime.env)) delete runtime.env[key]
  Object.assign(runtime.env, next.env, { APP_ORIGIN: origin, BETTER_AUTH_SECRET: secret })
}

beforeEach(() => {
  db = migratedDatabase()
  runtime.headers = new Headers()
  runtime.responseHeaders.clear()
})

afterEach(() => db.close())

/** better-auth signs the session cookie as `token.base64(HMAC-SHA256(token))`. */
async function signedCookie(token: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)))
  return encodeURIComponent(`${token}.${btoa(String.fromCharCode(...signature))}`)
}

async function signIn(requestOrigin = origin) {
  const token = crypto.randomUUID().replaceAll('-', '')
  const now = Date.now()
  db.prepare(`INSERT INTO allowed_email (email) VALUES ('studio@example.com')`).run()
  db.prepare(`INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(crypto.randomUUID(), now + 86_400_000, token, now, now, ids.user)
  runtime.headers = new Headers({
    cookie: `__Secure-yatb_studio.session_token=${await signedCookie(token)}`,
    origin: requestOrigin,
  })
}

async function thrownStatus(promise: Promise<unknown>): Promise<number> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Response) return error.status
    throw error
  }
  throw new Error('Expected a thrown Response.')
}

function downloadTranscript(params: { videoId: string; draftId: string } = target): Promise<Response> {
  const handlers = TranscriptRoute.options.server?.handlers as unknown as Record<string, (context: unknown) => Promise<Response>>
  return handlers.GET!({ params, request: new Request(`${origin}/api/videos/${params.videoId}/drafts/${params.draftId}/transcript`) })
}

async function generated(field: 'description' | 'chapters') {
  const accepted = await requestDraftWriteup({ data: { ...target, field, overwriteEdits: false } })
  await drain(test, consumeDraftAiQueue)
  return accepted
}

describe('draft writeup server functions', () => {
  it('reject a caller without a session', async () => {
    seedDraft(db)
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    expect(await thrownStatus(loadDraftWriteups({ data: target }))).toBe(401)
    expect(await thrownStatus(requestDraftWriteup({ data: { ...target, field: 'description', overwriteEdits: false } }))).toBe(401)
    expect(jobRows(db)).toEqual([])
  })

  it('reject a generate request from another origin and enqueue nothing', async () => {
    seedDraft(db)
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    await signIn('https://elsewhere.example.com')
    expect((await loadDraftWriteups({ data: target })).description.origin).toBe('empty')
    expect(await thrownStatus(requestDraftWriteup({ data: { ...target, field: 'description', overwriteEdits: false } }))).toBe(403)
    expect(jobRows(db)).toEqual([])
    expect(test.sent).toEqual([])
  })

  it('generate for a member, privately, and ask before overwriting an edit', async () => {
    seedDraft(db)
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    await signIn()
    const accepted = await generated('description')
    expect(accepted).toMatchObject({ kind: 'accepted', view: { description: { progress: { kind: 'transcribing' } } } })
    expect(runtime.responseHeaders.get('Cache-Control')).toBe('private, no-store, max-age=0')

    const view = await loadDraftWriteups({ data: target })
    const saved = await saveDraftWriteup({
      data: { ...target, field: 'description', text: 'My hook.\r\n\r\nMy summary.', saveToken: view.description.saveToken },
    })
    expect(saved).toMatchObject({ kind: 'saved', view: { origin: 'edited', text: 'My hook.\n\nMy summary.' } })

    expect(await requestDraftWriteup({ data: { ...target, field: 'description', overwriteEdits: false } }))
      .toEqual({ kind: 'needs-confirmation' })
    expect(await requestDraftWriteup({ data: { ...target, field: 'description', overwriteEdits: true } }))
      .toMatchObject({ kind: 'accepted', view: { description: { progress: { kind: 'writing' } } } })
    await drain(test, consumeDraftAiQueue)
    expect((await loadDraftWriteups({ data: target })).description).toMatchObject({ origin: 'generated', stub: true })
  })

  it('refuse a save made from stale text and say why', async () => {
    seedDraft(db)
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    await signIn()
    await generated('description')
    const loaded = (await loadDraftWriteups({ data: target })).description
    const save = (text: string, saveToken = loaded.saveToken) =>
      saveDraftWriteup({ data: { ...target, field: 'description', text, saveToken } })

    expect((await save('First tab.')).kind).toBe('saved')
    expect(await save('Second tab.')).toMatchObject({ kind: 'stale', reason: 'edited-elsewhere', view: { text: 'First tab.' } })

    const edited = (await loadDraftWriteups({ data: target })).description
    await requestDraftWriteup({ data: { ...target, field: 'description', overwriteEdits: true } })
    expect(await save('While writing.', edited.saveToken)).toMatchObject({ kind: 'stale', reason: 'generating' })
    await drain(test, consumeDraftAiQueue)
    expect(await save('After regenerate.', edited.saveToken)).toMatchObject({ kind: 'stale', reason: 'regenerated', view: { origin: 'generated' } })
  })

  it('save hand-edited chapters and list what YouTube would reject', async () => {
    seedDraft(db)
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    await signIn()
    const chapters = (await loadDraftWriteups({ data: target })).chapters
    const saved = await saveDraftWriteup({
      data: { ...target, field: 'chapters', text: '0:05 Intro\n0:30 Next', saveToken: chapters!.saveToken },
    })
    expect(saved.kind).toBe('saved')
    expect(saved.view.text).toBe('0:05 Intro\n0:30 Next')
    expect(saved.view.problems).toEqual(expect.arrayContaining([
      'The first chapter must start at 0:00, not 0:05.',
      'YouTube needs at least 3 chapters. This list has 2.',
    ]))
  })

  it('give shorts no chapters field and refuse chapter writes for them', async () => {
    seedDraft(db, { format: 'short', durationMs: 45_000 })
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    await signIn()
    const view = await loadDraftWriteups({ data: target })
    expect(view.chapters).toBeNull()
    expect(view.description.generate).toEqual({ kind: 'allowed' })
    expect(await requestDraftWriteup({ data: { ...target, field: 'chapters', overwriteEdits: false } }))
      .toEqual({ kind: 'blocked', reason: 'short-format' })
    expect(await thrownStatus(saveDraftWriteup({
      data: { ...target, field: 'chapters', text: '0:00 Intro', saveToken: view.description.saveToken },
    }))).toBe(400)
  })

  it('return 404 for a draft that belongs to another video', async () => {
    seedDraft(db)
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    await signIn()
    expect(await thrownStatus(loadDraftWriteups({ data: { ...target, videoId: crypto.randomUUID() } }))).toBe(404)
  })
})

describe('draft transcript download', () => {
  it('answers 401 without a session, 404 before the transcript, then text/plain', async () => {
    seedDraft(db)
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    expect((await downloadTranscript()).status).toBe(401)

    await signIn()
    expect((await downloadTranscript()).status).toBe(404)
    expect(await loadDraftTranscript({ data: target })).toBeNull()
    expect((await downloadTranscript({ ...target, draftId: 'not-a-uuid' })).status).toBe(400)

    await generated('description')
    const response = await downloadTranscript()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="draft-v1-transcript.txt"')
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(await response.text()).toMatch(/^\[0:00\] Stub transcript line 1\.\n\[0:20\] Stub transcript line 2\.\n/)
    expect(await loadDraftTranscript({ data: target })).toMatchObject({
      stub: true,
      segments: expect.arrayContaining([{ startMs: 20_000, text: 'Stub transcript line 2.' }]),
    })
  })
})

describe('guest shared review', () => {
  it('returns the same draft keys after the member generated writeups', async () => {
    seedDraft(db)
    useEnv(draftAiEnv(db, { DRAFT_AI_MODE: 'stub' }))
    await signIn()
    await generated('description')
    await generated('chapters')
    const token = 'c'.repeat(64)
    db.prepare(`INSERT INTO draft_review_share (draft_id, video_id, token, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, 1)`).run(ids.draft, ids.video, token, ids.user)

    runtime.headers = new Headers()
    const shared = await loadSharedReview({ data: token })
    expect(shared.available).toBe(true)
    if (!shared.available) return
    expect(Object.keys(shared).sort()).toEqual(['available', 'comments', 'draft', 'videoTitle'])
    expect(Object.keys(shared.draft).sort()).toEqual([
      'author', 'compactMp4', 'createdAt', 'durationMs', 'file', 'id', 'shareToken', 'stream', 'version', 'videoId',
    ])
    expect(JSON.stringify(shared)).not.toMatch(/Stub (hook|chapter|transcript)/)
  })
})
