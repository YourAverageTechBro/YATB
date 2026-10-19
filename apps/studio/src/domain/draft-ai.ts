import type { DraftId } from './reviews'
import type { VideoId } from './videos'
import { CHAPTER_RULES } from './youtube-metadata'

export const MAX_GENERATION_DURATION_MS = 30 * 60 * 1000
/** standard-1 has 8 GB of disk. The extractor buffers the source before ffmpeg reads it. */
export const MAX_SPEECH_SOURCE_BYTES = 6 * 1024 ** 3
export const MIN_CHAPTERS_DURATION_MS = CHAPTER_RULES.minCount * CHAPTER_RULES.minLengthMs
export const JOB_MAX_ATTEMPTS = 4
/** Longer than the 15 minute queue consumer wall clock, so a lease is never reclaimed while its holder can still write. */
export const JOB_LEASE_MS = 16 * 60 * 1000
export const QUEUED_GRACE_MS = 60_000
/** One try plus one retry that feeds the problems back. */
export const WRITER_TRIES = 2
export const WRITER_MAX_OUTPUT_TOKENS = 1_500

export const WRITEUP_FIELDS = ['description', 'chapters'] as const
export type WriteupField = (typeof WRITEUP_FIELDS)[number]
export const JOB_KINDS = ['transcript', ...WRITEUP_FIELDS] as const
export type JobKind = (typeof JOB_KINDS)[number]
export const JOB_STATES = ['queued', 'processing', 'ready', 'failed'] as const
export type JobState = (typeof JOB_STATES)[number]
export const AI_PROVIDER_MODES = ['live', 'stub'] as const
export type AiProviderMode = (typeof AI_PROVIDER_MODES)[number]

export const FAILURE_CODES = [
  'no-speech',
  'budget',
  'invalid-output',
  'transcript-failed',
  'provider',
  'timed-out',
  'ai-unavailable',
] as const
export type FailureCode = (typeof FAILURE_CODES)[number]
export type Failure = Readonly<{ code: FailureCode; detail: string | null }>

/** The queue message. A wake-up only. D1 decides what happens. */
export type JobKey = Readonly<{ draftId: DraftId; kind: JobKind }>

/** Parsed from a `draft_ai_job` row. Only `processing` holds a lease. */
export type Job =
  | Readonly<{ state: 'queued'; requestSeq: number; lastFailure: Failure | null }>
  | Readonly<{ state: 'processing'; requestSeq: number }>
  | Readonly<{ state: 'ready'; requestSeq: number }>
  | Readonly<{ state: 'failed'; requestSeq: number; failure: Failure }>

/** Parsed from `draft_transcript`. The row appears when audio lands. The transcript fields fill when the transcript lands. */
export type TranscriptArtifact =
  | Readonly<{ stage: 'audio-ready'; provider: AiProviderMode }>
  | Readonly<{ stage: 'transcribed'; segmentCount: number; spanEndMs: number; provider: AiProviderMode }>

/** Generator-owned. `seq` is the request_seq of the run that wrote it. */
export type Generation = Readonly<{ seq: number; text: string; provider: AiProviderMode }>

/** Member-owned. `baseSeq` is the generation the member typed over, 0 when none existed. */
export type WriteupEdit = Readonly<{ text: string; baseSeq: number; revision: number }>

export type AiAvailability =
  | Readonly<{ kind: 'live' }>
  | Readonly<{ kind: 'stub' }>
  | Readonly<{ kind: 'unavailable'; reason: string }>

export function chapterBoundMs(durationMs: number, spanEndMs: number | null): number {
  return spanEndMs === null ? durationMs : Math.min(durationMs, spanEndMs)
}

export function isWriteupField(value: unknown): value is WriteupField {
  return WRITEUP_FIELDS.some((field) => field === value)
}

/** Unknown kinds and malformed bodies return null, and the consumer acks them. */
export function parseJobKey(value: unknown): JobKey | null {
  if (typeof value !== 'object' || value === null) return null
  const { draftId, kind } = value as Record<string, unknown>
  if (typeof draftId !== 'string' || !draftId) return null
  const known = JOB_KINDS.find((candidate) => candidate === kind)
  return known ? { draftId, kind: known } : null
}

export function speechAudioKey(videoId: VideoId, draftId: DraftId): string {
  return `videos/${videoId}/drafts/${draftId}/speech-opus-16k-v1.ogg`
}

export function transcriptKey(videoId: VideoId, draftId: DraftId): string {
  return `videos/${videoId}/drafts/${draftId}/transcript-nova3-en-v1.json`
}

export function draftAiObjectKeys(videoId: VideoId, draftIds: readonly DraftId[]): string[] {
  return draftIds.flatMap((draftId) => [speechAudioKey(videoId, draftId), transcriptKey(videoId, draftId)])
}

export function failureMessage(failure: Failure): string {
  switch (failure.code) {
    case 'no-speech':
      return 'No speech was found in this draft.'
    case 'budget':
      return 'This month’s AI budget is used up.'
    case 'invalid-output':
      return 'The writer could not produce text that meets YouTube’s rules.'
    case 'transcript-failed':
      return 'The transcript could not be made.'
    case 'provider':
      return 'The AI provider failed.'
    case 'timed-out':
      return 'The job stopped responding.'
    case 'ai-unavailable':
      return 'AI generation is not configured.'
    default: {
      const unreachable: never = failure.code
      return unreachable
    }
  }
}
