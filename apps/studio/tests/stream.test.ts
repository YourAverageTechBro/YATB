import { describe, expect, it } from 'vitest'
import {
  STREAM_MAX_BYTES,
  hmacHex,
  parseStreamWebhook,
  parseWebhookSignature,
  signedManifestUrl,
  signedThumbnailUrl,
  streamFits,
  streamStatusLabel,
  streamTokenValue,
  verifyIngestMac,
  verifyWebhookSignature,
} from '../src/domain/stream'

describe('stream ingest limits', () => {
  it('accepts files at the 30 GB Stream ceiling and rejects larger originals', () => {
    expect(streamFits(STREAM_MAX_BYTES)).toBe(true)
    expect(streamFits(STREAM_MAX_BYTES + 1)).toBe(false)
    expect(streamFits(0)).toBe(false)
    expect(streamStatusLabel('oversized')).toMatch(/30 GB/)
  })
})

describe('signed Stream playback URLs', () => {
  it('replaces the video id with the token in HLS and thumbnail paths', () => {
    const hls = 'https://customer-x.cloudflarestream.com/video-id/manifest/video.m3u8'
    expect(signedManifestUrl(hls, 'video-id', 'tok')).toBe(
      'https://customer-x.cloudflarestream.com/tok/manifest/video.m3u8',
    )
    expect(signedThumbnailUrl(hls, 'video-id', 'tok')).toBe(
      'https://customer-x.cloudflarestream.com/tok/thumbnails/thumbnail.jpg',
    )
    expect(() => signedManifestUrl(hls, 'other', 'tok')).toThrow('Playback URL')
    expect(streamTokenValue({ token: 'abc' })).toBe('abc')
  })
})

describe('stream webhook and ingest signatures', () => {
  it('parses webhook events and verifies HMAC signatures', async () => {
    const body = JSON.stringify({
      uid: 'vid-1',
      readyToStream: true,
      status: { state: 'ready', errorReasonText: '' },
    })
    expect(parseStreamWebhook(JSON.parse(body))).toEqual({ uid: 'vid-1', ready: true, error: null })
    expect(parseStreamWebhook({
      id: 'vid-2',
      readyToStream: false,
      status: { state: 'error', errReasonText: 'bad file' },
    })).toEqual({ uid: 'vid-2', ready: false, error: 'bad file' })

    const time = 1_700_000_000
    const secret = 'webhook-secret'
    const sig1 = await hmacHex(secret, `${time}.${body}`)
    expect(parseWebhookSignature(`time=${time},sig1=${sig1}`)).toEqual({ time, sig1 })
    expect(await verifyWebhookSignature(secret, `time=${time},sig1=${sig1}`, body, time * 1000)).toBe(true)
    expect(await verifyWebhookSignature(secret, `time=${time},sig1=${'0'.repeat(64)}`, body, time * 1000)).toBe(false)

    const fileId = '1b0e913b-645c-4306-a71d-78115390b46d'
    const exp = Date.now() + 60_000
    const mac = await hmacHex(secret, `${fileId}.${exp}`)
    expect(await verifyIngestMac(secret, fileId, exp, mac)).toBe(true)
    expect(await verifyIngestMac(secret, fileId, Date.now() - 1, mac)).toBe(false)
  })
})
