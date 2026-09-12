import { useEffect, useRef, useState } from 'react'
import { Button } from '@yatb/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@yatb/ui/dialog'
import { Input } from '@yatb/ui/input'
import { Label } from '@yatb/ui/label'
import { type RichDocument, type RichInline, type RichMark } from '#/server/rich-document'
import { assembleRichDocument, type RichEditorFlowNode } from './rich-editor-model'

type Props = Readonly<{ value: RichDocument; onChange: (value: RichDocument) => void; ariaLabel?: string }>
type SelectionPoint = Readonly<{ path: readonly number[]; offset: number }>
type SelectionSnapshot = Readonly<{ start: SelectionPoint; end: SelectionPoint; text: string }>

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
  const flow = Array.from(root.childNodes).map((node): RichEditorFlowNode => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const parsed = block(node as Element)
      if (parsed) return { kind: 'block', value: parsed }
    }
    return { kind: 'inline', value: inlines([node]) }
  })
  return assembleRichDocument(flow)
}

function selectionPoint(root: HTMLElement, node: Node, offset: number): SelectionPoint | null {
  const path: number[] = []
  let current: Node | null = node
  while (current && current !== root) {
    const parentNode: ParentNode | null = current.parentNode
    if (!parentNode) return null
    const index = Array.prototype.indexOf.call(parentNode.childNodes, current) as number
    if (index < 0) return null
    path.unshift(index)
    current = parentNode
  }
  return current === root ? { path, offset } : null
}

function resolveSelectionPoint(root: HTMLElement, point: SelectionPoint): Node | null {
  let current: Node = root
  for (const index of point.path) {
    const child = current.childNodes.item(index)
    if (!child) return null
    current = child
  }
  return current
}

export function RichEditor({ value, onChange, ariaLabel = 'Video script' }: Props) {
  const editor = useRef<HTMLDivElement>(null)
  const renderedHtml = useRef('')
  const pendingLocalHtml = useRef<string | null>(null)
  const linkSelection = useRef<SelectionSnapshot | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [linkError, setLinkError] = useState('')

  useEffect(() => {
    const html = documentHtml(value)
    if (pendingLocalHtml.current !== null) {
      if (html === pendingLocalHtml.current) {
        renderedHtml.current = html
        pendingLocalHtml.current = null
      }
      return
    }
    if (editor.current && html !== renderedHtml.current) {
      editor.current.innerHTML = html
      renderedHtml.current = html
    }
  }, [value])

  useEffect(() => {
    const remember = () => rememberLinkSelection()
    document.addEventListener('selectionchange', remember)
    return () => document.removeEventListener('selectionchange', remember)
  }, [])

  function emitChange() {
    if (!editor.current) return
    const next = readDocument(editor.current)
    const html = documentHtml(next)
    renderedHtml.current = html
    pendingLocalHtml.current = html
    onChange(next)
  }

  function command(name: string, argument?: string) {
    editor.current?.focus()
    document.execCommand(name, false, argument)
    emitChange()
  }

  function rememberLinkSelection() {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const root = editor.current
    if (!range || !root || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return
    const start = selectionPoint(root, range.startContainer, range.startOffset)
    const end = selectionPoint(root, range.endContainer, range.endOffset)
    if (!start || !end) return
    linkSelection.current = {
      start,
      end,
      text: range.toString(),
    }
  }

  function openLink() {
    setLinkValue('')
    setLinkError(linkSelection.current ? '' : 'Select text in the script first.')
    setLinkOpen(true)
  }

  function addLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    try {
      if (new URL(linkValue).protocol === 'https:') {
        const snapshot = linkSelection.current
        const root = editor.current
        if (!snapshot || !root) {
          setLinkError('Select text in the script first.')
          return
        }
        const start = resolveSelectionPoint(root, snapshot.start)
        const end = resolveSelectionPoint(root, snapshot.end)
        if (!start || !end) {
          setLinkError('The selected text changed. Select it again.')
          return
        }
        const range = document.createRange()
        range.setStart(start, snapshot.start.offset)
        range.setEnd(end, snapshot.end.offset)
        if (range.toString() !== snapshot.text) {
          setLinkError('The selected text changed. Select it again.')
          return
        }
        const anchor = document.createElement('a')
        anchor.href = linkValue
        anchor.rel = 'noreferrer'
        anchor.appendChild(range.extractContents())
        range.insertNode(anchor)
        editor.current?.normalize()
        emitChange()
        linkSelection.current = null
        setLinkOpen(false)
        return
      }
    } catch {}
    setLinkError('Links must use HTTPS.')
  }

  return (
    <section className="rich-editor" aria-label={ariaLabel}>
      <div className="rich-toolbar" aria-label={`${ariaLabel} formatting`}>
        <Button variant="outline" size="sm" type="button" onClick={() => command('formatBlock', 'h2')}>Heading</Button>
        <Button variant="outline" size="sm" type="button" onClick={() => command('insertUnorderedList')}>Bullets</Button>
        <Button variant="outline" size="sm" type="button" onClick={() => command('insertOrderedList')}>Numbered</Button>
        <Button variant="outline" size="sm" type="button" onClick={() => command('bold')}>Bold</Button>
        <Button variant="outline" size="sm" type="button" onClick={() => command('italic')}>Italic</Button>
        <Button variant="outline" size="sm" type="button" onPointerDown={(event) => { event.preventDefault(); rememberLinkSelection() }} onClick={openLink}>Link</Button>
      </div>
      <div
        ref={editor}
        className="rich-surface"
        contentEditable
        role="textbox"
        aria-multiline="true"
        suppressContentEditableWarning
        onKeyUp={rememberLinkSelection}
        onPointerUp={rememberLinkSelection}
        onInput={emitChange}
      />
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add link</DialogTitle><DialogDescription>Attach a secure HTTPS reference to the selected text.</DialogDescription></DialogHeader>
          <form className="dialog-form" onSubmit={addLink}>
            <Label>HTTPS URL<Input type="url" value={linkValue} onChange={(event) => { setLinkValue(event.target.value); setLinkError('') }} aria-invalid={Boolean(linkError)} required autoFocus /></Label>
            {linkError && <p className="dialog-error" role="alert">{linkError}</p>}
            <DialogFooter><Button variant="outline" type="button" onClick={() => setLinkOpen(false)}>Cancel</Button><Button type="submit">Add link</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
