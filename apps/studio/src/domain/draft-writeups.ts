import { requestEstimate, withinBudget, type Microusd } from './ai-spend'
import {
  MAX_GENERATION_DURATION_MS,
  MAX_SPEECH_SOURCE_BYTES,
  MIN_CHAPTERS_DURATION_MS,
  chapterBoundMs,
  isWriteupField,
  type AiAvailability,
  type Failure,
  type Generation,
  type Job,
  type JobKind,
  type TranscriptArtifact,
  type WriteupEdit,
  type WriteupField,
} from './draft-ai'
import { parseMediaId } from './media'
import type { DraftId } from './reviews'
import { parseVideoId, type VideoFormat, type VideoId } from './videos'
import { DESCRIPTION_MAX_CHARS, chapterProblemMessage, chapterTextProblems } from './youtube-metadata'

/** Everything one panel read or one request decision needs. The server builds it from one D1 batch. */
export type PanelContext = Readonly<{
  draft: Readonly<{ id: DraftId; videoId: VideoId; version: number; durationMs: number; byteSize: number }>
  video: Readonly<{ format: VideoFormat; title: string }>
  jobs: Readonly<Partial<Record<JobKind, Job>>>
  transcript: TranscriptArtifact | null
  generations: Readonly<Partial<Record<WriteupField, Generation>>>
  edits: Readonly<Partial<Record<WriteupField, WriteupEdit>>>
  spent: Microusd
  ai: AiAvailability
}>

export type GenerateBlock =
  | 'short-format'
  | 'too-long'
  | 'too-large'
  | 'too-short-for-chapters'
  | 'no-speech'
  | 'ai-unavailable'
  | 'budget'

export type RequestDecision =
  | Readonly<{ kind: 'blocked'; reason: GenerateBlock }>
  | Readonly<{ kind: 'needs-confirmation' }>
  | Readonly<{ kind: 'already-running' }>
  | Readonly<{ kind: 'enqueue'; requestTranscript: boolean }>

function inFlight(job: Job | undefined): boolean {
  return job?.state === 'queued' || job?.state === 'processing'
}

/** A ready transcript is final, and a running one will land, so only a missing or failed one needs a new request. */
function needsTranscript(context: PanelContext): boolean {
  const job = context.jobs.transcript
  return job === undefined || job.state === 'failed'
}

/** Blocks that hold no matter what the member confirms. The draft is immutable, so no-speech blocks for good. */
function standingBlock(context: PanelContext, field: WriteupField): GenerateBlock | null {
  if (field === 'chapters' && context.video.format === 'short') return 'short-format'
  if (context.draft.durationMs > MAX_GENERATION_DURATION_MS) return 'too-long'
  if (context.draft.byteSize > MAX_SPEECH_SOURCE_BYTES) return 'too-large'
  if (field === 'chapters' && context.draft.durationMs < MIN_CHAPTERS_DURATION_MS) return 'too-short-for-chapters'
  const transcript = context.jobs.transcript
  if (transcript?.state === 'failed' && transcript.failure.code === 'no-speech') return 'no-speech'
  if (context.ai.kind === 'unavailable') return 'ai-unavailable'
  return null
}

function overBudget(context: PanelContext): boolean {
  return !withinBudget(context.spent, requestEstimate(context.draft.durationMs, needsTranscript(context)))
}

/** The one rule for whether a field may be generated now. The panel view and the request both use it. */
export function decideWriteupRequest(context: PanelContext, field: WriteupField, overwriteEdits: boolean): RequestDecision {
  const block = standingBlock(context, field)
  if (block) return { kind: 'blocked', reason: block }
  if (inFlight(context.jobs[field])) return { kind: 'already-running' }
  const current = resolveFieldText(context.generations[field] ?? null, context.edits[field] ?? null)
  if (current.origin === 'edited' && current.text.trim() && !overwriteEdits) return { kind: 'needs-confirmation' }
  if (overBudget(context)) return { kind: 'blocked', reason: 'budget' }
  return { kind: 'enqueue', requestTranscript: needsTranscript(context) }
}

export type ResolvedText = Readonly<{
  text: string
  origin: 'empty' | 'generated' | 'edited'
  baseSeq: number
  revision: number
}>

/**
 * The read-time merge of the two writers. An edit counts only when it was typed over the current
 * generation, so a newer generation supersedes it without anyone deleting it.
 */
