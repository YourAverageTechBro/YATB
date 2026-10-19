import { formatTimestamp } from './reviews'

export const TRANSCRIBE_MODEL = '@cf/deepgram/nova-3'

export type TranscriptSegment = Readonly<{ startMs: number; endMs: number; text: string }>

/** Stored as JSON in R2. Segments are sorted, non-overlapping, and never empty. */
export type TranscriptDoc = Readonly<{
  version: 1
  model: typeof TRANSCRIBE_MODEL | 'stub'
  language: 'en'
  segments: readonly TranscriptSegment[]
}>

export type TimedWord = Readonly<{ startMs: number; endMs: number; text: string }>

export const SEGMENT_RULES = { pauseMs: 700, maxSegmentMs: 12_000 } as const

/** Breaks after sentence punctuation, at a pause of at least `pauseMs`, or once a segment spans `maxSegmentMs`. */
export function segmentWords(words: readonly TimedWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let current: TimedWord[] = []
  words.forEach((word, index) => {
    current.push(word)
    const first = current[0] ?? word
    const next = words[index + 1]
    const ends = next === undefined
      || /[.?!]$/.test(word.text)
      || next.startMs - word.endMs >= SEGMENT_RULES.pauseMs
      || word.endMs - first.startMs >= SEGMENT_RULES.maxSegmentMs
    if (!ends) return
    segments.push({ startMs: first.startMs, endMs: word.endMs, text: current.map((part) => part.text).join(' ') })
    current = []
  })
  return segments
}

export function transcriptSpanEndMs(doc: TranscriptDoc): number {
  return doc.segments.at(-1)?.endMs ?? 0
}

/** The `.txt` download and the writer prompt both use `[m:ss] text` lines. */
export function transcriptLines(doc: TranscriptDoc): string {
  return doc.segments.map((segment) => `[${formatTimestamp(segment.startMs)}] ${segment.text}`).join('\n')
}

function invalid(): never {
  throw new Error('Transcript document is invalid.')
}

function isMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function parseTranscriptDoc(value: unknown): TranscriptDoc {
  if (typeof value !== 'object' || value === null) invalid()
  const input = value as Record<string, unknown>
  if (input.version !== 1 || input.language !== 'en') invalid()
  if (input.model !== TRANSCRIBE_MODEL && input.model !== 'stub') invalid()
  if (!Array.isArray(input.segments) || input.segments.length === 0) invalid()
  let previousEnd = 0
  const segments = input.segments.map((segment: unknown) => {
    if (typeof segment !== 'object' || segment === null) invalid()
    const { startMs, endMs, text } = segment as Record<string, unknown>
    if (!isMs(startMs) || !isMs(endMs) || typeof text !== 'string') invalid()
    if (startMs < previousEnd || endMs < startMs) invalid()
    previousEnd = endMs
    return { startMs, endMs, text }
  })
  return { version: 1, model: input.model, language: 'en', segments }
}
