import { MAX_DRAFT_DURATION_MS, parseMediaId, type MediaFile } from './media'
import { parseRevision, parseVideoId, type VideoId } from './videos'
import { parseRichDocument, type RichDocument } from '../server/rich-document'

export type DraftId = string
export type ReviewCommentId = string

export type ComparisonQuery = Readonly<{
  left?: DraftId
  right?: DraftId
}>

export type ComparisonSelection = Readonly<{
  left: DraftId
  right: DraftId
}>

export type ReviewAuthor = Readonly<{
  id: string
  name: string
  email: string
}>

export type Draft = Readonly<{
  id: DraftId
  videoId: VideoId
  version: number
  durationMs: number
  file: MediaFile
  author: ReviewAuthor
  createdAt: number
}>

export type ComparisonModel = Readonly<{
  drafts: Draft[]
  selection: ComparisonSelection | null
}>

export type ReviewAnchor =
  | Readonly<{ kind: 'point'; atMs: number }>
  | Readonly<{ kind: 'range'; startMs: number; endMs: number }>

export type ReviewComment = Readonly<{
  id: ReviewCommentId
  videoId: VideoId
  draftId: DraftId
  anchor: ReviewAnchor
  body: RichDocument
  revision: number
  author: ReviewAuthor
  attachments: readonly MediaFile[]
  createdAt: number
  updatedAt: number
}>

export type CreateReviewComment = Readonly<{
  clientRequestId: ReviewCommentId
  videoId: VideoId
  draftId: DraftId
  anchor: ReviewAnchor
  body: RichDocument
  attachmentIds: readonly string[]
}>

export type EditReviewComment = Readonly<{
  videoId: VideoId
  id: ReviewCommentId
  expectedRevision: number
  body: RichDocument
}>

function invalid(message: string): never {
  throw new Error(message)
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('Review data is required.')
  }
  return value as Record<string, unknown>
}

function optionalDraftId(value: unknown): DraftId | undefined {
  return value === undefined ? undefined : parseMediaId(value)
}

export function parseComparisonQuery(value: unknown): ComparisonQuery {
  const input = record(value)
  return {
    left: optionalDraftId(input.left),
    right: optionalDraftId(input.right),
  }
}

export function resolveComparison(drafts: Draft[], query: ComparisonQuery): ComparisonModel {
  const hasLeft = query.left !== undefined
  const hasRight = query.right !== undefined
  if (hasLeft !== hasRight) return invalid('Comparison is unavailable.')

  if (!query.left || !query.right) {
    return {
      drafts,
      selection: drafts.length >= 2 ? { left: drafts[0]!.id, right: drafts[1]!.id } : null,
    }
  }

  if (query.left === query.right) return invalid('Comparison is unavailable.')
  const ids = new Set(drafts.map((draft) => draft.id))
  if (!ids.has(query.left) || !ids.has(query.right)) return invalid('Comparison is unavailable.')
  return { drafts, selection: { left: query.left, right: query.right } }
}

export function partitionComparison(model: ComparisonModel): Readonly<{ left: Draft; right: Draft }> | null {
  if (!model.selection) return null
  const byId = new Map(model.drafts.map((draft) => [draft.id, draft]))
  const left = byId.get(model.selection.left)
  const right = byId.get(model.selection.right)
  if (!left || !right) return invalid('Comparison is unavailable.')
  return { left, right }
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_DRAFT_DURATION_MS) {
    return invalid('Comment timestamp is invalid.')
  }
  return value
}

export function parseReviewAnchor(value: unknown, durationMs: number): ReviewAnchor {
  const input = record(value)
  if (input.kind === 'point') {
    const atMs = parseTimestampMs(input.atMs)
    if (atMs > durationMs) return invalid('Comment timestamp exceeds the draft duration.')
    return { kind: 'point', atMs }
  }
  if (input.kind === 'range') {
    const startMs = parseTimestampMs(input.startMs)
    const endMs = parseTimestampMs(input.endMs)
    if (startMs >= endMs) return invalid('Comment range must end after it starts.')
    if (endMs > durationMs) return invalid('Comment range exceeds the draft duration.')
    return { kind: 'range', startMs, endMs }
  }
  return invalid('Comment anchor is invalid.')
}

export function anchorStartMs(anchor: ReviewAnchor): number {
  return anchor.kind === 'point' ? anchor.atMs : anchor.startMs
}

export function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds % 3600 / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function parseCreateReviewComment(value: unknown): CreateReviewComment {
  const input = record(value)
  if (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 12) {
    return invalid('A comment can have at most 12 attachments.')
  }
  const attachmentIds = [...new Set(input.attachmentIds.map(parseMediaId))]
  if (attachmentIds.length !== input.attachmentIds.length) return invalid('Comment attachments must be unique.')
  return {
    clientRequestId: parseMediaId(input.clientRequestId),
    videoId: parseVideoId(input.videoId),
    draftId: parseMediaId(input.draftId),
    anchor: parseReviewAnchor(input.anchor, MAX_DRAFT_DURATION_MS),
    body: parseRichDocument(input.body),
    attachmentIds,
  }
}

export function parseEditReviewComment(value: unknown): EditReviewComment {
  const input = record(value)
  return {
    videoId: parseVideoId(input.videoId),
    id: parseMediaId(input.id),
    expectedRevision: parseRevision(input.expectedRevision),
    body: parseRichDocument(input.body),
  }
}

export function parseDeleteReviewComment(value: unknown): Readonly<{
  videoId: VideoId
  id: ReviewCommentId
  expectedRevision: number
}> {
  const input = record(value)
  return {
    videoId: parseVideoId(input.videoId),
    id: parseMediaId(input.id),
    expectedRevision: parseRevision(input.expectedRevision),
  }
}
