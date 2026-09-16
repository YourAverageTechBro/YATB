import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MediaPreview } from '../src/components/media-preview'

function render(contentType: string, name = 'take 1') {
  return renderToStaticMarkup(createElement(MediaPreview, {
    contentType,
    name,
    src: '/api/videos/video-1/media/file-1',
  }))
}

describe('MediaPreview', () => {
  it('links a lazy image thumbnail to its authenticated media URL', () => {
    const markup = render('image/png', 'reference.png')
    expect(markup).toContain('aria-label="Open image preview: reference.png"')
    expect(markup).toContain('<img')
    expect(markup).toContain('loading="lazy"')
    expect(markup).toContain('alt="Preview of reference.png"')
  })

  it('renders video and audio with native controls and stable labels', () => {
    const video = render('video/quicktime', 'rough cut.mov')
    expect(video).toContain('<video')
    expect(video).toContain('controls=""')
    expect(video).toContain('playsInline=""')
    expect(video).toContain('preload="metadata"')
    expect(video).toContain('src="/api/videos/video-1/media/file-1#t=0.001"')
    expect(video).toContain('aria-label="Video preview: rough cut.mov"')

    const audio = render('audio/mpeg', 'voiceover.mp3')
    expect(audio).toContain('<audio')
    expect(audio).toContain('controls=""')
    expect(audio).toContain('aria-label="Audio preview: voiceover.mp3"')
  })

  it('does not embed unsupported or active content', () => {
    const markup = render('image/svg+xml', 'untrusted.svg')
    expect(markup).toContain('<a')
    expect(markup).toContain('href="/api/videos/video-1/media/file-1"')
    expect(markup).toContain('aria-label="Preview unavailable: untrusted.svg"')
    expect(markup).toContain('Preview unavailable</span>')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<iframe')
    expect(markup).not.toContain('<object')
  })
})
