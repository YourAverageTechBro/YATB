export const STREAM_MAX_BYTES = 30 * 1024 * 1024 * 1024
export const STREAM_INGEST_TTL_MS = 6 * 60 * 60 * 1000
export const STREAM_WEBHOOK_MAX_AGE_MS = 10 * 60 * 1000

export type DraftStreamState =
  | 'queued'
  | 'copying'
  | 'ready'
  | 'failed'
  | 'oversized'
  | 'unavailable'

export type DraftStream = Readonly<{
  state: DraftStreamState
  uid: string | null
  playbackUrl: string | null
  thumbnailUrl: string | null
}>

export function emptyDraftStream(state: DraftStreamState = 'queued'): DraftStream {
  return { state, uid: null, playbackUrl: null, thumbnailUrl: null }
}

export function streamFits(byteSize: number): boolean {
  return Number.isSafeInteger(byteSize) && byteSize > 0 && byteSize <= STREAM_MAX_BYTES
}

export function parseDraftStreamState(value: unknown): DraftStreamState {
  switch (value) {
    case 'queued':
    case 'copying':
    case 'ready':
    case 'failed':
    case 'oversized':
    case 'unavailable':
      return value
    default:
      return 'queued'
  }
}

export function streamStatusLabel(state: DraftStreamState): string {
  switch (state) {
    case 'ready':
      return 'Adaptive stream is ready.'
    case 'copying':
    case 'queued':
      return 'Preparing adaptive stream… Original progressive playback is temporary.'
    case 'oversized':
      return 'This file is larger than Cloudflare Stream’s 30 GB limit. Review uses the original file.'
    case 'failed':
      return 'Adaptive stream could not be prepared. Review is using the original file.'
    case 'unavailable':
      return 'Adaptive stream is not configured in this environment. Review uses the original file.'
    default: {
      const exhaustive: never = state
      return exhaustive
    }
  }
}

export function signedManifestUrl(hlsPlaybackUrl: string, videoId: string, token: string): string {
  if (!videoId || !hlsPlaybackUrl.includes(videoId)) {
    throw new Error('Playback URL does not match the Stream video.')
  }
  return hlsPlaybackUrl.replaceAll(videoId, token)
}

export function signedThumbnailUrl(hlsPlaybackUrl: string, videoId: string, token: string): string {
  return signedManifestUrl(hlsPlaybackUrl, videoId, token)
    .replace(/\/manifest\/video\.m3u8(?:\?.*)?$/, '/thumbnails/thumbnail.jpg')
}

export function parseWebhookSignature(header: string | null): { time: number; sig1: string } | null {
  if (!header) return null
  const parts = Object.fromEntries(header.split(',').map((part) => {
    const index = part.indexOf('=')
    return index === -1 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()]
  }))
  const time = Number(parts.time)
  const sig1 = parts.sig1
  if (!Number.isSafeInteger(time) || time <= 0 || !sig1 || !/^[0-9a-f]+$/i.test(sig1)) return null
  return { time, sig1 }
}

export function parseStreamWebhook(value: unknown): { uid: string; ready: boolean; error: string | null } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stream webhook body is invalid.')
  }
  const input = value as Record<string, unknown>
  const uid = typeof input.uid === 'string' && input.uid.length > 0
    ? input.uid
    : typeof input.id === 'string' && input.id.length > 0 ? input.id : null
  if (!uid) throw new Error('Stream webhook is missing a video id.')
  const status = input.status && typeof input.status === 'object' && !Array.isArray(input.status)
    ? input.status as Record<string, unknown>
    : null
  const state = typeof status?.state === 'string' ? status.state : ''
  const error = typeof status?.errorReasonText === 'string' && status.errorReasonText
    ? status.errorReasonText
    : typeof status?.errReasonText === 'string' && status.errReasonText
      ? status.errReasonText
      : null
  return { uid, ready: input.readyToStream === true && state !== 'error', error }
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sameHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

export async function ingestMac(secret: string, fileId: string, exp: number): Promise<string> {
  return hmacHex(secret, `${fileId}.${exp}`)
}

export async function verifyIngestMac(
  secret: string,
  fileId: string,
  exp: number,
  mac: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isSafeInteger(exp) || exp <= now || exp > now + STREAM_INGEST_TTL_MS + 60_000) return false
  if (!/^[0-9a-f]+$/i.test(mac)) return false
  return sameHex((await ingestMac(secret, fileId, exp)).toLowerCase(), mac.toLowerCase())
}

export async function verifyWebhookSignature(
  secret: string,
  header: string | null,
  body: string,
  now = Date.now(),
): Promise<boolean> {
  const parsed = parseWebhookSignature(header)
  if (!parsed) return false
  if (Math.abs(now - parsed.time * 1000) > STREAM_WEBHOOK_MAX_AGE_MS) return false
  const expected = await hmacHex(secret, `${parsed.time}.${body}`)
  return sameHex(expected.toLowerCase(), parsed.sig1.toLowerCase())
}

export function streamVideoId(video: { id?: unknown; uid?: unknown }): string | null {
  if (typeof video.id === 'string' && video.id.length > 0) return video.id
  if (typeof video.uid === 'string' && video.uid.length > 0) return video.uid
  return null
}

export function streamHlsUrl(video: { hlsPlaybackUrl?: unknown; playback?: unknown }): string | null {
  if (typeof video.hlsPlaybackUrl === 'string' && video.hlsPlaybackUrl.includes('/manifest/')) {
    return video.hlsPlaybackUrl
  }
  if (video.playback && typeof video.playback === 'object' && video.playback !== null) {
    const hls = (video.playback as { hls?: unknown }).hls
    if (typeof hls === 'string' && hls.includes('/manifest/')) return hls
  }
  return null
}

export function streamTokenValue(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const token = (value as { token?: unknown }).token
    if (typeof token === 'string' && token.length > 0) return token
  }
  throw new Error('Stream token was empty.')
}
