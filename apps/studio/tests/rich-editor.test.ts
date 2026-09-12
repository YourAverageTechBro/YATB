import { describe, expect, it } from 'vitest'
import { assembleRichDocument } from '../src/components/rich-editor-model'

describe('rich editor normalization', () => {
  it('retains a top-level bold inline produced by browser formatting', () => {
    expect(assembleRichDocument([
      {
        kind: 'inline',
        value: [{ type: 'text', text: 'Tighten this opening beat', marks: [{ type: 'bold' }] }],
      },
      { kind: 'block', value: { type: 'paragraph' } },
    ])).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Tighten this opening beat', marks: [{ type: 'bold' }] }] },
        { type: 'paragraph' },
      ],
    })
  })
})
