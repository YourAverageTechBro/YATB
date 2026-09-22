import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReviewPane } from '../src/components/review-pane'
import type { Draft } from '../src/domain/reviews'

vi.mock('../src/server/reviews.functions', () => ({
  addComment: vi.fn(),
  loadComments: vi.fn(),
  removeComment: vi.fn(),
  saveComment: vi.fn(),
}))

const draft: Draft = {
  id: 'draft-1',
  videoId: 'video-1',
  version: 1,
  durationMs: 2000,
  compactMp4: { state: 'ready', byteSize: 60 },
  file: {
    id: 'file-1', videoId: 'video-1', purpose: 'draft', displayName: 'first edit.mp4',
    byteSize: 100, contentType: 'video/mp4', createdAt: 1, updatedAt: 1,
  },
  author: { id: 'user-1', name: 'Studio User', email: 'studio@example.com' },
  createdAt: 1,
}

describe('draft review pane', () => {
  it('plays and downloads the exact selected version through the authenticated media route', () => {
    const first = renderToStaticMarkup(createElement(ReviewPane, { draft }))
    const second = renderToStaticMarkup(createElement(ReviewPane, {
      draft: { ...draft, id: 'draft-2', version: 2, file: { ...draft.file, id: 'file-2', displayName: 'second edit.mp4' } },
    }))

    expect(first).toContain('src="/api/videos/video-1/media/file-1"')
    expect(first).toContain('href="/api/videos/video-1/media/file-1?download=compressed"')
    expect(first).toContain('aria-label="Download smaller MP4 for version 1: first edit.mp4"')
    expect(first).toContain('href="/api/videos/video-1/media/file-1?download=1"')
    expect(first).toContain('aria-label="Download original version 1: first edit.mp4"')
    expect(first).toContain('aria-label="Seek video"')
    expect(first).toContain('aria-valuetext="0:00 of 0:02"')
    expect(second).toContain('src="/api/videos/video-1/media/file-2"')
    expect(second).toContain('href="/api/videos/video-1/media/file-2?download=1"')
    expect(second).toContain('aria-label="Download original version 2: second edit.mp4"')
    expect(second).not.toContain('/media/file-1')
  })

  it('keeps the original available while the smaller MP4 is processing', () => {
    const markup = renderToStaticMarkup(createElement(ReviewPane, {
      draft: { ...draft, compactMp4: { state: 'queued', byteSize: null } },
    }))
    expect(markup).toContain('Preparing smaller MP4…')
    expect(markup).not.toContain('?download=compressed')
    expect(markup).toContain('?download=1')
  })

  it('makes each version comment region reachable by keyboard after the composer', () => {
    const markup = renderToStaticMarkup(createElement(ReviewPane, { draft }))
    expect(markup).toContain('<aside class="review-rail" aria-label="Review version 1">')
    expect(markup).toContain('aria-label="Comments for version 1" tabindex="0"')
    expect(markup.indexOf('aria-label="Review comment"')).toBeLessThan(markup.indexOf('aria-label="Comments for version 1"'))
    expect(markup).toContain('No review notes yet.')
  })
})
