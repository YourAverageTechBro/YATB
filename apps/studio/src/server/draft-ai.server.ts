import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  MONTHLY_AI_BUDGET,
  chargeId,
  spendMonth,
  transcriptionCost,
  writerCost,
  writerEstimate,
  type ChargeId,
  type Microusd,
} from '#/domain/ai-spend'
import {
  WRITER_TRIES,
  chapterBoundMs,
  parseJobKey,
  speechAudioKey,
  transcriptKey,
  type AiAvailability,
  type AiProviderMode,
  type Failure,
  type FailureCode,
  type Job,
  type JobKey,
  type JobKind,
  type JobState,
  type TranscriptArtifact,
  type WriteupField,
} from '#/domain/draft-ai'
import { interpretWriterReply, writerPrompt } from '#/domain/draft-ai-writer'
import {
  buildWriteupsView,
  decideWriteupRequest,
  parseSaveToken,
  parseWriteupTarget,
  staleReason,
  type DraftTranscriptView,
  type DraftWriteupsView,
  type PanelContext,
  type RequestWriteupResult,
  type SaveWriteupResult,
  type WriteupRequest,
  type WriteupSave,
  type WriteupTarget,
} from '#/domain/draft-writeups'
import { parseTranscriptDoc, transcriptLines, transcriptSpanEndMs, type TranscriptDoc } from '#/domain/transcript'
import type { VideoFormat } from '#/domain/videos'
import { PRIVATE_NO_STORE, requireStudioSession } from './auth.server'
import { ProviderError, draftAiProviders, type DraftAiProviderEnv, type DraftAiProviders, type DraftAiSetup } from './draft-ai-providers.server'
import {
  CLAIM_JOB_SQL,
  EXPIRE_EXHAUSTED_SQL,
  FAIL_JOB_SQL,
  FAIL_ORPHANED_DEPENDENTS_SQL,
  INSERT_EDIT_SQL,
  MONTH_SPEND_SQL,
  PANEL_DRAFT_SQL,
  PANEL_EDITS_SQL,
  PANEL_GENERATIONS_SQL,
  PANEL_JOBS_SQL,
  PANEL_TRANSCRIPT_SQL,
  PENDING_JOBS_SQL,
  QUEUED_DEPENDENTS_SQL,
  RECORD_AUDIO_SQL,
  RECORD_GENERATION_SQL,
  RECORD_TRANSCRIPT_SQL,
  REQUEST_JOB_SQL,
  RESERVED_SPEND_SQL,
  RESERVE_SPEND_SQL,
  SETTLE_SPEND_SQL,
  SUCCEED_JOB_SQL,
  UPDATE_EDIT_SQL,
} from './draft-ai-sql'

export type DraftAiBindings = Cloudflare.Env & DraftAiProviderEnv & Readonly<{
  DB: D1Database
  DRAFT_AI_QUEUE: Queue<JobKey>
}>

const bindings = env as DraftAiBindings

type DraftRow = {
  id: string
  video_id: string
  version: number
  duration_ms: number
  byte_size: number
  object_key: string
  content_type: string
  format: VideoFormat
  title: string
}

type JobRow = {
  kind: JobKind
  state: JobState
  request_seq: number
  failure_code: FailureCode | null
  failure_detail: string | null
}

type TranscriptRow = {
  transcript_etag: string | null
  segment_count: number | null
  span_end_ms: number | null
  provider: AiProviderMode
}

type GenerationRow = { field: WriteupField; seq: number; text: string; provider: AiProviderMode }
type EditRow = { field: WriteupField; text: string; base_seq: number; revision: number }
type KeyRow = { draft_id: string; kind: JobKind }

function rows<T>(result: D1Result<unknown> | undefined): T[] {
  return (result?.results ?? []) as T[]
}

