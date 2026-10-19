import type { DraftId } from './reviews'

export const MAX_GENERATION_DURATION_MS = 30 * 60 * 1000
/** standard-1 has 8 GB of disk. The extractor buffers the source before ffmpeg reads it. */
export const MAX_SPEECH_SOURCE_BYTES = 6 * 1024 ** 3
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

/** Mirrors the `failure_code` CHECK in migration 0013. */
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

/**
 * YouTube measures the last chapter against the video length, and every start must land on speech.
 * The lesser of the two keeps both true even when the client-reported duration is wrong.
 */
export function chapterBoundMs(durationMs: number, spanEndMs: number | null): number {
  return spanEndMs === null ? durationMs : Math.min(durationMs, spanEndMs)
}
