import { useEffect, useRef } from 'react'
import { emptyRichDocument, type RichDocument, type RichInline, type RichMark } from '#/server/rich-document'

type Props = Readonly<{ value: RichDocument; onChange: (value: RichDocument) => void }>

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function inlineHtml(nodes: readonly RichInline[] = []): string {
  return nodes.map((node) => {
    if (node.type === 'hardBreak') return '<br>'
    let html = escapeHtml(node.text)
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') html = `<strong>${html}</strong>`
      if (mark.type === 'italic') html = `<em>${html}</em>`
      if (mark.type === 'link') html = `<a href="${escapeHtml(mark.attrs.href)}" rel="noreferrer">${html}</a>`
    }
    return html
  }).join('')
}

function documentHtml(value: RichDocument): string {
  return value.content.map((block) => {
    if (block.type === 'paragraph') return `<p>${inlineHtml(block.content)}</p>`
    if (block.type === 'heading') return `<h${block.attrs.level}>${inlineHtml(block.content)}</h${block.attrs.level}>`
    const tag = block.type === 'bulletList' ? 'ul' : 'ol'
    return `<${tag}>${block.content.map((item) => `<li>${item.content.map((child) => child.type === 'paragraph' ? inlineHtml(child.content) : documentHtml({ type: 'doc', content: [child] })).join('')}</li>`).join('')}</${tag}>`
  }).join('')
}

function marksFor(element: Element, inherited: readonly RichMark[]): RichMark[] {
  const next = [...inherited]
  const tag = element.tagName.toLowerCase()
  if (tag === 'strong' || tag === 'b') next.push({ type: 'bold' })
  if (tag === 'em' || tag === 'i') next.push({ type: 'italic' })
  if (tag === 'a') {
    const href = element.getAttribute('href')
    if (href) try {
      const url = new URL(href, window.location.href)
      if (url.protocol === 'https:') next.push({ type: 'link', attrs: { href: url.href } })
    } catch {}
  }
  return next
}

function inlines(nodes: NodeListOf<ChildNode> | ChildNode[], inherited: readonly RichMark[] = []): RichInline[] {
  return Array.from(nodes).flatMap((node): RichInline[] => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ type: 'text', text: node.textContent, marks: inherited.length ? inherited : undefined }] : []
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    const element = node as Element
    if (element.tagName.toLowerCase() === 'br') return [{ type: 'hardBreak' }]
    return inlines(element.childNodes, marksFor(element, inherited))
  })
}

function block(element: Element): RichDocument['content'][number] | null {
  const tag = element.tagName.toLowerCase()
  if (tag === 'p' || tag === 'div') return { type: 'paragraph', content: inlines(element.childNodes) }
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') return { type: 'heading', attrs: { level: Number(tag[1]) as 1 | 2 | 3 }, content: inlines(element.childNodes) }
  if (tag === 'ul' || tag === 'ol') return {
    type: tag === 'ul' ? 'bulletList' : 'orderedList',
    content: Array.from(element.children).filter((child) => child.tagName.toLowerCase() === 'li').map((item) => ({
      type: 'listItem' as const,
      content: [{ type: 'paragraph' as const, content: inlines(item.childNodes) }],
    })),
  }
  return null
}

function readDocument(root: HTMLElement): RichDocument {
  const content = Array.from(root.children).flatMap((element) => {
    const parsed = block(element)
    return parsed ? [parsed] : []
  })
  return content.length ? { type: 'doc', content } : emptyRichDocument()
}

export function RichEditor({ value, onChange }: Props) {
  const editor = useRef<HTMLDivElement>(null)
  const lastHtml = useRef('')

  useEffect(() => {
    const html = documentHtml(value)
    if (editor.current && html !== lastHtml.current) {
      editor.current.innerHTML = html
      lastHtml.current = html
    }
  }, [value])

  function emitChange() {
    if (!editor.current) return
    const next = readDocument(editor.current)
    lastHtml.current = documentHtml(next)
    onChange(next)
  }

  function command(name: string, argument?: string) {
    editor.current?.focus()
    document.execCommand(name, false, argument)
    emitChange()
  }

  function addLink() {
    const href = window.prompt('HTTPS link')
    if (!href) return
    try {
      if (new URL(href).protocol === 'https:') {
        command('createLink', href)
        return
      }
    } catch {}
    window.alert('Links must use HTTPS.')
  }

  return (
    <section className="rich-editor" aria-label="Video script">
      <div className="rich-toolbar" aria-label="Script formatting">
        <button type="button" onClick={() => command('formatBlock', 'h2')}>Heading</button>
        <button type="button" onClick={() => command('insertUnorderedList')}>Bullets</button>
        <button type="button" onClick={() => command('insertOrderedList')}>Numbered</button>
        <button type="button" onClick={() => command('bold')}>Bold</button>
        <button type="button" onClick={() => command('italic')}>Italic</button>
        <button type="button" onClick={addLink}>Link</button>
      </div>
      <div
        ref={editor}
        className="rich-surface"
        contentEditable
        role="textbox"
        aria-multiline="true"
        suppressContentEditableWarning
        onInput={emitChange}
      />
    </section>
  )
}