export function resolveFieldText(generation: Generation | null, edit: WriteupEdit | null): ResolvedText {
  const baseSeq = generation?.seq ?? 0
  const revision = edit?.revision ?? 0
  if (edit && edit.baseSeq === baseSeq) {
    return { text: edit.text, origin: edit.text === generation?.text ? 'generated' : 'edited', baseSeq, revision }
  }
  return generation
    ? { text: generation.text, origin: 'generated', baseSeq, revision }
    : { text: '', origin: 'empty', baseSeq, revision }
}

export type WriteupProgress =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'transcribing' }>
  | Readonly<{ kind: 'writing' }>
  | Readonly<{ kind: 'failed'; failure: Failure }>

export function deriveProgress(fieldJob: Job | null, transcript: TranscriptArtifact | null): WriteupProgress {
  if (!fieldJob) return { kind: 'idle' }
  switch (fieldJob.state) {
    case 'queued':
    case 'processing':
      return transcript?.stage === 'transcribed' ? { kind: 'writing' } : { kind: 'transcribing' }
    case 'ready':
      return { kind: 'idle' }
    case 'failed':
      return { kind: 'failed', failure: fieldJob.failure }
    default: {
      const unreachable: never = fieldJob
      return unreachable
    }
  }
}

declare const saveTokenBrand: unique symbol
/** Opaque to the client. Encodes the generation seq and edit revision the text was loaded at. */
export type WriteupSaveToken = string & { readonly [saveTokenBrand]: true }

export function encodeSaveToken(resolved: Pick<ResolvedText, 'baseSeq' | 'revision'>): WriteupSaveToken {
  return `${resolved.baseSeq}.${resolved.revision}` as WriteupSaveToken
}

export function parseSaveToken(value: unknown): Readonly<{ baseSeq: number; revision: number }> {
  const match = typeof value === 'string' ? /^(\d{1,9})\.(\d{1,9})$/.exec(value) : null
  if (!match) throw new Error('Save token is invalid.')
  return { baseSeq: Number(match[1]), revision: Number(match[2]) }
}

export type GenerateAvailability =
  | Readonly<{ kind: 'allowed' }>
  | Readonly<{ kind: 'blocked'; reason: GenerateBlock }>

export type WriteupFieldView = Readonly<{
  field: WriteupField
  text: string
  origin: ResolvedText['origin']
  saveToken: WriteupSaveToken
  progress: WriteupProgress
  generate: GenerateAvailability
  /** YouTube rule problems in hand-edited chapters. The save still lands. */
  problems: readonly string[]
  stub: boolean
}>

export type TranscriptStatus =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'working'; stage: 'extracting-audio' | 'transcribing' }>
  | Readonly<{ kind: 'ready'; segmentCount: number; stub: boolean }>
  | Readonly<{ kind: 'failed'; failure: Failure }>

/** Member-only. Never merged into `Draft`, so guest handlers cannot return it by accident. */
export type DraftWriteupsView = Readonly<{
  draftId: DraftId
  ai: AiAvailability['kind']
  transcript: TranscriptStatus
  description: WriteupFieldView
  /** null when the video is a short. */
  chapters: WriteupFieldView | null
}>

function fieldView(context: PanelContext, field: WriteupField): WriteupFieldView {
  const generation = context.generations[field] ?? null
  const resolved = resolveFieldText(generation, context.edits[field] ?? null)
  const block = standingBlock(context, field) ?? (overBudget(context) ? 'budget' : null)
  const boundMs = chapterBoundMs(
    context.draft.durationMs,
    context.transcript?.stage === 'transcribed' ? context.transcript.spanEndMs : null,
  )
  return {
    field,
    text: resolved.text,
    origin: resolved.origin,
    saveToken: encodeSaveToken(resolved),
    progress: deriveProgress(context.jobs[field] ?? null, context.transcript),
    generate: block ? { kind: 'blocked', reason: block } : { kind: 'allowed' },
    problems: field === 'chapters' && resolved.origin === 'edited'
      ? chapterTextProblems(resolved.text, boundMs).map(chapterProblemMessage)
      : [],
    stub: resolved.origin === 'generated' && generation?.provider === 'stub',
  }
}

