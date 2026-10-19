import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MONTHLY_AI_BUDGET, spendMonth, transcriptionCost, writerCost } from '../src/domain/ai-spend'
import { QUEUED_GRACE_MS, speechAudioKey, transcriptKey } from '../src/domain/draft-ai'
import { WRITER_MODEL } from '../src/domain/draft-ai-writer'
import { TRANSCRIBE_MODEL } from '../src/domain/transcript'
import {
  consumeDraftAiQueue,
  loadWriteups,
  reconcileDraftAiJobs,
  requestWriteup,
} from '../src/server/draft-ai.server'
import { cleanupTombstonedVideos } from '../src/server/media.server'
import { ids, migratedDatabase, seedDraft } from './support/draft-ai-db'
import {
  FixedLengthStream,
  WorkersRequest,
  anthropicOutput,
  containerNamespace,
  draftAiEnv,
  drain,
  jobRows,
  messageBatch,
  nova3Output,
  originalKey,
  spendRows,
  target,
  workersAi,
  type AiCall,
  type TestEnv,
} from './support/draft-ai-env'

vi.mock('@tanstack/react-start/server-only', () => ({}))
vi.mock('cloudflare:workers', () => ({ env: {} }))

const originalBytes = new TextEncoder().encode('original draft bytes')
const speechBytes = new TextEncoder().encode('OggS speech audio')
const gatewayId = 'yatb-studio'

/** One sentence every 30 seconds of a five minute draft. */
const spokenWords = Array.from({ length: 10 }, (_, index) => [index * 30, index * 30 + 1.5, `Point${index}.`] as const)

const descriptionReply = {
  description: 'A quick tour of the draft.\n\nIt covers five points. Each one is short.',
  chapters: [
    { start: '0:00', title: 'Intro' },
    { start: '1:00', title: 'Setup' },
    { start: '2:00', title: 'Build' },
    { start: '3:00', title: 'Test' },
    { start: '4:00', title: 'Wrap up' },
  ],
}

let db: DatabaseSync

beforeEach(() => {
  db = migratedDatabase()
  vi.stubGlobal('Request', WorkersRequest)
  vi.stubGlobal('FixedLengthStream', FixedLengthStream)
})

afterEach(() => {
  vi.unstubAllGlobals()
  db.close()
})

function speechContainer(calls: string[], response = () => new Response(speechBytes, {
  headers: { 'content-type': 'audio/ogg', 'content-length': String(speechBytes.byteLength) },
})) {
  return containerNamespace(async (instance, path, body) => {
    calls.push(`${instance} ${path} ${new TextDecoder().decode(body)}`)
    return response()
  })
}

function defaultAi(call: AiCall): Promise<unknown> {
  return Promise.resolve(call.model === TRANSCRIBE_MODEL ? nova3Output(spokenWords) : anthropicOutput(descriptionReply))
}

function liveEnv(
  ai: (call: AiCall) => Promise<unknown> = defaultAi,
  containerCalls: string[] = [],
  container = speechContainer(containerCalls),
) {
  const test = draftAiEnv(db, {
    DRAFT_AI_MODE: 'live',
    AI: workersAi(ai),
    AI_GATEWAY_ID: gatewayId,
    VIDEO_TRANSCODER: container,
  })
  test.objects.set(originalKey, { bytes: originalBytes, contentType: 'video/mp4', etag: '"original"' })
  return test
}

function request(test: TestEnv, field: 'description' | 'chapters', overwriteEdits = false) {
  return requestWriteup({ ...target, field, overwriteEdits }, test.env)
}

function aiCalls(test: TestEnv): AiCall[] {
  return (test.env.AI as unknown as { calls: AiCall[] }).calls
}

