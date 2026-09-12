export type RichMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'link'; attrs: { href: string } }

export type RichInline =
  | { type: 'text'; text: string; marks?: readonly RichMark[] }
  | { type: 'hardBreak' }

export type RichBlock =
  | { type: 'paragraph'; content?: readonly RichInline[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 }; content?: readonly RichInline[] }
  | { type: 'bulletList' | 'orderedList'; content: readonly RichListItem[] }

export type RichListItem = { type: 'listItem'; content: readonly RichBlock[] }
export type RichDocument = { type: 'doc'; content: readonly RichBlock[] }

const MAX_SERIALIZED_BYTES = 32 * 1024
const MAX_NODES = 800
const MAX_DEPTH = 12
const MAX_TEXT = 20_000

function invalid(message: string): never {
  throw new Error(message)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('Rich text contains an invalid node.')
  return value as Record<string, unknown>
}

function visit(count: { value: number }, depth: number) {
  count.value += 1
  if (count.value > MAX_NODES || depth > MAX_DEPTH) invalid('Rich text is too large.')
}

function optionalInline(value: unknown, count: { value: number }, depth: number): RichInline[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) invalid('Rich text content is invalid.')
  return value.map((node) => parseInline(node, count, depth))
}

function parseMarks(value: unknown, count: { value: number }, depth: number): RichMark[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) invalid('Rich text marks are invalid.')
  return value.map((mark) => {
    visit(count, depth)
    const input = asRecord(mark)
    if (input.type === 'bold' || input.type === 'italic') return { type: input.type }
    if (input.type === 'link') {
      const attrs = asRecord(input.attrs)
      const href = attrs.href
      if (typeof href !== 'string' || href.length > 2048) invalid('Rich text link is invalid.')
      let url: URL
      try { url = new URL(href) } catch { invalid('Rich text link is invalid.') }
      if (url.protocol !== 'https:') invalid('Rich text links must use HTTPS.')
      return { type: 'link', attrs: { href: url.href } }
    }
    invalid('Rich text mark is unsupported.')
  })
}

function parseInline(value: unknown, count: { value: number }, depth: number): RichInline {
  visit(count, depth)
  const input = asRecord(value)
  if (input.type === 'hardBreak') return { type: 'hardBreak' }
  if (input.type === 'text') {
    if (typeof input.text !== 'string') invalid('Rich text value is invalid.')
    return { type: 'text', text: input.text, marks: parseMarks(input.marks, count, depth + 1) }
  }
  invalid('Rich text inline node is unsupported.')
}

function parseBlock(value: unknown, count: { value: number }, depth: number): RichBlock {
  visit(count, depth)
  const input = asRecord(value)
  if (input.type === 'paragraph') return { type: 'paragraph', content: optionalInline(input.content, count, depth + 1) }
  if (input.type === 'heading') {
    const attrs = asRecord(input.attrs)
    if (attrs.level !== 1 && attrs.level !== 2 && attrs.level !== 3) invalid('Heading level is invalid.')
    return { type: 'heading', attrs: { level: attrs.level }, content: optionalInline(input.content, count, depth + 1) }
  }
  if (input.type === 'bulletList' || input.type === 'orderedList') {
    if (!Array.isArray(input.content)) invalid('List content is invalid.')
    return { type: input.type, content: input.content.map((item) => parseListItem(item, count, depth + 1)) }
  }
  invalid('Rich text block is unsupported.')
}

function parseListItem(value: unknown, count: { value: number }, depth: number): RichListItem {
  visit(count, depth)
  const input = asRecord(value)
  if (input.type !== 'listItem' || !Array.isArray(input.content) || input.content.length === 0) invalid('List item is invalid.')
  return { type: 'listItem', content: input.content.map((block) => parseBlock(block, count, depth + 1)) }
}

export function emptyRichDocument(): RichDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

export function parseRichDocument(value: unknown): RichDocument {
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { invalid('Rich text is invalid.') }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) {
    invalid('Rich text must be at most 32 KiB.')
  }
  const input = asRecord(value)
  if (input.type !== 'doc' || !Array.isArray(input.content)) invalid('Rich text document is invalid.')
  const count = { value: 0 }
  visit(count, 1)
  const document: RichDocument = { type: 'doc', content: input.content.map((block) => parseBlock(block, count, 2)) }
  const text = document.content.flatMap((block) => JSON.stringify(block)).join('')
  if (text.length > MAX_TEXT) invalid('Rich text is too large.')
  return document
}