function transcriptStatus(context: PanelContext): TranscriptStatus {
  const artifact = context.transcript
  if (artifact?.stage === 'transcribed') {
    return { kind: 'ready', segmentCount: artifact.segmentCount, stub: artifact.provider === 'stub' }
  }
  const job = context.jobs.transcript
  if (!job) return { kind: 'none' }
  switch (job.state) {
    case 'queued':
    case 'processing':
      return { kind: 'working', stage: artifact ? 'transcribing' : 'extracting-audio' }
    case 'failed':
      return { kind: 'failed', failure: job.failure }
    case 'ready':
      return { kind: 'none' }
    default: {
      const unreachable: never = job
      return unreachable
    }
  }
}

export function buildWriteupsView(context: PanelContext): DraftWriteupsView {
  return {
    draftId: context.draft.id,
    ai: context.ai.kind,
    transcript: transcriptStatus(context),
    description: fieldView(context, 'description'),
    chapters: context.video.format === 'short' ? null : fieldView(context, 'chapters'),
  }
}

export function writeupsInProgress(view: DraftWriteupsView): boolean {
  return [view.description, view.chapters].some(
    (field) => field?.progress.kind === 'transcribing' || field?.progress.kind === 'writing',
  )
}

export function generateBlockMessage(reason: GenerateBlock): string {
  switch (reason) {
    case 'short-format':
      return 'Shorts do not get chapters.'
    case 'too-long':
      return 'Generation works on drafts up to 30 minutes long.'
    case 'too-large':
      return 'This draft file is too large to transcribe.'
    case 'too-short-for-chapters':
      return 'YouTube needs at least 30 seconds of video for chapters.'
    case 'no-speech':
      return 'No speech was found in this draft, so there is nothing to write from.'
    case 'ai-unavailable':
      return 'AI generation is not configured for this Studio.'
    case 'budget':
      return 'This month’s AI budget is used up.'
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

export type WriteupTarget = Readonly<{ videoId: VideoId; draftId: DraftId }>
export type WriteupRequest = WriteupTarget & Readonly<{ field: WriteupField; overwriteEdits: boolean }>
export type WriteupSave = WriteupTarget & Readonly<{ field: WriteupField; text: string; saveToken: WriteupSaveToken }>

export type RequestWriteupResult =
  | Readonly<{ kind: 'accepted'; view: DraftWriteupsView }>
  | Readonly<{ kind: 'needs-confirmation' }>
  | Readonly<{ kind: 'blocked'; reason: GenerateBlock }>

export type StaleReason = 'edited-elsewhere' | 'regenerated' | 'generating'

export type SaveWriteupResult =
  | Readonly<{ kind: 'saved'; view: WriteupFieldView }>
  | Readonly<{ kind: 'stale'; reason: StaleReason; view: WriteupFieldView }>

export type DraftTranscriptView = Readonly<{
  segments: readonly Readonly<{ startMs: number; text: string }>[]
  stub: boolean
}>

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function writeupField(value: unknown): WriteupField {
  if (!isWriteupField(value)) throw new Error('Writeup field is invalid.')
  return value
}

export function parseWriteupTarget(value: unknown): WriteupTarget {
  const input = record(value, 'Writeup target is required.')
  return { videoId: parseVideoId(input.videoId), draftId: parseMediaId(input.draftId) }
}

export function parseWriteupRequest(value: unknown): WriteupRequest {
  const input = record(value, 'Writeup request is required.')
  if (typeof input.overwriteEdits !== 'boolean') throw new Error('overwriteEdits must be true or false.')
  return { ...parseWriteupTarget(input), field: writeupField(input.field), overwriteEdits: input.overwriteEdits }
}

/** Normalizes line endings, strips control characters, and caps the length. */
export function parseWriteupSave(value: unknown): WriteupSave {
  const input = record(value, 'Writeup save is required.')
  if (typeof input.text !== 'string') throw new Error('Writeup text is required.')
  const text = input.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  if (text.length > DESCRIPTION_MAX_CHARS) throw new Error(`Writeup text must be at most ${DESCRIPTION_MAX_CHARS} characters.`)
  parseSaveToken(input.saveToken)
  return {
    ...parseWriteupTarget(input),
    field: writeupField(input.field),
    text,
    saveToken: input.saveToken as WriteupSaveToken,
  }
}

/** Classifies a refused save from the re-read context. */
export function staleReason(context: PanelContext, field: WriteupField, sent: WriteupSaveToken): StaleReason {
  if (inFlight(context.jobs[field])) return 'generating'
  const { baseSeq } = parseSaveToken(sent)
  return (context.generations[field]?.seq ?? 0) === baseSeq ? 'edited-elsewhere' : 'regenerated'
}
