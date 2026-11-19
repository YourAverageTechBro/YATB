import { anchorStartMs, commentThreads, formatAnchor, type Draft, type ProjectDetail, type Thread } from '../shared/domain.ts'

export type DraftFeedback = Readonly<{ draft: Draft; threads: readonly Thread[] }>

export function collectFeedback(detail: ProjectDetail, includeAll: boolean): DraftFeedback[] {
  const threads = commentThreads(detail.comments)
  return detail.drafts
    .map((draft) => ({
      draft,
      threads: threads.filter((thread) => thread.root.draftId === draft.id && (includeAll || thread.root.status === 'open')),
    }))
    .filter((group) => group.threads.length > 0)
}

const short = (id: string) => id.slice(0, 8)
const indent = (text: string, by: string) => text.split('\n').map((line) => by + line).join('\n')

export function renderFeedback(slug: string, groups: readonly DraftFeedback[], includeAll: boolean): string {
  if (groups.length === 0) return `No ${includeAll ? '' : 'open '}feedback for ${slug}.`
  return groups.map(({ draft, threads }) => {
    const header = `== ${slug} v${draft.version} == ${draft.filePath}${draft.note ? `\nnote: ${draft.note}` : ''}`
    const body = threads.map(({ root, replies }) => [
      `[${short(root.id)}] v${draft.version} ${formatAnchor(root.anchor)} ${root.status}`,
      indent(root.body, '  '),
      ...replies.map((reply) => indent(`${reply.author} [${short(reply.id)}]: ${reply.body}`, '    ')),
    ].join('\n')).join('\n\n')
    return `${header}\n\n${body}`
  }).join('\n\n')
}

export function feedbackJson(slug: string, groups: readonly DraftFeedback[]) {
  return {
    slug,
    drafts: groups.map(({ draft, threads }) => ({
      draftId: draft.id,
      version: draft.version,
      filePath: draft.filePath,
      note: draft.note,
      threads: threads.map(({ root, replies }) => ({
        id: root.id,
        status: root.status,
        author: root.author,
        body: root.body,
        anchor: root.anchor,
        startMs: anchorStartMs(root.anchor),
        endMs: root.anchor.kind === 'range' ? root.anchor.endMs : null,
        replies: replies.map((reply) => ({ id: reply.id, author: reply.author, body: reply.body, createdAt: reply.createdAt })),
      })),
    })),
  }
}
