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
    expect(first).toContain('href="/api/videos/video-1/media/file-1?download=1"')
    expect(first).toContain('aria-label="Download version 1: first edit.mp4"')
    expect(second).toContain('src="/api/videos/video-1/media/file-2"')
    expect(second).toContain('href="/api/videos/video-1/media/file-2?download=1"')
    expect(second).toContain('aria-label="Download version 2: second edit.mp4"')
    expect(second).not.toContain('/media/file-1')
  })

  it('makes each version comment region reachable by keyboard after the composer', () => {
    const markup = renderToStaticMarkup(createElement(ReviewPane, { draft }))
    expect(markup).toContain('<aside class="review-rail" aria-label="Review version 1">')
    expect(markup).toContain('aria-label="Comments for version 1" tabindex="0"')
    expect(markup.indexOf('aria-label="Review comment"')).toBeLessThan(markup.indexOf('aria-label="Comments for version 1"'))
    expect(markup).toContain('No review notes yet.')
  })
})
