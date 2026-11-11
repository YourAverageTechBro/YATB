import { describe, expect, it } from 'vitest'
import {
  applyVideoPatch,
  listVideosInputSchema,
  mcpVideoView,
  parseCreateVideoToolInput,
  parseListVideosInput,
} from '../src/domain/mcp-videos'
import { emptyRichDocument } from '../src/server/rich-document'
import type { Video } from '../src/domain/videos'

const organic: Video = {
  id: '1b0e913b-645c-4306-a71d-78115390b46d',
  title: 'Carrier',
  production: { format: 'long', promotion: 'organic' },
  status: 'filming',
  publishDate: '2026-11-11',
  script: emptyRichDocument(),
  revision: 2,
  createdAt: 1,
  updatedAt: 2,
}

describe('MCP video parsing', () => {
  it('rejects unknown list fields and invalid enums', () => {
    expect(listVideosInputSchema.safeParse({ layout: 'board' }).success).toBe(false)
    expect(() => parseListVideosInput({ status: 'draft' })).toThrow()
    expect(parseListVideosInput({})).toEqual({
      status: undefined,
      format: undefined,
      promotion: undefined,
      page: 1,
      limit: 20,
    })
  })

  it('parses create input with production rules from the video domain', () => {
    const created = parseCreateVideoToolInput({
      title: ' Ad cut ',
      format: 'long',
      promotion: 'integration',
      organic_video_id: organic.id,
    })
    expect(created.title).toBe('Ad cut')
    expect(created.production).toEqual({
      format: 'long',
      promotion: 'integration',
      organicVideoId: organic.id,
    })
    expect(() => parseCreateVideoToolInput({
      title: 'Nope',
      format: 'short',
      promotion: 'integration',
    })).toThrow(/not available/)
  })

  it('merges a script-only patch onto the current video', () => {
    const nextScript = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'https://docs.google.com/document/d/abc' }] }],
    }
    const patch = applyVideoPatch(organic, { id: organic.id, script: nextScript })
    expect(patch.title).toBe('Carrier')
    expect(patch.status).toBe('filming')
    expect(patch.script).toEqual(nextScript)
    expect(patch.expectedRevision).toBe(2)
  })

  it('serializes every video field for tools', () => {
    expect(mcpVideoView(organic)).toEqual({
      id: organic.id,
      title: 'Carrier',
      format: 'long',
      promotion: 'organic',
      organic_video_id: null,
      status: 'filming',
      publish_date: '2026-11-11',
      script: organic.script,
      revision: 2,
      created_at: 1,
      updated_at: 2,
    })
  })
})
