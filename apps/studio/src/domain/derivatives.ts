export const COMPACT_MP4_PROFILE = 'compact-mp4-v1' as const
export const MAX_COMPRESSION_BYTES = 3 * 1024 * 1024 * 1024
export const MAX_COMPRESSION_DURATION_MS = 12 * 60 * 1000

export type MediaDerivativeState =
  | 'queued'
  | 'processing'
  | 'ready'
  | 'not_beneficial'
  | 'unsupported'
  | 'failed'

export type MediaDerivative = Readonly<{
  state: MediaDerivativeState
  byteSize: number | null
}>

export type CompressionJob = Readonly<{
  derivativeId: string
  sourceFileId: string
  profile: typeof COMPACT_MP4_PROFILE
}>

export function derivativeId(sourceFileId: string): string {
  return `${sourceFileId}:${COMPACT_MP4_PROFILE}`
}

export function derivativeObjectKey(videoId: string, sourceFileId: string): string {
  return `videos/${videoId}/derivatives/${sourceFileId}/${COMPACT_MP4_PROFILE}.mp4`
}

export function compressedDisplayName(displayName: string): string {
  const stem = displayName.replace(/\.[^.]+$/, '') || 'video'
  return `${stem} - smaller.mp4`
}

export function supportsCompression(input: Readonly<{
  byteSize: number
  contentType: string
  durationMs: number
}>): boolean {
  return input.byteSize <= MAX_COMPRESSION_BYTES
    && input.durationMs <= MAX_COMPRESSION_DURATION_MS
    && new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/ogg']).has(input.contentType)
}

export function compressedDownloadHttpStatus(state: MediaDerivativeState): number {
  switch (state) {
    case 'ready': return 200
    case 'not_beneficial': return 409
    case 'unsupported': return 422
    case 'failed': return 503
    case 'queued':
    case 'processing': return 202
    default: {
      const unexpected: never = state
      return unexpected
    }
  }
}

export function compressedDownloadStateFromHttpStatus(status: number): MediaDerivativeState {
  switch (status) {
    case 200: return 'ready'
    case 409: return 'not_beneficial'
    case 422: return 'unsupported'
    case 503: return 'failed'
    case 202: return 'processing'
    default: return 'failed'
  }
}

export function isTerminalCompressedDownloadState(state: MediaDerivativeState): boolean {
  switch (state) {
    case 'ready':
    case 'not_beneficial':
    case 'unsupported': return true
    case 'queued':
    case 'processing':
    case 'failed': return false
    default: {
      const unexpected: never = state
      return unexpected
    }
  }
}
