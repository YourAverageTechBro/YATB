import { formatTimestamp } from './reviews'

export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; problems: readonly E[] }>

export const CHAPTER_RULES = {
  minCount: 3,
  minLengthMs: 10_000,
  maxTitleLength: 100,
} as const

export const DESCRIPTION_MAX_CHARS = 5_000

export const DESCRIPTION_FOOTER = [
  'Links',
  'Newsletter: https://youraveragetechbro.com',
  '',
  'Thanks for watching.',
].join('\n')

/** What the writer model proposes. `start` is the `m:ss` label it saw next to a transcript segment. */
export type ChapterProposal = Readonly<{ start: string; title: string }>
export type Chapter = Readonly<{ startMs: number; title: string }>

declare const validChaptersBrand: unique symbol
/** Only `checkChapters` constructs this. */
export type ValidChapters = readonly Chapter[] & { readonly [validChaptersBrand]: true }

declare const validDescriptionBrand: unique symbol
/** Only `composeDescription` constructs this. Body plus footer, at most DESCRIPTION_MAX_CHARS. */
export type ValidDescription = string & { readonly [validDescriptionBrand]: true }

export type ChapterProblem =
  | Readonly<{ kind: 'unreadable-start'; index: number; text: string }>
  | Readonly<{ kind: 'too-few'; count: number }>
  | Readonly<{ kind: 'first-not-zero'; startMs: number }>
  | Readonly<{ kind: 'out-of-order'; index: number }>
  | Readonly<{ kind: 'duplicate-start'; index: number; startMs: number }>
  | Readonly<{ kind: 'too-short'; index: number; lengthMs: number }>
  | Readonly<{ kind: 'past-end'; index: number; startMs: number; boundMs: number }>
  | Readonly<{ kind: 'blank-title'; index: number }>
  | Readonly<{ kind: 'title-too-long'; index: number }>

export type DescriptionProblem =
  | Readonly<{ kind: 'missing-summary' }>
  | Readonly<{ kind: 'hashtag'; tag: string }>
  | Readonly<{ kind: 'too-long'; length: number }>

export function parseChapterTimestamp(value: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = match[1] === undefined ? 0 : Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (seconds >= 60 || (match[1] !== undefined && minutes >= 60)) return null
  return ((hours * 60 + minutes) * 60 + seconds) * 1000
}

function wholeSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000
}

function singleLine(title: string): string {
  return title.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
}

/** The candidate at the smallest distance from `ms`. `ascending` is sorted, so ties keep the earlier start. */
function nearest(ascending: readonly number[], ms: number): number | null {
  let best: number | null = null
  for (const candidate of ascending) {
    if (best === null || Math.abs(candidate - ms) < Math.abs(best - ms)) best = candidate
  }
  return best
}

/**
 * Pins the first chapter to 0:00. Moves every later start to the nearest transcript segment start at or
 * before `boundMs - minLengthMs`, so each start lands on speech and the last chapter can still run its
 * minimum length. Starts are floored to whole seconds, because YouTube reads `m:ss`.
 */
export function snapChapterStarts(
  proposals: readonly ChapterProposal[],
  segmentStartsMs: readonly number[],
  boundMs: number,
): Result<Chapter[], ChapterProblem> {
  const latest = boundMs - CHAPTER_RULES.minLengthMs
  const candidates = segmentStartsMs.filter((start) => start <= latest).sort((left, right) => left - right)
  const problems: ChapterProblem[] = []
  const chapters = proposals.map((proposal, index) => {
    const title = singleLine(proposal.title)
    if (index === 0) return { startMs: 0, title }
    const requested = parseChapterTimestamp(proposal.start)
    if (requested === null) {
      problems.push({ kind: 'unreadable-start', index, text: proposal.start })
      return { startMs: 0, title }
    }
    return { startMs: wholeSecond(nearest(candidates, requested) ?? requested), title }
  })
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: chapters }
}

/** YouTube's chapter rules. Reads nothing but the list and the bound, so it also judges hand-edited text. */
export function checkChapters(chapters: readonly Chapter[], boundMs: number): Result<ValidChapters, ChapterProblem> {
  const problems: ChapterProblem[] = []
  if (chapters.length < CHAPTER_RULES.minCount) problems.push({ kind: 'too-few', count: chapters.length })
  const first = chapters[0]
  if (first && first.startMs !== 0) problems.push({ kind: 'first-not-zero', startMs: first.startMs })
  chapters.forEach((chapter, index) => {
    if (!chapter.title.trim()) problems.push({ kind: 'blank-title', index })
    else if (chapter.title.length > CHAPTER_RULES.maxTitleLength) problems.push({ kind: 'title-too-long', index })
    const next = chapters[index + 1]
    if (next) {
      if (next.startMs === chapter.startMs) problems.push({ kind: 'duplicate-start', index: index + 1, startMs: next.startMs })
      else if (next.startMs < chapter.startMs) problems.push({ kind: 'out-of-order', index: index + 1 })
      else if (next.startMs - chapter.startMs < CHAPTER_RULES.minLengthMs) {
        problems.push({ kind: 'too-short', index, lengthMs: next.startMs - chapter.startMs })
      }
    } else if (chapter.startMs >= boundMs) {
      problems.push({ kind: 'past-end', index, startMs: chapter.startMs, boundMs })
    } else if (boundMs - chapter.startMs < CHAPTER_RULES.minLengthMs) {
      problems.push({ kind: 'too-short', index, lengthMs: boundMs - chapter.startMs })
    }
  })
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: chapters as ValidChapters }
}

