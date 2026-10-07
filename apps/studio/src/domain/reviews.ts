import { MAX_DRAFT_DURATION_MS, parseMediaId, type MediaFile } from './media'
import { parseRevision, parseVideoId, type VideoId } from './videos'
import { parseRichDocument, type RichDocument } from '../server/rich-document'
import type { MediaDerivative } from './derivatives'
import type { DraftStream } from './stream'
import { normalizeEmail } from './auth'
import { parseShareToken } from './file-library'

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
  guest?: boolean
}>

export type Draft = Readonly<{
  id: DraftId
  videoId: VideoId
  version: number
  durationMs: number
  file: MediaFile
  compactMp4: MediaDerivative
  stream: DraftStream
  author: ReviewAuthor
  createdAt: number
  shareToken: string | null
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
  parentId: ReviewCommentId | null
  resolvedAt: number | null
  anchor: ReviewAnchor
  body: RichDocument
  revision: number
  author: ReviewAuthor
  attachments: readonly MediaFile[]
  createdAt: number
  updatedAt: number
}>

export type ReviewThread = Readonly<{
  root: ReviewComment
  replies: readonly ReviewComment[]
}>

export type CreateReviewComment = Readonly<{
  clientRequestId: ReviewCommentId
  videoId: VideoId
  draftId: DraftId
  parentId: ReviewCommentId | null
  anchor: ReviewAnchor
  body: RichDocument
  attachmentIds: readonly string[]
}>

export type GuestIdentity = Readonly<{
  email: string
  name: string | null
}>

export type CreateGuestReviewComment = Readonly<{
  clientRequestId: ReviewCommentId
  token: string
  parentId: ReviewCommentId | null
  anchor: ReviewAnchor
  text: string
  identity: GuestIdentity
}>

export type ResolveReviewComment = Readonly<{
  videoId: VideoId
  id: ReviewCommentId
  expectedRevision: number
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

export function reviewPlaybackSrc(draft: Draft): string {
  return draft.stream.playbackUrl ?? `/api/videos/${draft.videoId}/media/${draft.file.id}`
}

export function guestReviewPlaybackSrc(token: string, draft: Draft): string {
  return draft.stream.playbackUrl ?? `/api/shared-reviews/${token}`
}

export function commentThreads(comments: readonly ReviewComment[]): ReviewThread[] {
  const replies = new Map<string, ReviewComment[]>()
  for (const comment of comments) {
    if (!comment.parentId) continue
    replies.set(comment.parentId, [...(replies.get(comment.parentId) ?? []), comment])
  }
  return comments
    .filter((comment) => !comment.parentId)
    .map((root) => ({ root, replies: replies.get(root.id) ?? [] }))
}

export function anchorStartMs(anchor: ReviewAnchor): number {
  return anchor.kind === 'point' ? anchor.atMs : anchor.startMs
}

export function commentSeekMs(anchor: ReviewAnchor, durationMs: number): number {
  return clampPlayheadForComment(anchorStartMs(anchor), durationMs)
}

function clampPlayheadForComment(milliseconds: number, durationMs: number): number {
  if (!Number.isFinite(milliseconds) || !Number.isFinite(durationMs) || durationMs <= 0) return 0
  return Math.max(0, Math.min(durationMs, Math.round(milliseconds)))
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

function optionalParentId(value: unknown): ReviewCommentId | null {
  return value === undefined || value === null ? null : parseMediaId(value)
}

export function parseGuestIdentity(value: unknown): GuestIdentity {
  const input = record(value)
  if (typeof input.email !== 'string') return invalid('Email is required.')
  const email = normalizeEmail(input.email)
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid('Email is invalid.')
  const rawName = input.name === undefined || input.name === null ? '' : input.name
  if (typeof rawName !== 'string') return invalid('Name is invalid.')
  const name = rawName.trim().replace(/[\u0000-\u001f\u007f]/g, '')
  if (name.length > 80) return invalid('Name is too long.')
  return { email, name: name || null }
}

export function parseGuestCommentText(value: unknown): string {
  if (typeof value !== 'string') return invalid('Comment text is required.')
  const text = value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  if (!text) return invalid('Comment text is required.')
  if (text.length > 4000) return invalid('Comment text must be at most 4000 characters.')
  return text
}

export function parseCreateReviewComment(value: unknown): CreateReviewComment {
  const input = record(value)
  if (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 12) {
    return invalid('A comment can have at most 12 attachments.')
  }
  const attachmentIds = [...new Set(input.attachmentIds.map(parseMediaId))]
  if (attachmentIds.length !== input.attachmentIds.length) return invalid('Comment attachments must be unique.')
  const parentId = optionalParentId(input.parentId)
  if (parentId && attachmentIds.length > 0) return invalid('Replies cannot include attachments.')
  return {
    clientRequestId: parseMediaId(input.clientRequestId),
    videoId: parseVideoId(input.videoId),
    draftId: parseMediaId(input.draftId),
    parentId,
    anchor: parseReviewAnchor(input.anchor, MAX_DRAFT_DURATION_MS),
    body: parseRichDocument(input.body),
    attachmentIds,
  }
}

export function parseCreateGuestReviewComment(value: unknown): CreateGuestReviewComment {
  const input = record(value)
  return {
    clientRequestId: parseMediaId(input.clientRequestId),
    token: parseShareToken(input.token),
    parentId: optionalParentId(input.parentId),
    anchor: parseReviewAnchor(input.anchor, MAX_DRAFT_DURATION_MS),
    text: parseGuestCommentText(input.text),
    identity: parseGuestIdentity(input.identity),
  }
}

export function parseResolveReviewComment(value: unknown): ResolveReviewComment {
  const input = record(value)
  return {
    videoId: parseVideoId(input.videoId),
    id: parseMediaId(input.id),
    expectedRevision: parseRevision(input.expectedRevision),
  }
}

export function parseDraftShareRequest(value: unknown): Readonly<{ videoId: VideoId; draftId: DraftId }> {
  const input = record(value)
  return { videoId: parseVideoId(input.videoId), draftId: parseMediaId(input.draftId) }
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
