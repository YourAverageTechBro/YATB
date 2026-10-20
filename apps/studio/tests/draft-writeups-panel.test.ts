import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DraftWriteupsPanel } from '../src/components/draft-writeups'
import { MONTHLY_AI_BUDGET, type Microusd } from '../src/domain/ai-spend'
import type { TranscriptArtifact } from '../src/domain/draft-ai'
import { buildWriteupsView, type PanelContext } from '../src/domain/draft-writeups'

vi.mock('../src/server/draft-ai.functions', () => ({
  loadDraftTranscript: vi.fn(),
  loadDraftWriteups: vi.fn(),
  requestDraftWriteup: vi.fn(),
  saveDraftWriteup: vi.fn(),
}))

const target = { videoId: 'video-1', draftId: 'draft-1' }
const description = 'Packing a cast-iron pan for a week on the road.\n\nWe test three wraps.'
const chapters = '0:00 Intro\n1:05 Packing\n2:30 Cooking'
const transcribed: TranscriptArtifact = { stage: 'transcribed', segmentCount: 12, spanEndMs: 230_000, provider: 'live' }

function context(overrides: Partial<PanelContext> = {}): PanelContext {
  return {
    draft: { id: target.draftId, videoId: target.videoId, version: 2, durationMs: 4 * 60_000, byteSize: 50_000_000 },
    video: { format: 'long', title: 'Cast-iron on the road' },
    jobs: {},
    transcript: null,
    generations: {},
    edits: {},
    spent: 0 as Microusd,
    ai: { kind: 'live' },
    ...overrides,
  }
}

