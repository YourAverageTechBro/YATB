export type ReviewAnchor =
  | Readonly<{ kind: 'point'; atMs: number }>
  | Readonly<{ kind: 'range'; startMs: number; endMs: number }>

export const COMMENT_STATUSES = ['open', 'addressed', 'resolved'] as const
export type CommentStatus = (typeof COMMENT_STATUSES)[number]
export type Author = 'thomas' | 'claude'

const TRANSITIONS: Readonly<Record<CommentStatus, readonly CommentStatus[]>> = {
  open: ['addressed'],
  addressed: ['open', 'resolved'],
  resolved: ['open'],
}

export function canTransition(from: CommentStatus, to: CommentStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function nextStatuses(from: CommentStatus): readonly CommentStatus[] {
  return TRANSITIONS[from]
}

export class ReviewError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export type Project = Readonly<{ slug: string; title: string; createdAt: number }>
export type Draft = Readonly<{ id: string; projectSlug: string; version: number; filePath: string; note: string; createdAt: number }>
export type ProjectSummary = Readonly<{
  slug: string
  title: string
  latestVersion: number | null
  openCount: number
  lastActivityAt: number
}>

type CommentBase = Readonly<{
  id: string
  draftId: string
  author: Author
  body: string
  anchor: ReviewAnchor
  createdAt: number
  updatedAt: number
}>
export type RootComment = CommentBase & Readonly<{ parentId: null; status: CommentStatus }>
export type Reply = CommentBase & Readonly<{ parentId: string; status: null }>
export type Comment = RootComment | Reply
export type Thread = Readonly<{ root: RootComment; replies: readonly Reply[] }>

export type ProjectDetail = Readonly<{ project: Project; drafts: readonly Draft[]; comments: readonly Comment[] }>

export const MAX_BODY_LENGTH = 4000
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function parseSlug(input: unknown): string {
  if (typeof input !== 'string' || !SLUG.test(input)) throw new ReviewError('slug must be kebab-case, like my-video-review')
  return input
}

export function parseBody(input: unknown): string {
  const body = typeof input === 'string' ? input.trim() : ''
  if (body.length === 0 || body.length > MAX_BODY_LENGTH) throw new ReviewError(`comment must be 1 to ${MAX_BODY_LENGTH} characters`)
  return body
}

export function parseStatus(input: unknown): CommentStatus {
  if (!COMMENT_STATUSES.includes(input as CommentStatus)) throw new ReviewError(`status must be one of ${COMMENT_STATUSES.join(', ')}`)
  return input as CommentStatus
}

function parseMs(input: unknown, name: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) throw new ReviewError(`${name} must be a non-negative number of milliseconds`)
  return Math.round(input)
}

export function parseAnchor(input: unknown): ReviewAnchor {
  const value = (input ?? {}) as Record<string, unknown>
  if (value.kind === 'point') return { kind: 'point', atMs: parseMs(value.atMs, 'atMs') }
  if (value.kind === 'range') {
    const startMs = parseMs(value.startMs, 'startMs')
    const endMs = parseMs(value.endMs, 'endMs')
    if (endMs <= startMs) throw new ReviewError('range end must be after its start')
    return { kind: 'range', startMs, endMs }
  }
  throw new ReviewError("anchor.kind must be 'point' or 'range'")
}

export function anchorStartMs(anchor: ReviewAnchor): number {
  return anchor.kind === 'point' ? anchor.atMs : anchor.startMs
}

export function formatTimestamp(milliseconds: number): string {
  const tenths = Math.floor(Math.max(0, milliseconds) / 100)
  const seconds = Math.floor(tenths / 10) % 60
  const minutes = Math.floor(tenths / 600) % 60
  const hours = Math.floor(tenths / 36000)
  const tail = `${String(seconds).padStart(2, '0')}.${tenths % 10}`
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`
}

export function formatAnchor(anchor: ReviewAnchor): string {
  return anchor.kind === 'point' ? formatTimestamp(anchor.atMs) : `${formatTimestamp(anchor.startMs)}–${formatTimestamp(anchor.endMs)}`
}

export function commentThreads(comments: readonly Comment[]): Thread[] {
  const replies = new Map<string, Reply[]>()
  for (const comment of comments) {
    if (comment.parentId !== null) replies.set(comment.parentId, [...(replies.get(comment.parentId) ?? []), comment])
  }
  return comments.flatMap((comment) => comment.parentId === null ? [{ root: comment, replies: replies.get(comment.id) ?? [] }] : [])
}
