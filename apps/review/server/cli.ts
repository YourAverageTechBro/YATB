import { parseArgs } from 'node:util'
import { ReviewError, parseStatus, parseSlug } from '../shared/domain.ts'
import { collectFeedback, feedbackJson, renderFeedback } from './feedback.ts'
import type { Store } from './store.ts'

export const HELP = `Usage: npm run review -- <command>

  post <slug> <file> [--title "..."] [--note "..."]   add the next draft of a project
  feedback <slug> [--all] [--json]                     print open (or all) comment threads
  reply <id-or-prefix> "<text>" [--status addressed|open|resolved]
                                                       reply as claude (default status: addressed)
  list                                                 projects with latest version and open counts
`

export type CliContext = Readonly<{ store: Store; baseUrl: string; cwd: string }>

function usage(message: string): never {
  throw new ReviewError(`${message} (see --help)`)
}

export function runCli(argv: readonly string[], { store, baseUrl, cwd }: CliContext): string {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') return HELP.trimEnd()
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        title: { type: 'string' }, note: { type: 'string' }, status: { type: 'string' },
        all: { type: 'boolean' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (error) {
    return usage(error instanceof Error ? error.message : 'bad arguments')
  }
  const { positionals, values } = parsed
  if (values.help) return HELP.trimEnd()

  switch (command) {
    case 'post': {
      const [slug, file, ...extra] = positionals
      if (!slug || !file || extra.length > 0) usage('post needs <slug> <file>')
      const { project, draft } = store.postDraft({ slug, file, title: values.title, note: values.note, cwd })
      return `Posted ${project.slug} v${draft.version}\n${baseUrl}/#/p/${project.slug}?v=${draft.version}`
    }
    case 'feedback': {
      const [slug, ...extra] = positionals
      if (!slug || extra.length > 0) usage('feedback needs <slug>')
      const groups = collectFeedback(store.getProject(parseSlug(slug)), values.all === true)
      return values.json ? JSON.stringify(feedbackJson(slug, groups), null, 2) : renderFeedback(slug, groups, values.all === true)
    }
    case 'reply': {
      const [id, text, ...extra] = positionals
      if (!id || !text || extra.length > 0) usage('reply needs <comment-id> "<text>"')
      const { reply, root } = store.replyAsClaude(id, text, values.status === undefined ? 'addressed' : parseStatus(values.status))
      return `Replied [${reply.id.slice(0, 8)}] on [${root.id.slice(0, 8)}], status ${root.status}`
    }
    case 'list': {
      const projects = store.listProjects()
      if (projects.length === 0) return 'No projects yet.'
      return projects.map((p) => `${p.slug}  ${p.latestVersion === null ? 'no drafts' : `v${p.latestVersion}`}  ${p.openCount} open  ${p.title}`).join('\n')
    }
    default:
      return usage(`unknown command '${command}'`)
  }
}
