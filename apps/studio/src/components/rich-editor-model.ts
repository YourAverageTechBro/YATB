import type { RichBlock, RichDocument, RichInline } from '#/server/rich-document'

export type RichEditorFlowNode =
  | Readonly<{ kind: 'block'; value: RichBlock }>
  | Readonly<{ kind: 'inline'; value: readonly RichInline[] }>

export function assembleRichDocument(nodes: readonly RichEditorFlowNode[]): RichDocument {
  const content: RichBlock[] = []
  let inline: RichInline[] = []
  const flush = () => {
    if (inline.length === 0) return
    content.push({ type: 'paragraph', content: inline })
    inline = []
  }
  for (const node of nodes) {
    if (node.kind === 'inline') {
      inline.push(...node.value)
      continue
    }
    flush()
    content.push(node.value)
  }
  flush()
  return content.length ? { type: 'doc', content } : emptyDocument()
}

function emptyDocument(): RichDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}