describe('draft AI runner in stub mode', () => {
  it('turns a description request into a transcript and a stub description the member can read', async () => {
    seedDraft(db)
    const test = draftAiEnv(db, { DRAFT_AI_MODE: 'stub' })
    const accepted = await request(test, 'description')
    expect(accepted.kind).toBe('accepted')
    if (accepted.kind !== 'accepted') return
    expect(accepted.view.description.progress).toEqual({ kind: 'transcribing' })
    expect(accepted.view.transcript).toEqual({ kind: 'working', stage: 'extracting-audio' })
    expect(test.sent).toEqual([{ draftId: ids.draft, kind: 'transcript' }])

    const outcomes = await drain(test, consumeDraftAiQueue)
    expect(outcomes.every((entry) => entry.outcome === 'ack')).toBe(true)
    expect(jobRows(db)).toEqual([
      { kind: 'description', state: 'ready', attempts: 1, failure_code: null },
      { kind: 'transcript', state: 'ready', attempts: 1, failure_code: null },
    ])
    expect(test.objects.has(speechAudioKey(ids.video, ids.draft))).toBe(true)
    expect(test.objects.has(transcriptKey(ids.video, ids.draft))).toBe(true)

    const view = await loadWriteups(target, test.env)
    expect(view.ai).toBe('stub')
    expect(view.transcript).toEqual({ kind: 'ready', segmentCount: 15, stub: true })
    expect(view.description).toMatchObject({ origin: 'generated', stub: true, progress: { kind: 'idle' } })
    expect(view.description.text).toMatch(/^Stub hook for Draft AI\./)
    expect(view.description.text).toContain('Thanks for watching.')
    expect(view.chapters).toMatchObject({ origin: 'empty', text: '', progress: { kind: 'idle' } })
  })

  it('writes both fields from one transcript when the second request arrives mid-transcript', async () => {
    seedDraft(db)
    const test = draftAiEnv(db, { DRAFT_AI_MODE: 'stub' })
    await request(test, 'description')
    await request(test, 'chapters')
    expect(test.sent).toEqual([
      { draftId: ids.draft, kind: 'transcript' },
      { draftId: ids.draft, kind: 'chapters' },
    ])
    await drain(test, consumeDraftAiQueue)

    const view = await loadWriteups(target, test.env)
    expect(view.description.origin).toBe('generated')
    expect(view.chapters?.origin).toBe('generated')
    const lines = view.chapters?.text.split('\n') ?? []
    expect(lines[0]).toMatch(/^0:00 Stub chapter 1$/)
    expect(lines).toHaveLength(5)
    expect(spendRows(db).filter((row) => row.kind === 'transcript')).toHaveLength(1)
  })

  it('acks a message it cannot parse', async () => {
    seedDraft(db)
    const test = draftAiEnv(db, { DRAFT_AI_MODE: 'stub' })
    const { batch, outcomes } = messageBatch([{ draftId: ids.draft, kind: 'thumbnail' }, 'nonsense'])
    await consumeDraftAiQueue(batch, test.env)
    expect(outcomes.map((entry) => entry.outcome)).toEqual(['ack', 'ack'])
    expect(jobRows(db)).toEqual([])
  })
})