function jobFromRow(row: JobRow): Job {
  const failure = row.failure_code ? { code: row.failure_code, detail: row.failure_detail } : null
  switch (row.state) {
    case 'queued':
      return { state: 'queued', requestSeq: row.request_seq, lastFailure: failure }
    case 'processing':
      return { state: 'processing', requestSeq: row.request_seq }
    case 'ready':
      return { state: 'ready', requestSeq: row.request_seq }
    case 'failed':
      if (!failure) throw new Error('A failed draft AI job has no failure code.')
      return { state: 'failed', requestSeq: row.request_seq, failure }
    default: {
      const unreachable: never = row.state
      return unreachable
    }
  }
}

function transcriptFromRow(row: TranscriptRow): TranscriptArtifact {
  return row.segment_count !== null && row.span_end_ms !== null
    ? { stage: 'transcribed', segmentCount: row.segment_count, spanEndMs: row.span_end_ms, provider: row.provider }
    : { stage: 'audio-ready', provider: row.provider }
}

async function readContext(
  db: D1Database,
  target: WriteupTarget,
  ai: AiAvailability,
  now: number,
): Promise<PanelContext | null> {
  const [draftResult, jobs, transcript, generations, edits, spend] = await db.batch([
    db.prepare(PANEL_DRAFT_SQL).bind(target.draftId, target.videoId),
    db.prepare(PANEL_JOBS_SQL).bind(target.draftId),
    db.prepare(PANEL_TRANSCRIPT_SQL).bind(target.draftId),
    db.prepare(PANEL_GENERATIONS_SQL).bind(target.draftId),
    db.prepare(PANEL_EDITS_SQL).bind(target.draftId),
    db.prepare(MONTH_SPEND_SQL).bind(spendMonth(now)),
  ])
  const draft = rows<DraftRow>(draftResult)[0]
  if (!draft) return null
  const transcriptRow = rows<TranscriptRow>(transcript)[0]
  return {
    draft: {
      id: draft.id,
      videoId: draft.video_id,
      version: draft.version,
      durationMs: draft.duration_ms,
      byteSize: draft.byte_size,
    },
    video: { format: draft.format, title: draft.title },
    jobs: Object.fromEntries(rows<JobRow>(jobs).map((row) => [row.kind, jobFromRow(row)])),
    transcript: transcriptRow ? transcriptFromRow(transcriptRow) : null,
    generations: Object.fromEntries(rows<GenerationRow>(generations).map((row) => [
      row.field, { seq: row.seq, text: row.text, provider: row.provider },
    ])),
    edits: Object.fromEntries(rows<EditRow>(edits).map((row) => [
      row.field, { text: row.text, baseSeq: row.base_seq, revision: row.revision },
    ])),
    spent: (rows<{ spent: number }>(spend)[0]?.spent ?? 0) as Microusd,
    ai,
  }
}

function notFound(): never {
  throw new Response('Draft not found.', { status: 404, headers: { 'Cache-Control': PRIVATE_NO_STORE } })
}

async function requireContext(envBindings: DraftAiBindings, target: WriteupTarget, now: number): Promise<PanelContext> {
  return (await readContext(envBindings.DB, target, draftAiProviders(envBindings).availability, now)) ?? notFound()
}

export async function loadWriteups(target: WriteupTarget, envBindings = bindings): Promise<DraftWriteupsView> {
  return buildWriteupsView(await requireContext(envBindings, target, Date.now()))
}

