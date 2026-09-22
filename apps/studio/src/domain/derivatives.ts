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