describe('draft AI runner in live mode', () => {
  it('extracts speech, transcribes and writes through the named gateway, and settles spend from usage', async () => {
    seedDraft(db)
    const containerCalls: string[] = []
    const test = liveEnv(defaultAi, containerCalls)
    await request(test, 'description')
    await drain(test, consumeDraftAiQueue)

    expect(containerCalls).toEqual(['speech-audio /extract-audio original draft bytes'])
    const audio = test.objects.get(speechAudioKey(ids.video, ids.draft))
    expect(audio?.contentType).toBe('audio/ogg')
    expect(new TextDecoder().decode(audio?.bytes)).toBe('OggS speech audio')

    const [transcribe, write] = aiCalls(test)
    expect(transcribe?.model).toBe(TRANSCRIBE_MODEL)
    expect(transcribe?.options).toEqual({ gateway: { id: gatewayId } })
    expect(write?.model).toBe(WRITER_MODEL)
    expect(write?.options).toMatchObject({ gateway: { id: gatewayId, skipCache: true } })
    expect(JSON.stringify(write?.input)).toContain('[4:30] Point9.')

    const view = await loadWriteups(target, test.env)
    expect(view.ai).toBe('live')
    expect(view.transcript).toEqual({ kind: 'ready', segmentCount: 10, stub: false })
    expect(view.description).toMatchObject({ origin: 'generated', stub: false })
    expect(view.description.text).toMatch(/^A quick tour of the draft\.\n\nIt covers five points\./)
    expect(db.prepare('SELECT span_end_ms FROM draft_transcript').get()).toEqual({ span_end_ms: 271_500 })

    expect(spendRows(db)).toEqual(expect.arrayContaining([
      { kind: 'transcript', microusd: transcriptionCost(300_000), settled: 1, audio_ms: 300_000, input_tokens: null, output_tokens: null },
      {
        kind: 'description',
        microusd: writerCost({ inputTokens: 1_200, outputTokens: 300 }),
        settled: 1,
        audio_ms: null,
        input_tokens: 1_200,
        output_tokens: 300,
      },
    ]))
  })

  it('writes chapters that land on transcript lines and stay inside the spoken span', async () => {
    seedDraft(db)
    const test = liveEnv()
    await request(test, 'chapters')
    await drain(test, consumeDraftAiQueue)
    const view = await loadWriteups(target, test.env)
    expect(view.chapters?.text).toBe('0:00 Intro\n1:00 Setup\n2:00 Build\n3:00 Test\n4:00 Wrap up')
    expect(view.chapters?.problems).toEqual([])
  })

  it('fails a draft without an audio track as no-speech and offers no paid retry', async () => {
    seedDraft(db)
    const test = liveEnv(defaultAi, [], speechContainer([], () => new Response('Stream map matches no streams.', {
      status: 422,
      headers: { 'x-extract-error': 'no-audio' },
    })))
    await request(test, 'description')
    await drain(test, consumeDraftAiQueue)

    expect(jobRows(db)).toEqual([
      { kind: 'description', state: 'failed', attempts: 0, failure_code: 'transcript-failed' },
      { kind: 'transcript', state: 'failed', attempts: 1, failure_code: 'no-speech' },
    ])
    expect(aiCalls(test)).toEqual([])
    const view = await loadWriteups(target, test.env)
    expect(view.transcript).toMatchObject({ kind: 'failed', failure: { code: 'no-speech' } })
    expect(view.description.progress).toMatchObject({ kind: 'failed', failure: { code: 'transcript-failed' } })
    expect(view.description.generate).toEqual({ kind: 'blocked', reason: 'no-speech' })
    expect(await request(test, 'description')).toEqual({ kind: 'blocked', reason: 'no-speech' })
  })

  it('retries a transient transcription failure with backoff without extracting the audio again', async () => {
    seedDraft(db)
    const containerCalls: string[] = []
    let failNext = true
    const test = liveEnv(async (call) => {
      if (call.model === TRANSCRIBE_MODEL && failNext) {
        failNext = false
        throw new Error('Gateway returned 503.')
      }
      return defaultAi(call)
    }, containerCalls)
    await request(test, 'description')
    const [first] = await drain(test, consumeDraftAiQueue)
    expect(first?.outcome).toEqual({ retryDelaySeconds: 60 })
    expect(jobRows(db).find((row) => row.kind === 'transcript')).toMatchObject({ state: 'queued', failure_code: 'provider' })
    expect((await loadWriteups(target, test.env)).description.progress).toEqual({ kind: 'transcribing' })

    test.sent.push({ draftId: ids.draft, kind: 'transcript' })
    await drain(test, consumeDraftAiQueue)
    expect(containerCalls).toHaveLength(1)
    expect(jobRows(db)).toMatchObject([
      { kind: 'description', state: 'ready' },
      { kind: 'transcript', state: 'ready', attempts: 2, failure_code: null },
    ])
  })

  it('feeds invalid chapters back once and keeps the fixed reply', async () => {
    seedDraft(db)
    const replies = [
      anthropicOutput({ ...descriptionReply, chapters: descriptionReply.chapters.slice(0, 2) }),
      anthropicOutput(descriptionReply),
    ]
    const test = liveEnv(async (call) => (call.model === TRANSCRIBE_MODEL ? defaultAi(call) : replies.shift()))
    await request(test, 'chapters')
    await drain(test, consumeDraftAiQueue)

    const writes = aiCalls(test).filter((call) => call.model === WRITER_MODEL)
    expect(writes).toHaveLength(2)
    expect(JSON.stringify(writes[1]?.input)).toContain('Your previous reply had these problems')
    expect(JSON.stringify(writes[1]?.input)).toContain('YouTube needs at least 3 chapters. This list has 2.')
    expect((await loadWriteups(target, test.env)).chapters?.origin).toBe('generated')
  })

  it('fails chapters as invalid-output after the retry is also invalid, and still allows a new try', async () => {
    seedDraft(db)
    const bad = anthropicOutput({ ...descriptionReply, chapters: [{ start: '0:05', title: 'Late start' }] })
    const test = liveEnv(async (call) => (call.model === TRANSCRIBE_MODEL ? defaultAi(call) : bad))
    await request(test, 'chapters')
    await drain(test, consumeDraftAiQueue)

    expect(aiCalls(test).filter((call) => call.model === WRITER_MODEL)).toHaveLength(2)
    const view = await loadWriteups(target, test.env)
    expect(view.chapters?.progress).toMatchObject({ kind: 'failed', failure: { code: 'invalid-output' } })
    expect(view.chapters?.generate).toEqual({ kind: 'allowed' })
    expect(view.chapters?.text).toBe('')
  })
})

