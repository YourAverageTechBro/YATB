import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileThumbnail } from '../src/components/file-thumbnail'

function render(contentType: string) {
  return renderToStaticMarkup(createElement(FileThumbnail, {
    file: { id: 'file-1', videoId: 'video-1', purpose: 'footage', displayName: 'reference', contentType, byteSize: 1, createdAt: 0, updatedAt: 0 },
    onOpen: () => {},
  }))
}

describe('FileThumbnail', () => {
  it('opens a file from one accessible button with a lazy authenticated image', () => {
    const markup = render('image/png')
    expect(markup).toContain('aria-label="View file: reference"')
    expect(markup).toContain('type="button"')
    expect(markup).toContain('src="/api/videos/video-1/media/file-1"')
    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('alt=""')
    expect(markup.match(/<button/g)).toHaveLength(1)
    expect(markup).not.toContain('<a ')
  })

  it('shows a silent noninteractive video frame without loading or playing the full file', () => {
    const markup = render('video/mp4')
    expect(markup).toContain('<video')
    expect(markup).toContain('src="/api/videos/video-1/media/file-1#t=0.001"')
    expect(markup).toContain('muted=""')
    expect(markup).toContain('playsInline=""')
    expect(markup).toContain('preload="metadata"')
    expect(markup).not.toContain('controls=')
    expect(markup).not.toContain('autoPlay=')
    expect(markup).not.toContain('<a ')
  })

  it('uses inert placeholders for audio and unsupported active formats', () => {
    expect(render('audio/mpeg')).toContain('Audio file')
    for (const type of ['image/svg+xml', 'text/html', 'application/pdf']) {
      const markup = render(type)
      expect(markup).toContain('Preview unavailable')
      expect(markup).not.toMatch(/<(img|video|audio|iframe|object|embed|a)[ >]/)
      expect(markup).not.toContain('src=')
    }
  })
})