/** The transcript is requested before the field, so the orphan sweep never sees the old failed transcript. */
export async function requestWriteup(
  input: WriteupRequest,
  envBindings = bindings,
  now = Date.now(),
): Promise<RequestWriteupResult> {
  const context = await requireContext(envBindings, input, now)
  const decision = decideWriteupRequest(context, input.field, input.overwriteEdits)
  switch (decision.kind) {
    case 'blocked':
      return { kind: 'blocked', reason: decision.reason }
    case 'needs-confirmation':
      return { kind: 'needs-confirmation' }
    case 'already-running':
      return { kind: 'accepted', view: buildWriteupsView(context) }
    case 'enqueue': {
      const request = (kind: JobKind) => envBindings.DB.prepare(REQUEST_JOB_SQL).bind(input.draftId, input.videoId, kind, now)
      await envBindings.DB.batch(decision.requestTranscript ? [request('transcript'), request(input.field)] : [request(input.field)])
      await envBindings.DRAFT_AI_QUEUE.send({
        draftId: input.draftId,
        kind: decision.requestTranscript ? 'transcript' : input.field,
      })
      return { kind: 'accepted', view: buildWriteupsView(await requireContext(envBindings, input, now)) }
    }
    default: {
      const unreachable: never = decision
      return unreachable
    }
  }
}

export async function saveWriteup(
  input: WriteupSave,
  userId: string,
  envBindings = bindings,
  now = Date.now(),
): Promise<SaveWriteupResult> {
  const before = await requireContext(envBindings, input, now)
  if (input.field === 'chapters' && before.video.format === 'short') {
    throw new Response('Shorts do not have chapters.', { status: 400, headers: { 'Cache-Control': PRIVATE_NO_STORE } })
  }
  const token = parseSaveToken(input.saveToken)
  const write = token.revision === 0
    ? envBindings.DB.prepare(INSERT_EDIT_SQL)
      .bind(input.draftId, input.videoId, input.field, input.text, token.baseSeq, userId, now)
    : envBindings.DB.prepare(UPDATE_EDIT_SQL)
      .bind(input.draftId, input.videoId, input.field, input.text, token.baseSeq, userId, now, token.revision)
  const saved = (await write.run()).meta.changes === 1
  const context = await requireContext(envBindings, input, now)
  const view = buildWriteupsView(context)[input.field] ?? notFound()
  return saved
    ? { kind: 'saved', view }
    : { kind: 'stale', reason: staleReason(context, input.field, input.saveToken), view }
}

async function readTranscript(
  envBindings: DraftAiBindings,
  target: WriteupTarget,
): Promise<Readonly<{ doc: TranscriptDoc; version: number }> | null> {
  const [draftResult, transcriptResult] = await envBindings.DB.batch([
    envBindings.DB.prepare(PANEL_DRAFT_SQL).bind(target.draftId, target.videoId),
    envBindings.DB.prepare(PANEL_TRANSCRIPT_SQL).bind(target.draftId),
  ])
  const draft = rows<DraftRow>(draftResult)[0]
  if (!draft) notFound()
  if (!rows<TranscriptRow>(transcriptResult)[0]?.transcript_etag) return null
  const object = await envBindings.MEDIA.get(transcriptKey(target.videoId, target.draftId))
  return object && { doc: parseTranscriptDoc(await object.json()), version: draft.version }
}

/** null until the transcript is ready. */
export async function loadTranscript(target: WriteupTarget, envBindings = bindings): Promise<DraftTranscriptView | null> {
  const transcript = await readTranscript(envBindings, target)
  return transcript && {
    segments: transcript.doc.segments.map(({ startMs, text }) => ({ startMs, text })),
    stub: transcript.doc.model === 'stub',
  }
}

function routeTarget(videoId: string, draftId: string): WriteupTarget {
  try {
    return parseWriteupTarget({ videoId, draftId })
  } catch (error) {
    throw new Response(error instanceof Error ? error.message : 'Draft is invalid.', {
      status: 400,
      headers: { 'Cache-Control': PRIVATE_NO_STORE },
    })
  }
}

