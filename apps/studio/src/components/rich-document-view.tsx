import type { ReactNode } from 'react'
import type { RichBlock, RichDocument, RichInline } from '#/server/rich-document'
import { sharedFileTextParts } from '#/domain/shared-file-links'

function inline(node: RichInline, key: number, linkSharedFiles: boolean): ReactNode {
  if (node.type === 'hardBreak') return <br key={key} />
  const hasLink = node.marks?.some((mark) => mark.type === 'link') ?? false
  let value: ReactNode = linkSharedFiles && !hasLink
    ? sharedFileTextParts(node.text).map((part, index) => part.href
      ? <a key={index} href={part.href} rel="noopener noreferrer" target="_blank">{part.text}</a>
      : <span key={index}>{part.text}</span>)
    : node.text
  for (const [index, mark] of (node.marks ?? []).entries()) {
    if (mark.type === 'bold') value = <strong key={index}>{value}</strong>
    if (mark.type === 'italic') value = <em key={index}>{value}</em>
    if (mark.type === 'link') value = <a key={index} href={mark.attrs.href} rel="noopener noreferrer" target="_blank">{value}</a>
  }
  return <span key={key}>{value}</span>
}

function block(node: RichBlock, key: number, linkSharedFiles: boolean): ReactNode {
  const renderInline = (item: RichInline, index: number) => inline(item, index, linkSharedFiles)
  if (node.type === 'paragraph') return <p key={key}>{node.content?.map(renderInline)}</p>
  if (node.type === 'heading') {
    if (node.attrs.level === 1) return <h1 key={key}>{node.content?.map(renderInline)}</h1>
    if (node.attrs.level === 2) return <h2 key={key}>{node.content?.map(renderInline)}</h2>
    return <h3 key={key}>{node.content?.map(renderInline)}</h3>
  }
  const items = node.content.map((item, itemIndex) => <li key={itemIndex}>{item.content.map((child, index) => block(child, index, linkSharedFiles))}</li>)
  return node.type === 'bulletList' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>
}

export function RichDocumentView({ value, linkSharedFiles = false }: { value: RichDocument; linkSharedFiles?: boolean }) {
  return <div className="rich-document-view">{value.content.map((item, index) => block(item, index, linkSharedFiles))}</div>
}
