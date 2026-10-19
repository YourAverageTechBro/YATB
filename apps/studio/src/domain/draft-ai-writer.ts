import type { WriteupField } from './draft-ai'
import { formatTimestamp } from './reviews'
import { transcriptLines, type TranscriptDoc } from './transcript'
import {
  CHAPTER_RULES,
  DESCRIPTION_MAX_CHARS,
  chapterProblemMessage,
  chaptersFromProposals,
  composeDescription,
  descriptionProblemMessage,
  formatChapters,
  type ChapterProposal,
  type Result,
} from './youtube-metadata'

export const WRITER_MODEL = 'anthropic/claude-haiku-5.5'

export type WriterPrompt = Readonly<{ system: string; user: string }>

declare const generatedTextBrand: unique symbol
/** Field text that passed its field's rules. The only text `draft_generation` receives. */
export type GeneratedText = string & { readonly [generatedTextBrand]: true }

export type ChapterContext = Readonly<{ segmentStartsMs: readonly number[]; boundMs: number }>

const SYSTEM_PROMPT = [
  'You write YouTube metadata for a tech video from its transcript.',
  'Reply with one JSON object and nothing else, shaped as',
  '{"description": string, "chapters": [{"start": "m:ss", "title": string}]}.',
  'description: a one or two sentence hook paragraph, a blank line, then a two to four sentence summary paragraph.',
  'No hashtags, no links, no emoji, and no angle brackets in the description.',
  `chapters: 5 to 8 entries. The first starts at 0:00. Every start is one of the [m:ss] labels in the transcript, and starts are at least ${CHAPTER_RULES.minLengthMs / 1000} seconds apart.`,
  'Chapter titles are short, plain, and under 60 characters.',
].join('\n')

/** Same prompt for both fields. `feedback` lists the previous try's problems as sentences. */
export function writerPrompt(input: Readonly<{
  title: string
  durationMs: number
  transcript: TranscriptDoc
  feedback: readonly string[]
}>): WriterPrompt {
  const parts = [
    `Title: ${input.title}`,
    `Length: ${formatTimestamp(input.durationMs)}`,
    '',
    'Transcript:',
    transcriptLines(input.transcript),
  ]
  if (input.feedback.length > 0) {
    parts.push('', 'Your previous reply had these problems. Fix them:', ...input.feedback.map((line) => `- ${line}`))
  }
  return { system: SYSTEM_PROMPT, user: parts.join('\n') }
}

function replyObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function proposals(value: unknown): ChapterProposal[] | null {
  if (!Array.isArray(value)) return null
  const parsed: ChapterProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null
    const { start, title } = item as Record<string, unknown>
    if (typeof start !== 'string' || typeof title !== 'string') return null
    parsed.push({ start, title })
  }
  return parsed
}

/** Keeps only the requested field, so a chapters run never fails on the description and the reverse. */
export function interpretWriterReply(
  field: WriteupField,
  text: string,
  chapters: ChapterContext,
): Result<GeneratedText, string> {
  const reply = replyObject(text)
  if (!reply) return { ok: false, problems: ['The reply was not one JSON object.'] }
  switch (field) {
    case 'description': {
      if (typeof reply.description !== 'string') return { ok: false, problems: ['The description must be a string.'] }
      const composed = composeDescription(reply.description)
      return composed.ok
        ? { ok: true, value: composed.value as string as GeneratedText }
        : { ok: false, problems: composed.problems.map(descriptionProblemMessage) }
    }
    case 'chapters': {
      const proposed = proposals(reply.chapters)
      if (!proposed) return { ok: false, problems: ['Chapters must be a list of {"start", "title"} objects.'] }
      const checked = chaptersFromProposals(proposed, chapters.segmentStartsMs, chapters.boundMs)
      if (!checked.ok) return { ok: false, problems: checked.problems.map(chapterProblemMessage) }
      const formatted = formatChapters(checked.value)
      return formatted.length <= DESCRIPTION_MAX_CHARS
        ? { ok: true, value: formatted as GeneratedText }
        : { ok: false, problems: ['The chapter list is too long. Use 5 to 8 chapters.'] }
    }
    default: {
      const unreachable: never = field
      return unreachable
    }
  }
}
