import type { ReactNode } from 'react'
import type { RichBlock, RichDocument, RichInline } from '#/server/rich-document'

function inline(node: RichInline, key: number): ReactNode {
  if (node.type === 'hardBreak') return <br key={key} />
  let value: ReactNode = node.text
  for (const [index, mark] of (node.marks ?? []).entries()) {
    if (mark.type === 'bold') value = <strong key={index}>{value}</strong>
    if (mark.type === 'italic') value = <em key={index}>{value}</em>
    if (mark.type === 'link') value = <a key={index} href={mark.attrs.href} rel="noreferrer" target="_blank">{value}</a>
  }
  return <span key={key}>{value}</span>
}

function block(node: RichBlock, key: number): ReactNode {
  if (node.type === 'paragraph') return <p key={key}>{node.content?.map(inline)}</p>
  if (node.type === 'heading') {
    if (node.attrs.level === 1) return <h1 key={key}>{node.content?.map(inline)}</h1>
    if (node.attrs.level === 2) return <h2 key={key}>{node.content?.map(inline)}</h2>
    return <h3 key={key}>{node.content?.map(inline)}</h3>
  }
  const items = node.content.map((item, itemIndex) => <li key={itemIndex}>{item.content.map(block)}</li>)
  return node.type === 'bulletList' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>
}

export function RichDocumentView({ value }: { value: RichDocument }) {
  return <div className="rich-document-view">{value.content.map(block)}</div>
}