function render(state: PanelContext): string {
  return renderToStaticMarkup(createElement(DraftWriteupsPanel, { target, view: buildWriteupsView(state), onView: () => undefined }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function fieldMarkup(markup: string, label: string): string {
  const chunk = markup.split(/<div class="writeup-(?:field|transcript)">/).find((part) => part.includes(`>${label}</label>`))
  if (!chunk) throw new Error(`${label} field is not rendered`)
  return chunk
}

function transcriptMarkup(markup: string): string {
  const chunk = markup.split('<div class="writeup-transcript">')[1]
  if (!chunk) throw new Error('transcript section is not rendered')
  return chunk
}

function button(markup: string, ariaLabel: string): string {
  const tag = new RegExp(`<button[^>]*aria-label="${escapeRegExp(ariaLabel)}"[^>]*>`).exec(markup)?.[0]
  if (!tag) throw new Error(`no button labelled ${ariaLabel}`)
  return tag
}

function isDisabled(tag: string): boolean {
  return /\sdisabled=""/.test(tag)
}

function textarea(markup: string): { tag: string; text: string } {
  const match = /(<textarea[^>]*>)([\s\S]*?)<\/textarea>/.exec(markup)
  if (!match) throw new Error('no textarea')
  return { tag: match[1], text: match[2].replace(/^\n/, '') }
}

describe('draft description and chapters panel', () => {
  it('offers generation for a fresh long draft with the transcript collapsed', () => {
    const markup = render(context())
    const descriptionField = fieldMarkup(markup, 'Description')
    const chaptersField = fieldMarkup(markup, 'Chapters')

    expect(markup).toContain('YouTube description and chapters')
    expect(markup).not.toContain('Stub AI')
    expect(textarea(descriptionField).text).toBe('')
    expect(textarea(chaptersField).text).toBe('')
    expect(isDisabled(button(markup, 'Generate description'))).toBe(false)
    expect(isDisabled(button(markup, 'Generate chapters'))).toBe(false)
    expect(isDisabled(button(markup, 'Copy description'))).toBe(true)
    expect(isDisabled(button(markup, 'Copy chapters'))).toBe(true)

    const transcript = transcriptMarkup(markup)
    expect(transcript).toContain('Made when you first generate')
    expect(transcript).toContain('aria-expanded="false"')
    expect(transcript).not.toContain('/transcript"')
  })

  it('badges stub output and leaves live output unbadged', () => {
    expect(render(context({ ai: { kind: 'stub' } }))).toContain('Stub AI')
    expect(render(context({ generations: { description: { seq: 1, text: description, provider: 'stub' } } }))).toContain('Stub AI')
    expect(render(context({ generations: { description: { seq: 1, text: description, provider: 'live' } } }))).not.toContain('Stub AI')
  })

  it('locks a field and reports progress while the draft is transcribed and then written', () => {
    const transcribing = render(context({
      jobs: { transcript: { state: 'processing', requestSeq: 1 }, description: { state: 'queued', requestSeq: 1, lastFailure: null } },
    }))
    const transcribingField = fieldMarkup(transcribing, 'Description')
    expect(transcribingField).toContain('Transcribing the draft…')
    expect(textarea(transcribingField).tag).toMatch(/\sreadOnly=""/)
    expect(isDisabled(button(transcribing, 'Generate description'))).toBe(true)
    expect(isDisabled(button(transcribing, 'Generate chapters'))).toBe(false)
    expect(transcriptMarkup(transcribing)).toContain('Extracting audio…')

    const writing = render(context({
      jobs: { transcript: { state: 'ready', requestSeq: 1 }, description: { state: 'processing', requestSeq: 1 } },
      transcript: transcribed,
    }))
    expect(fieldMarkup(writing, 'Description')).toContain('Writing the description…')
    expect(isDisabled(button(writing, 'Generate description'))).toBe(true)
  })

  it('shows generated text with copy, regenerate, and a transcript download', () => {
    const markup = render(context({
      jobs: { transcript: { state: 'ready', requestSeq: 1 }, description: { state: 'ready', requestSeq: 1 }, chapters: { state: 'ready', requestSeq: 1 } },
      transcript: transcribed,
      generations: { description: { seq: 1, text: description, provider: 'live' }, chapters: { seq: 1, text: chapters, provider: 'live' } },
    }))

    expect(textarea(fieldMarkup(markup, 'Description')).text).toBe(description)
    expect(textarea(fieldMarkup(markup, 'Chapters')).text).toBe(chapters)
    expect(isDisabled(button(markup, 'Copy description'))).toBe(false)
    expect(isDisabled(button(markup, 'Regenerate description'))).toBe(false)
    expect(isDisabled(button(markup, 'Regenerate chapters'))).toBe(false)
    expect(markup).not.toContain('Chapters problems')

    const transcript = transcriptMarkup(markup)
    expect(transcript).toContain('12 lines')
    expect(transcript).toContain('aria-expanded="false"')
    expect(transcript).not.toContain('transcript-lines')
    expect(transcript).toContain('href="/api/videos/video-1/drafts/draft-1/transcript"')
  })

  it('offers retry after the writer fails', () => {
    const markup = render(context({
      jobs: {
        transcript: { state: 'ready', requestSeq: 1 },
        description: { state: 'failed', requestSeq: 1, failure: { code: 'invalid-output', detail: null } },
      },
      transcript: transcribed,
    }))
    expect(fieldMarkup(markup, 'Description')).toContain('The writer could not produce text that meets YouTube’s rules.')
    expect(isDisabled(button(markup, 'Retry description'))).toBe(false)
  })

  it('explains a permanent block instead of offering retry when the draft has no speech', () => {
    const markup = render(context({
      jobs: {
        transcript: { state: 'failed', requestSeq: 1, failure: { code: 'no-speech', detail: null } },
        description: { state: 'failed', requestSeq: 1, failure: { code: 'transcript-failed', detail: null } },
      },
    }))
    expect(markup).not.toContain('aria-label="Retry description"')
    expect(isDisabled(button(markup, 'Generate description'))).toBe(true)
    expect(fieldMarkup(markup, 'Description')).toContain('No speech was found in this draft, so there is nothing to write from.')
    expect(transcriptMarkup(markup)).toContain('No speech was found in this draft.')
  })

  it('says once per field why the monthly budget blocks generation', () => {
    const markup = render(context({
      spent: MONTHLY_AI_BUDGET,
      jobs: { description: { state: 'failed', requestSeq: 1, failure: { code: 'budget', detail: null } } },
    }))
    const message = 'This month’s AI budget is used up.'
    expect(fieldMarkup(markup, 'Description').split(message)).toHaveLength(2)
    expect(fieldMarkup(markup, 'Chapters').split(message)).toHaveLength(2)
    expect(isDisabled(button(markup, 'Generate description'))).toBe(true)
    expect(isDisabled(button(markup, 'Generate chapters'))).toBe(true)
  })

  it('lists YouTube problems in hand-edited chapters', () => {
    const markup = render(context({
      transcript: transcribed,
      generations: { chapters: { seq: 1, text: chapters, provider: 'live' } },
      edits: { chapters: { text: chapters.replace('0:00', '0:05'), baseSeq: 1, revision: 1 } },
    }))
    const field = fieldMarkup(markup, 'Chapters')
    expect(field).toContain('aria-label="Chapters problems"')
    expect(field).toContain('The first chapter must start at 0:00, not 0:05.')
    expect(textarea(field).text).toBe('0:05 Intro\n1:05 Packing\n2:30 Cooking')
  })

  it('hides chapters for a short', () => {
    const markup = render(context({ video: { format: 'short', title: 'Pan in 30 seconds' } }))
    expect(markup).not.toContain('>Chapters</label>')
    expect(markup).not.toContain('chapters"')
    expect(isDisabled(button(markup, 'Generate description'))).toBe(false)
  })

  it('tells the member when AI is not configured', () => {
    const markup = render(context({ ai: { kind: 'unavailable', reason: 'AI_GATEWAY_ID is not set.' } }))
    expect(fieldMarkup(markup, 'Description')).toContain('AI generation is not configured for this Studio.')
    expect(isDisabled(button(markup, 'Generate description'))).toBe(true)
    expect(isDisabled(button(markup, 'Generate chapters'))).toBe(true)
  })
})
