import { randomUUID } from 'node:crypto'
import { mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  ReviewError, anchorStartMs, canTransition, parseAnchor, parseBody, parseSlug,
  type Author, type Comment, type CommentStatus, type Draft, type Project, type ProjectDetail, type ProjectSummary, type ReviewAnchor,
} from '../shared/domain.ts'

const SCHEMA = `
create table if not exists project (
  slug text primary key, title text not null, created_at integer not null
);
create table if not exists draft (
  id text primary key,
  project_slug text not null references project(slug),
  version integer not null,
  file_path text not null,
  note text not null default '',
  created_at integer not null,
  unique (project_slug, version)
);
create table if not exists comment (
  id text primary key,
  draft_id text not null references draft(id),
  parent_id text references comment(id) on delete cascade,
  author text not null check (author in ('thomas', 'claude')),
  body text not null,
  anchor_start_ms integer not null,
  anchor_end_ms integer,
  status text check (status in ('open', 'addressed', 'resolved')),
  created_at integer not null,
  updated_at integer not null,
  check ((parent_id is null) = (status is not null))
);
create index if not exists comment_draft on comment(draft_id);
`

type Row = Record<string, string | number | null>

export function defaultDbPath(): string {
  return process.env.YATB_REVIEW_DB ?? join(homedir(), '.yatb-review', 'review.db')
}

function toDraft(row: Row): Draft {
  return { id: String(row.id), projectSlug: String(row.project_slug), version: Number(row.version), filePath: String(row.file_path), note: String(row.note), createdAt: Number(row.created_at) }
}

