import { parseVideoId, type VideoId } from './videos'
import type { Draft } from './reviews'

export const UPLOAD_PART_SIZE = 32 * 1024 * 1024
export const MAX_UPLOAD_PARTS = 10_000
export const MAX_UPLOAD_BYTES = UPLOAD_PART_SIZE * MAX_UPLOAD_PARTS
export const MAX_DRAFT_DURATION_MS = 24 * 60 * 60 * 1000

export type UploadSessionId = string
export type MediaFileId = string
export type MediaPurpose = 'footage' | 'draft'
export type UploadPurpose =
  | Readonly<{ kind: 'footage' }>
  | Readonly<{ kind: 'draft'; durationMs: number }>
export type UploadState =
  | 'initializing'
  | 'uploading'
  | 'completing'
  | 'ready'
  | 'cancelling'
  | 'cancelled'

export type MediaFile = Readonly<{
  id: MediaFileId
  videoId: VideoId
  purpose: MediaPurpose
  displayName: string
  byteSize: number
  contentType: string
  createdAt: number
  updatedAt: number
}>

type UploadSnapshotBase = Readonly<{
  id: UploadSessionId
  fileId: MediaFileId
  videoId: VideoId
  displayName: string
  byteSize: number
  contentType: string
  purpose: UploadPurpose
  partSize: number
  partCount: number
  uploadedParts: readonly number[]
}>

export type ReadyUpload =
  | Readonly<{ kind: 'footage'; file: MediaFile }>
  | Readonly<{ kind: 'draft'; file: MediaFile; draft: Draft }>

export type UploadSnapshot = UploadSnapshotBase & (
  | Readonly<{ state: Exclude<UploadState, 'ready'>; result: null }>
  | Readonly<{ state: 'ready'; result: ReadyUpload }>
)

export type BeginUpload = Readonly<{
  videoId: VideoId
  clientRequestId: string
  displayName: string
  byteSize: number
  contentType: string
  purpose: UploadPurpose
}>

export type ByteRange = Readonly<{ offset: number; length: number }>

function invalid(message: string): never {
  throw new Error(message)
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('Upload data is required.')
  }
  return value as Record<string, unknown>
}

export function parseMediaId(value: unknown): string {
  if (typeof value !== 'string') return invalid('Media id is required.')
  return parseVideoId(value)
}

export function parseDisplayName(value: unknown): string {
  if (typeof value !== 'string') return invalid('File name is required.')
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '')
  if (name.length < 1 || name.length > 240) {
    return invalid('File name must be between 1 and 240 characters.')
  }
  return name
}

export function parseContentType(value: unknown): string {
  if (typeof value !== 'string') return invalid('Content type is required.')
  const type = value.trim().toLowerCase()
  if (type.length < 1 || type.length > 120 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)) {
    return invalid('Content type is invalid.')
  }
  return type
}

export function parseDurationMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_DRAFT_DURATION_MS) {
    return invalid('Draft duration is invalid.')
  }
  return value
}

export function parseUploadPurpose(value: unknown, contentType: string): UploadPurpose {
  const input = record(value)
  if (input.kind === 'footage') return { kind: 'footage' }
  if (input.kind !== 'draft') return invalid('Upload purpose is invalid.')
  if (!/^(?:video\/(?:mp4|webm|ogg))$/.test(contentType)) {
    return invalid('Drafts must use a supported video format.')
  }
  return { kind: 'draft', durationMs: parseDurationMs(input.durationMs) }
}

export function parseByteSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_UPLOAD_BYTES) {
    return invalid('File size is invalid.')
  }
  return value
}

export function parseBeginUpload(value: unknown): BeginUpload {
  const input = record(value)
  const contentType = parseContentType(input.contentType)
  return {
    videoId: parseVideoId(input.videoId),
    clientRequestId: parseMediaId(input.clientRequestId),
    displayName: parseDisplayName(input.displayName),
    byteSize: parseByteSize(input.byteSize),
    contentType,
    purpose: parseUploadPurpose(input.purpose, contentType),
  }
}

export function partCount(byteSize: number): number {
  return Math.ceil(byteSize / UPLOAD_PART_SIZE)
}

export function expectedPartBytes(byteSize: number, partNumber: number): number {
  const count = partCount(byteSize)
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > count) {
    return invalid('Part number is invalid.')
  }
  return partNumber === count
    ? byteSize - UPLOAD_PART_SIZE * (count - 1)
    : UPLOAD_PART_SIZE
}

export function parsePartNumber(value: unknown): number {
  const part = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (typeof part !== 'number' || !Number.isSafeInteger(part) || part < 1 || part > MAX_UPLOAD_PARTS) {
    return invalid('Part number is invalid.')
  }
  return part
}

export function parseSingleByteRange(value: string | null, size: number): ByteRange | null {
  if (value === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (match[1] === '' && match[2] === '')) return invalid('Range is invalid.')
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix < 1) return invalid('Range is invalid.')
    const length = Math.min(suffix, size)
    return { offset: size - length, length }
  }
  const start = Number(match[1])
  if (!Number.isSafeInteger(start) || start >= size) return invalid('Range is invalid.')
  const requestedEnd = match[2] === '' ? size - 1 : Number(match[2])
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return invalid('Range is invalid.')
  const end = Math.min(requestedEnd, size - 1)
  return { offset: start, length: end - start + 1 }
}

export function sameUpload(left: BeginUpload, right: Omit<BeginUpload, 'videoId'>): boolean {
  return left.clientRequestId === right.clientRequestId
    && left.displayName === right.displayName
    && left.byteSize === right.byteSize
    && left.contentType === right.contentType
    && left.purpose.kind === right.purpose.kind
    && (left.purpose.kind === 'footage'
      || (right.purpose.kind === 'draft' && left.purpose.durationMs === right.purpose.durationMs))
}

export function cleanupDelay(attempt: number): number {
  return Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempt, 20))
}
