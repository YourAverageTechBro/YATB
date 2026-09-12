import { describe, expect, it } from 'vitest'
import { parseRichDocument } from '../src/server/rich-document'
import { parsePublishDate } from '../src/domain/videos'

describe('Studio rich document boundary', () => {
  it('accepts supported headings, lists, marks, and HTTPS links', () => {
    expect(parseRichDocument({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan', marks: [{ type: 'bold' }] }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read', marks: [{ type: 'italic' }, { type: 'link', attrs: { href: 'https://example.com' } }] }] }] }] },
      ],
    })).toMatchObject({ type: 'doc' })
  })

  it('rejects unsafe links and oversized documents', () => {
    expect(() => parseRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'No', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] })).toThrow('HTTPS')
    expect(() => parseRichDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(33 * 1024) }] }] })).toThrow('32 KiB')
  })

  it('rejects deeply nested lists before recursive parsing can exhaust the stack', () => {
    let block: unknown = { type: 'paragraph' }
    for (let depth = 0; depth < 20; depth += 1) {
      block = { type: 'bulletList', content: [{ type: 'listItem', content: [block] }] }
    }
    expect(() => parseRichDocument({ type: 'doc', content: [block] })).toThrow('too large')
  })

  it('rejects calendar dates that only match the input pattern', () => {
    expect(parsePublishDate('2028-02-29')).toBe('2028-02-29')
    expect(() => parsePublishDate('2027-02-29')).toThrow('Publish date')
  })
})