function toComment(row: Row): Comment {
  const anchor: ReviewAnchor = row.anchor_end_ms === null
    ? { kind: 'point', atMs: Number(row.anchor_start_ms) }
    : { kind: 'range', startMs: Number(row.anchor_start_ms), endMs: Number(row.anchor_end_ms) }
  const base = { id: String(row.id), draftId: String(row.draft_id), author: row.author as Author, body: String(row.body), anchor, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
  // The CHECK constraint guarantees status is set exactly for roots.
  return row.parent_id === null
    ? { ...base, parentId: null, status: row.status as CommentStatus }
    : { ...base, parentId: String(row.parent_id), status: null }
}

export type Store = ReturnType<typeof openStore>

export function openStore(path: string = defaultDbPath()) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000; pragma foreign_keys = on;')
  db.exec(SCHEMA)

  const all = (sql: string, ...params: (string | number)[]): Row[] => db.prepare(sql).all(...params) as Row[]
  const one = (sql: string, ...params: (string | number)[]): Row | undefined => db.prepare(sql).get(...params) as Row | undefined

  // IMMEDIATE takes the write lock up front so concurrent CLI and server writers queue on busy_timeout.
  function transaction<T>(work: () => T): T {
    db.exec('begin immediate')
    try {
      const result = work()
      db.exec('commit')
      return result
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  }

  function getDraft(id: string): Draft | undefined {
    const row = one('select * from draft where id = ?', id)
    return row && toDraft(row)
  }

  function getComment(id: string): Comment {
    const row = one('select * from comment where id = ?', id)
    if (!row) throw new ReviewError('comment not found', 404)
    return toComment(row)
  }

  function findComment(idOrPrefix: string): Comment {
    if (!/^[0-9a-f-]{4,36}$/.test(idOrPrefix)) throw new ReviewError(`'${idOrPrefix}' is not a comment id or id prefix`)
    const rows = all('select * from comment where id like ? limit 2', `${idOrPrefix}%`)
    if (rows.length === 0) throw new ReviewError(`no comment matches '${idOrPrefix}'`, 404)
    if (rows.length > 1) throw new ReviewError(`'${idOrPrefix}' matches more than one comment; use more characters`, 409)
    return toComment(rows[0]!)
  }

  function setStatus(id: string, to: CommentStatus): Comment {
    const comment = getComment(id)
    if (comment.parentId !== null) throw new ReviewError('only a thread root has a status')
    if (comment.status !== to) {
      if (!canTransition(comment.status, to)) throw new ReviewError(`cannot change status from ${comment.status} to ${to}`, 409)
      db.prepare('update comment set status = ?, updated_at = ? where id = ?').run(to, Date.now(), id)
    }
    return getComment(id)
  }

  function insertComment(input: { draftId: string; parentId?: string | null; anchor: unknown; body: unknown; author: Author }): Comment {
    const body = parseBody(input.body)
    if (!getDraft(input.draftId)) throw new ReviewError('draft not found', 404)
    // Replies inherit the root's anchor so every row carries a timestamp.
    let anchor: ReviewAnchor
    if (input.parentId) {
      const parent = getComment(input.parentId)
      if (parent.parentId !== null) throw new ReviewError('replies attach to a thread root')
      if (parent.draftId !== input.draftId) throw new ReviewError('reply must be on the same draft as its parent')
      anchor = parent.anchor
    } else anchor = parseAnchor(input.anchor)
    const id = randomUUID()
    const now = Date.now()
    db.prepare('insert into comment (id, draft_id, parent_id, author, body, anchor_start_ms, anchor_end_ms, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.draftId, input.parentId ?? null, input.author, body, anchorStartMs(anchor), anchor.kind === 'range' ? anchor.endMs : null, input.parentId ? null : 'open', now, now)
    return getComment(id)
  }

  return {
    close: () => db.close(),
    getDraft,
    findComment,
    setStatus: (id: string, to: CommentStatus) => transaction(() => setStatus(id, to)),
    addComment: (input: Parameters<typeof insertComment>[0]) => transaction(() => insertComment(input)),

    postDraft(input: { slug: string; file: string; title?: string; note?: string; cwd?: string }): { project: Project; draft: Draft } {
      const slug = parseSlug(input.slug)
      const filePath = resolve(input.cwd ?? process.cwd(), input.file)
      let isFile = false
      try { isFile = statSync(filePath).isFile() } catch { /* reported below */ }
      if (!isFile) throw new ReviewError(`${filePath} is not a file`)
      return transaction(() => {
        const now = Date.now()
        db.prepare('insert or ignore into project (slug, title, created_at) values (?, ?, ?)').run(slug, input.title?.trim() || slug, now)
        const id = randomUUID()
        db.prepare('insert into draft (id, project_slug, version, file_path, note, created_at) select ?, ?, coalesce(max(version), 0) + 1, ?, ?, ? from draft where project_slug = ?')
          .run(id, slug, filePath, input.note?.trim() ?? '', now, slug)
        const project = one('select * from project where slug = ?', slug)!
        return { project: { slug, title: String(project.title), createdAt: Number(project.created_at) }, draft: getDraft(id)! }
      })
    },

    listProjects(): ProjectSummary[] {
      return all(`
        select p.slug, p.title,
          (select max(version) from draft d where d.project_slug = p.slug) as latest,
          (select count(*) from comment c join draft d on d.id = c.draft_id where d.project_slug = p.slug and c.status = 'open') as open_count,
          max(p.created_at,
            coalesce((select max(created_at) from draft d where d.project_slug = p.slug), 0),
            coalesce((select max(c.updated_at) from comment c join draft d on d.id = c.draft_id where d.project_slug = p.slug), 0)) as activity
        from project p order by activity desc`)
        .map((row) => ({ slug: String(row.slug), title: String(row.title), latestVersion: row.latest === null ? null : Number(row.latest), openCount: Number(row.open_count), lastActivityAt: Number(row.activity) }))
    },

    getProject(slug: string): ProjectDetail {
      const project = one('select * from project where slug = ?', slug)
      if (!project) throw new ReviewError('project not found', 404)
      return {
        project: { slug, title: String(project.title), createdAt: Number(project.created_at) },
        drafts: all('select * from draft where project_slug = ? order by version', slug).map(toDraft),
        comments: all('select c.* from comment c join draft d on d.id = c.draft_id where d.project_slug = ? order by c.anchor_start_ms, c.created_at', slug).map(toComment),
      }
    },

    editComment(id: string, body: unknown): Comment {
      const text = parseBody(body)
      getComment(id)
      db.prepare('update comment set body = ?, updated_at = ? where id = ?').run(text, Date.now(), id)
      return getComment(id)
    },

    deleteComment(id: string): void {
      getComment(id)
      db.prepare('delete from comment where id = ?').run(id)
    },

    replyAsClaude(idOrPrefix: string, text: unknown, status: CommentStatus = 'addressed'): { reply: Comment; root: Comment } {
      return transaction(() => {
        const target = findComment(idOrPrefix)
        const rootId = target.parentId ?? target.id
        const root = setStatus(rootId, status)
        const reply = insertComment({ draftId: target.draftId, parentId: rootId, anchor: null, body: text, author: 'claude' })
        return { reply, root }
      })
    },
  }
}