/** Generation path. Snap, then check. */
export function chaptersFromProposals(
  proposals: readonly ChapterProposal[],
  segmentStartsMs: readonly number[],
  boundMs: number,
): Result<ValidChapters, ChapterProblem> {
  const snapped = snapChapterStarts(proposals, segmentStartsMs, boundMs)
  return snapped.ok ? checkChapters(snapped.value, boundMs) : snapped
}

/** Reads one `m:ss Title` chapter per non-blank line. */
export function parseChapterText(text: string): Result<Chapter[], ChapterProblem> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const problems: ChapterProblem[] = []
  const chapters = lines.map((line, index) => {
    const match = /^(\S+)\s*(.*)$/.exec(line)
    const startMs = match ? parseChapterTimestamp(match[1] ?? '') : null
    if (startMs === null) {
      problems.push({ kind: 'unreadable-start', index, text: line })
      return { startMs: 0, title: line }
    }
    return { startMs, title: match?.[2] ?? '' }
  })
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: chapters }
}

/** Problems with chapter text as typed. Empty text has nothing to check. */
export function chapterTextProblems(text: string, boundMs: number): readonly ChapterProblem[] {
  if (!text.trim()) return []
  const parsed = parseChapterText(text)
  if (!parsed.ok) return parsed.problems
  const checked = checkChapters(parsed.value, boundMs)
  return checked.ok ? [] : checked.problems
}

/** One `m:ss Title` line per chapter. Drafts are capped at 30 minutes, so hours never appear. */
export function formatChapters(chapters: ValidChapters): string {
  return chapters.map((chapter) => `${formatTimestamp(chapter.startMs)} ${chapter.title}`).join('\n')
}

export function chapterProblemMessage(problem: ChapterProblem): string {
  switch (problem.kind) {
    case 'unreadable-start':
      return `Chapter ${problem.index + 1} does not start with a time like 1:05.`
    case 'too-few':
      return `YouTube needs at least ${CHAPTER_RULES.minCount} chapters. This list has ${problem.count}.`
    case 'first-not-zero':
      return `The first chapter must start at 0:00, not ${formatTimestamp(problem.startMs)}.`
    case 'out-of-order':
      return `Chapter ${problem.index + 1} starts before the chapter above it.`
    case 'duplicate-start':
      return `Chapter ${problem.index + 1} starts at ${formatTimestamp(problem.startMs)}, the same time as the chapter above it.`
    case 'too-short':
      return `Chapter ${problem.index + 1} runs ${Math.max(0, Math.floor(problem.lengthMs / 1000))} seconds. Each chapter needs at least ${CHAPTER_RULES.minLengthMs / 1000} seconds.`
    case 'past-end':
      return `Chapter ${problem.index + 1} starts at ${formatTimestamp(problem.startMs)}, at or past the end at ${formatTimestamp(problem.boundMs)}.`
    case 'blank-title':
      return `Chapter ${problem.index + 1} needs a title.`
    case 'title-too-long':
      return `Chapter ${problem.index + 1} has a title over ${CHAPTER_RULES.maxTitleLength} characters.`
    default: {
      const unreachable: never = problem
      return unreachable
    }
  }
}

/**
 * `body` is the hook paragraph and the short summary. Requires both, rejects hashtags, strips angle
 * brackets, appends DESCRIPTION_FOOTER, and enforces DESCRIPTION_MAX_CHARS.
 */
export function composeDescription(body: string): Result<ValidDescription, DescriptionProblem> {
  const paragraphs = body.replace(/[<>]/g, '').split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
  const problems: DescriptionProblem[] = []
  if (paragraphs.length < 2) problems.push({ kind: 'missing-summary' })
  for (const match of body.matchAll(/(?:^|\s)(#[\p{L}\p{N}_]+)/gu)) problems.push({ kind: 'hashtag', tag: match[1] ?? '#' })
  const text = `${paragraphs.join('\n\n')}\n\n${DESCRIPTION_FOOTER}`
  if (text.length > DESCRIPTION_MAX_CHARS) problems.push({ kind: 'too-long', length: text.length })
  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: text as ValidDescription }
}

export function descriptionProblemMessage(problem: DescriptionProblem): string {
  switch (problem.kind) {
    case 'missing-summary':
      return 'The description needs a hook paragraph and then a short summary paragraph, separated by a blank line.'
    case 'hashtag':
      return `The description must not use hashtags. Remove ${problem.tag}.`
    case 'too-long':
      return `The description is ${problem.length} characters with the footer. Keep it under ${DESCRIPTION_MAX_CHARS}.`
    default: {
      const unreachable: never = problem
      return unreachable
    }
  }
}