/** GET /api/videos/$videoId/drafts/$draftId/transcript. A member gets text/plain. Everyone else gets 401. */
export async function handleTranscriptDownload(
  videoIdValue: string,
  draftIdValue: string,
  envBindings = bindings,
): Promise<Response> {
  try {
    await requireStudioSession()
    const transcript = await readTranscript(envBindings, routeTarget(videoIdValue, draftIdValue))
    if (!transcript) {
      return new Response('Transcript not found.', { status: 404, headers: { 'Cache-Control': PRIVATE_NO_STORE } })
    }
    return new Response(`${transcriptLines(transcript.doc)}\n`, {
      headers: {
        'Cache-Control': PRIVATE_NO_STORE,
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="draft-v${transcript.version}-transcript.txt"`,
      },
    })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}

type ClaimedRun<K extends JobKind = JobKind> = Readonly<{
  key: Readonly<{ draftId: string; kind: K }>
  videoId: string
  requestSeq: number
  attempt: number
  leaseId: string
  now: number
}>

type StepResult =
  | Readonly<{ kind: 'finished' }>
  | Readonly<{ kind: 'failed'; failure: Failure; retryable: boolean }>

type RunDeps = Readonly<{ env: DraftAiBindings; providers: DraftAiProviders }>
type Runner<K extends JobKind> = (run: ClaimedRun<K>, deps: RunDeps) => Promise<StepResult>

/** Adding a JobKind fails the build until it has a runner. */
const RUNNERS: { readonly [K in JobKind]: Runner<K> } = {
  transcript: runTranscript,
  description: runWriteup,
  chapters: runWriteup,
}

const FINISHED: StepResult = { kind: 'finished' }

function permanent(code: FailureCode, detail: string | null): StepResult {
  return { kind: 'failed', failure: { code, detail }, retryable: false }
}

async function reserve(
  db: D1Database,
  run: ClaimedRun,
  id: ChargeId,
  estimate: Microusd,
): Promise<boolean> {
  const [, reserved] = await db.batch([
    db.prepare(RESERVE_SPEND_SQL)
      .bind(id, spendMonth(run.now), run.key.kind, run.videoId, run.key.draftId, estimate, run.now, MONTHLY_AI_BUDGET),
    db.prepare(RESERVED_SPEND_SQL).bind(id),
  ])
  return rows(reserved).length > 0
}

async function settle(
  db: D1Database,
  id: ChargeId,
  microusd: Microusd,
  usage: Readonly<{ audioMs?: number; inputTokens?: number; outputTokens?: number }>,
  now: number,
): Promise<void> {
  await db.prepare(SETTLE_SPEND_SQL)
    .bind(id, microusd, usage.audioMs ?? null, usage.inputTokens ?? null, usage.outputTokens ?? null, now)
    .run()
}

/** Skips extraction when the audio already landed, so a retry after a failed transcription pays only for the transcription. */
async function runTranscript(run: ClaimedRun<'transcript'>, { env: envBindings, providers }: RunDeps): Promise<StepResult> {
  const db = envBindings.DB
  const { draftId } = run.key
  const draft = await db.prepare(PANEL_DRAFT_SQL).bind(draftId, run.videoId).first<DraftRow>()
  if (!draft) return FINISHED
  const audioKey = speechAudioKey(run.videoId, draftId)
  const audioRow = await db.prepare(PANEL_TRANSCRIPT_SQL).bind(draftId).first<TranscriptRow>()
  if (!audioRow || !(await envBindings.MEDIA.head(audioKey))) {
    const audio = await providers.extractSpeechAudio(
      { objectKey: draft.object_key, byteSize: draft.byte_size, contentType: draft.content_type },
      audioKey,
    )
    const recorded = await db.prepare(RECORD_AUDIO_SQL).bind(draftId, run.leaseId, audio.etag, providers.mode, run.now).run()
    if (recorded.meta.changes !== 1) {
      await envBindings.MEDIA.delete(audioKey)
      return FINISHED
    }
  }
  const charge = chargeId(run.key, run.requestSeq, run.attempt, 'transcribe')
  if (!(await reserve(db, run, charge, transcriptionCost(draft.duration_ms)))) {
    return permanent('budget', 'Transcribing would pass this month’s AI budget.')
  }
  const { doc, audioMs } = await providers.transcribe(audioKey, draft.duration_ms)
  await settle(db, charge, transcriptionCost(audioMs), { audioMs }, run.now)
  const spanEndMs = transcriptSpanEndMs(doc)
  if (spanEndMs < 1) return permanent('no-speech', null)
  const key = transcriptKey(run.videoId, draftId)
  const stored = await envBindings.MEDIA.put(key, JSON.stringify(doc), { httpMetadata: { contentType: 'application/json' } })
  const [recorded] = await db.batch([
    db.prepare(RECORD_TRANSCRIPT_SQL).bind(draftId, run.leaseId, stored.httpEtag, doc.segments.length, spanEndMs, run.now),
    db.prepare(SUCCEED_JOB_SQL).bind(draftId, 'transcript', run.leaseId, run.now),
  ])
  if (recorded?.meta.changes !== 1) {
    await envBindings.MEDIA.delete(key)
    return FINISHED
  }
  const dependents = await db.prepare(QUEUED_DEPENDENTS_SQL).bind(draftId).all<KeyRow>()
  for (const row of dependents.results) await envBindings.DRAFT_AI_QUEUE.send({ draftId: row.draft_id, kind: row.kind })
  return FINISHED
}

/** One writer reply serves either field. Invalid output retries once with the problems in the prompt. */
async function runWriteup(run: ClaimedRun<WriteupField>, { env: envBindings, providers }: RunDeps): Promise<StepResult> {
  const db = envBindings.DB
  const { draftId, kind: field } = run.key
  const draft = await db.prepare(PANEL_DRAFT_SQL).bind(draftId, run.videoId).first<DraftRow>()
  if (!draft) return FINISHED
  const transcriptRow = await db.prepare(PANEL_TRANSCRIPT_SQL).bind(draftId).first<TranscriptRow>()
  const object = transcriptRow?.transcript_etag ? await envBindings.MEDIA.get(transcriptKey(run.videoId, draftId)) : null
  if (!object) return permanent('transcript-failed', 'The transcript file is missing.')
  const doc = parseTranscriptDoc(await object.json())
  const chapters = {
    segmentStartsMs: doc.segments.map((segment) => segment.startMs),
    boundMs: chapterBoundMs(draft.duration_ms, transcriptRow?.span_end_ms ?? null),
  }
  let feedback: readonly string[] = []
  for (let attempt = 1; attempt <= WRITER_TRIES; attempt += 1) {
    const charge = chargeId(run.key, run.requestSeq, run.attempt, `write-${attempt}`)
    if (!(await reserve(db, run, charge, writerEstimate(draft.duration_ms)))) {
      return permanent('budget', 'Writing would pass this month’s AI budget.')
    }
    const reply = await providers.write(
      writerPrompt({ title: draft.title, durationMs: draft.duration_ms, transcript: doc, feedback }),
      run.key,
    )
    if (reply.usage) await settle(db, charge, writerCost(reply.usage), reply.usage, run.now)
    const result = interpretWriterReply(field, reply.text, chapters)
    if (result.ok) {
      await db.batch([
        db.prepare(RECORD_GENERATION_SQL)
          .bind(draftId, field, run.leaseId, result.value, providers.mode, providers.writerModel, run.now),
        db.prepare(SUCCEED_JOB_SQL).bind(draftId, field, run.leaseId, run.now),
      ])
      return FINISHED
    }
    feedback = result.problems
  }
  return permanent('invalid-output', feedback.join(' '))
}

function classifyProviderError(error: unknown): Readonly<{ failure: Failure; retryable: boolean }> {
  const detail = error instanceof Error ? error.message : 'Unknown failure.'
  if (!(error instanceof ProviderError)) return { failure: { code: 'provider', detail }, retryable: true }
  switch (error.code) {
    case 'no-audio':
    case 'no-speech':
      return { failure: { code: 'no-speech', detail }, retryable: false }
    case 'rejected':
      return { failure: { code: 'provider', detail }, retryable: false }
    case 'transient':
      return { failure: { code: 'provider', detail }, retryable: true }
    default: {
      const unreachable: never = error.code
      return unreachable
    }
  }
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(900, 30 * 2 ** attempt)
}

async function attemptRun<K extends JobKind>(run: ClaimedRun<K>, deps: RunDeps): Promise<StepResult> {
  try {
    return await RUNNERS[run.key.kind](run, deps)
  } catch (error) {
    return { kind: 'failed', ...classifyProviderError(error) }
  }
}

type RunOutcome = Readonly<{ kind: 'done' }> | Readonly<{ kind: 'retry'; delaySeconds: number }>

async function runJob(key: JobKey, envBindings: DraftAiBindings, setup: DraftAiSetup, now: number): Promise<RunOutcome> {
  const db = envBindings.DB
  const leaseId = crypto.randomUUID()
  const [, , claimed] = await db.batch([
    db.prepare(EXPIRE_EXHAUSTED_SQL).bind(now),
    db.prepare(FAIL_ORPHANED_DEPENDENTS_SQL).bind(now),
    db.prepare(CLAIM_JOB_SQL).bind(key.draftId, key.kind, leaseId, now),
  ])
  const claim = rows<{ video_id: string; request_seq: number; attempts: number }>(claimed)[0]
  if (!claim) return { kind: 'done' }
  const run: ClaimedRun = { key, videoId: claim.video_id, requestSeq: claim.request_seq, attempt: claim.attempts, leaseId, now }
  const result = setup.providers
    ? await attemptRun(run, { env: envBindings, providers: setup.providers })
    : permanent('ai-unavailable', setup.availability.kind === 'unavailable' ? setup.availability.reason : null)
  if (result.kind === 'finished') return { kind: 'done' }
  const [failed] = await db.batch([
    db.prepare(FAIL_JOB_SQL).bind(
      key.draftId, key.kind, leaseId, result.retryable ? 1 : 0,
      result.failure.code, result.failure.detail?.slice(0, 500) ?? null, now,
    ),
    db.prepare(FAIL_ORPHANED_DEPENDENTS_SQL).bind(now),
  ])
  return rows<{ state: JobState }>(failed)[0]?.state === 'queued'
    ? { kind: 'retry', delaySeconds: retryDelaySeconds(run.attempt) }
    : { kind: 'done' }
}

/** Acks unknown bodies. Retries with backoff only when the job went back to queued. */
export async function consumeDraftAiQueue(batch: MessageBatch<unknown>, envBindings: DraftAiBindings): Promise<void> {
  const setup = draftAiProviders(envBindings)
  for (const message of batch.messages) {
    const key = parseJobKey(message.body)
    if (!key) {
      message.ack()
      continue
    }
    const outcome = await runJob(key, envBindings, setup, Date.now())
    if (outcome.kind === 'retry') message.retry({ delaySeconds: outcome.delaySeconds })
    else message.ack()
  }
}

/** Cron. Fails exhausted and orphaned jobs, then re-sends wake-ups for lost messages and expired leases. */
export async function reconcileDraftAiJobs(envBindings: DraftAiBindings, now = Date.now()): Promise<number> {
  await envBindings.DB.batch([
    envBindings.DB.prepare(EXPIRE_EXHAUSTED_SQL).bind(now),
    envBindings.DB.prepare(FAIL_ORPHANED_DEPENDENTS_SQL).bind(now),
  ])
  const pending = await envBindings.DB.prepare(PENDING_JOBS_SQL).bind(now).all<KeyRow>()
  for (const row of pending.results) await envBindings.DRAFT_AI_QUEUE.send({ draftId: row.draft_id, kind: row.kind })
  return pending.results.length
}
