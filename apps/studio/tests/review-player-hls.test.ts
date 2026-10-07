import { afterEach, describe, expect, it, vi } from 'vitest'

const loadSource = vi.fn()
const attachMedia = vi.fn()
const destroy = vi.fn()
const on = vi.fn()

vi.mock('hls.js', () => {
  class Hls {
    static isSupported() { return true }
    static Events = { ERROR: 'hlsError' }
    loadSource = loadSource
    attachMedia = attachMedia
    destroy = destroy
    on = on
  }
  return { default: Hls }
})

const { attachAdaptivePlayback, usesNativeVideoSrc } = await import('../src/components/review-player')

afterEach(() => {
  loadSource.mockClear()
  attachMedia.mockClear()
  destroy.mockClear()
  on.mockClear()
})

describe('Chromium HLS attach', () => {
  it('loads the signed Stream manifest through hls.js when native HLS is absent', () => {
    const media = {
      canPlayType: () => '',
    } as unknown as HTMLVideoElement
    const signed = 'https://customer-test.cloudflarestream.com/signed-token/manifest/video.m3u8'
    const cleanup = attachAdaptivePlayback(media, signed, () => undefined)
    expect(loadSource).toHaveBeenCalledWith(signed)
    expect(attachMedia).toHaveBeenCalledWith(media)
    cleanup()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('does not attach hls.js for progressive R2', () => {
    const r2 = { canPlayType: () => '' } as unknown as HTMLVideoElement
    attachAdaptivePlayback(r2, '/api/videos/video-1/media/file-1', () => undefined)
    expect(loadSource).not.toHaveBeenCalled()
    expect(usesNativeVideoSrc('/api/videos/video-1/media/file-1')).toBe(true)
  })

  it('attaches hls.js even when canPlayType claims native HLS', () => {
    const safari = { canPlayType: (type: string) => type.includes('mpegurl') ? 'probably' : '' } as unknown as HTMLVideoElement
    attachAdaptivePlayback(safari, 'https://customer-test.cloudflarestream.com/tok/manifest/video.m3u8', () => undefined)
    expect(loadSource).toHaveBeenCalledOnce()
  })

  it('ignores non-fatal hls.js errors and fails closed without a fallback', () => {
    const media = { canPlayType: () => '', src: '' } as unknown as HTMLVideoElement
    const onError = vi.fn()
    attachAdaptivePlayback(media, 'https://customer-test.cloudflarestream.com/signed-token/manifest/video.m3u8', onError)
    const handler = on.mock.calls[0]?.[1] as (event: string, data: { fatal: boolean }) => void
    handler('hlsError', { fatal: false })
    expect(onError).not.toHaveBeenCalled()
    expect(destroy).not.toHaveBeenCalled()
    handler('hlsError', { fatal: true })
    expect(onError).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
    expect(media.src).toBe('')
  })

  it('switches to progressive fallback after a fatal hls.js error', () => {
    const media = { canPlayType: () => '', src: '' } as unknown as HTMLVideoElement
    const onError = vi.fn()
    const fallback = '/api/shared-reviews/' + 'a'.repeat(64)
    attachAdaptivePlayback(
      media,
      'https://customer-test.cloudflarestream.com/signed-token/manifest/video.m3u8',
      onError,
      fallback,
    )
    const handler = on.mock.calls[0]?.[1] as (event: string, data: { fatal: boolean }) => void
    handler('hlsError', { fatal: false })
    expect(media.src).toBe('')
    expect(onError).not.toHaveBeenCalled()
    handler('hlsError', { fatal: true })
    expect(media.src).toBe(fallback)
    expect(onError).not.toHaveBeenCalled()
    handler('hlsError', { fatal: true })
    expect(onError).not.toHaveBeenCalled()
  })
})
