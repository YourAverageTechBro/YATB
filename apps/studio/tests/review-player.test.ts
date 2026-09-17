import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTimelinePaint, clampPlayheadMs, intrinsicAspectRatio, ReviewPlayer, type ReviewTimelineMarker } from '../src/components/review-player'

describe('review video dimensions', () => {
  it('derives intrinsic aspect ratios only from usable dimensions', () => {
    expect(intrinsicAspectRatio(1080, 1920)).toBe(9 / 16)
    expect(intrinsicAspectRatio(1920, 1080)).toBe(16 / 9)
    expect(intrinsicAspectRatio(0, 1080)).toBeUndefined()
    expect(intrinsicAspectRatio(1920, Number.NaN)).toBeUndefined()
  })

  it('uses a landscape fallback until video metadata supplies a ratio', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('aspect-ratio: var(--review-video-aspect-ratio, 16 / 9)')
  })
})

describe('review timeline', () => {
  it('paints overlapping ranges before exact grouped points without changing the input', () => {
    const markers: readonly ReviewTimelineMarker[] = [
      { commentId: 'point-a', anchor: { kind: 'point', atMs: 500 } },
      { commentId: 'range-a', anchor: { kind: 'range', startMs: 500, endMs: 1500 } },
      { commentId: 'point-b', anchor: { kind: 'point', atMs: 500 } },
      { commentId: 'range-b', anchor: { kind: 'range', startMs: 0, endMs: 1000 } },
      { commentId: 'end', anchor: { kind: 'point', atMs: 2000 } },
    ]
    const before = structuredClone(markers)
    expect(buildTimelinePaint(markers, 2000)).toEqual([
      { kind: 'range', startPercent: 25, widthPercent: 50, commentId: 'range-a' },
      { kind: 'range', startPercent: 0, widthPercent: 50, commentId: 'range-b' },
      { kind: 'point', atPercent: 25, commentIds: ['point-a', 'point-b'] },
      { kind: 'point', atPercent: 100, commentIds: ['end'] },
    ])
    expect(markers).toEqual(before)
  })

  it('clamps finite geometry and rejects unusable duration or anchors', () => {
    expect(clampPlayheadMs(-1, 1000)).toBe(0)
    expect(clampPlayheadMs(1001, 1000)).toBe(1000)
    expect(clampPlayheadMs(500.4, 1000)).toBe(500)
    expect(clampPlayheadMs(Infinity, 1000)).toBe(0)
    expect(buildTimelinePaint([{ commentId: 'p', anchor: { kind: 'point', atMs: 1 } }], 0)).toEqual([])
    expect(buildTimelinePaint([{ commentId: 'p', anchor: { kind: 'point', atMs: NaN } }], 1000)).toEqual([])
    expect(buildTimelinePaint([{ commentId: 'r', anchor: { kind: 'range', startMs: -100, endMs: 1100 } }], 1000)).toEqual([
      { kind: 'range', startPercent: 0, widthPercent: 100, commentId: 'r' },
    ])
  })
})

describe('review player controls', () => {
  it('renders named controls and an informational timeline with no marker tab stops', () => {
    const markup = renderToStaticMarkup(createElement(ReviewPlayer, {
      src: '/api/videos/video-1/media/file-1', durationMs: 2000, label: 'Version 1', onPlayheadChange: () => undefined,
      markers: [{ commentId: 'p', anchor: { kind: 'point', atMs: 500 } }],
    }))
    for (const name of ['Play video', 'Seek video', 'Volume', 'Mute video', 'Playback speed', 'Fullscreen unavailable']) {
      expect(markup).toContain(`aria-label="${name}"`)
    }
    expect(markup).toContain('playsInline=""')
    expect(markup).not.toMatch(/<video[^>]*\scontrols[=\s>]/)
    expect(markup).toContain('aria-valuetext="0:00 of 0:02"')
    expect(markup).toContain('1 comment is marked on the timeline.')
    expect(markup).toContain('Use the timestamp buttons in the comments list')
    expect(markup).toContain('Comments: ticks mark points, bars mark ranges.')
    expect(markup).toContain('<span class="comment-point-marker" style="left:25%;width:2px"></span>')
  })

  it('describes an empty timeline and disables unavailable media controls', () => {
    const markup = renderToStaticMarkup(createElement(ReviewPlayer, {
      src: '/video.mp4', durationMs: 0, label: 'Version 1', markers: [], onPlayheadChange: () => undefined,
    }))
    expect(markup).toContain('No comments are marked on the timeline.')
    expect(markup).toMatch(/<span[^>]*aria-disabled="true"[^>]*aria-label="Seek video"/)
    expect(markup).not.toContain('NaN')
  })
})