describe('draft AI budget and availability', () => {
  it('blocks a request once the month is spent and enqueues nothing', async () => {
    seedDraft(db)
    const test = liveEnv()
    db.prepare(`INSERT INTO ai_spend (id, month, kind, video_id, draft_id, microusd, settled, created_at, updated_at)
      VALUES ('earlier', ?, 'transcript', 'v', 'd', ?, 1, 1, 1)`).run(spendMonth(Date.now()), MONTHLY_AI_BUDGET)
    expect(await request(test, 'description')).toEqual({ kind: 'blocked', reason: 'budget' })
    expect((await loadWriteups(target, test.env)).description.generate).toEqual({ kind: 'blocked', reason: 'budget' })
    expect(jobRows(db)).toEqual([])
    expect(test.sent).toEqual([])
  })

  it('fails the job without calling the provider when spend lands between request and run', async () => {
    seedDraft(db)
    const test = liveEnv()
    await request(test, 'description')
    db.prepare(`INSERT INTO ai_spend (id, month, kind, video_id, draft_id, microusd, settled, created_at, updated_at)
      VALUES ('other-tab', ?, 'transcript', 'v', 'd', ?, 1, 1, 1)`).run(spendMonth(Date.now()), MONTHLY_AI_BUDGET - 1)
    await drain(test, consumeDraftAiQueue)
    expect(aiCalls(test)).toEqual([])
    expect(jobRows(db)).toMatchObject([
      { kind: 'description', state: 'failed', failure_code: 'transcript-failed' },
      { kind: 'transcript', state: 'failed', failure_code: 'budget' },
    ])
  })

  it('treats a missing or default gateway id as unavailable', async () => {
    seedDraft(db)
    for (const AI_GATEWAY_ID of [undefined, 'default', '']) {
      const test = draftAiEnv(db, { DRAFT_AI_MODE: 'live', AI: workersAi(defaultAi), AI_GATEWAY_ID })
      const view = await loadWriteups(target, test.env)
      expect(view.ai).toBe('unavailable')
      expect(view.description.generate).toEqual({ kind: 'blocked', reason: 'ai-unavailable' })
      expect(await request(test, 'description')).toEqual({ kind: 'blocked', reason: 'ai-unavailable' })
    }
    expect(jobRows(db)).toEqual([])
  })

  it('fails a queued job as ai-unavailable when the binding goes away', async () => {
    seedDraft(db)
    const stub = draftAiEnv(db, { DRAFT_AI_MODE: 'stub' })
    await request(stub, 'description')
    const live = draftAiEnv(db, { DRAFT_AI_MODE: 'live', AI_GATEWAY_ID: gatewayId })
    live.sent.push(...stub.sent.splice(0))
    await drain(live, consumeDraftAiQueue)
    expect(jobRows(db)).toMatchObject([
      { kind: 'description', state: 'failed', failure_code: 'transcript-failed' },
      { kind: 'transcript', state: 'failed', failure_code: 'ai-unavailable' },
    ])
  })
})

describe('draft AI reconcile and purge', () => {
  it('re-sends a lost wake-up only after the grace period', async () => {
    seedDraft(db)
    const test = draftAiEnv(db, { DRAFT_AI_MODE: 'stub' })
    const requestedAt = Date.now()
    await requestWriteup({ ...target, field: 'description', overwriteEdits: false }, test.env, requestedAt)
    test.sent.length = 0
    expect(await reconcileDraftAiJobs(test.env, requestedAt + QUEUED_GRACE_MS - 1)).toBe(0)
    expect(await reconcileDraftAiJobs(test.env, requestedAt + QUEUED_GRACE_MS)).toBe(1)
    expect(test.sent).toEqual([{ draftId: ids.draft, kind: 'transcript' }])
    await drain(test, consumeDraftAiQueue)
    expect(jobRows(db).map((row) => row.state)).toEqual(['ready', 'ready'])
  })

  it('deletes the speech audio and transcript when a deleted video is purged', async () => {
    seedDraft(db)
    const test = draftAiEnv(db, { DRAFT_AI_MODE: 'stub' })
    await request(test, 'description')
    await drain(test, consumeDraftAiQueue)
    db.prepare('UPDATE video SET deleted_at = 1, cleanup_after = 0 WHERE id = ?').run(ids.video)

    expect(await cleanupTombstonedVideos(test.env)).toBe(1)
    expect(test.objects.has(speechAudioKey(ids.video, ids.draft))).toBe(false)
    expect(test.objects.has(transcriptKey(ids.video, ids.draft))).toBe(false)
    expect(jobRows(db)).toEqual([])
    expect(spendRows(db)).not.toEqual([])
  })
})
