import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { VideoFormat } from '../../src/domain/videos'

export const ids = {
  user: '7b0e913b-645c-4306-a71d-78115390b46d',
  video: '1b0e913b-645c-4306-a71d-78115390b46d',
  file: '3b0e913b-645c-4306-a71d-78115390b46d',
  draft: '5b0e913b-645c-4306-a71d-78115390b46d',
} as const

export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const dir = resolve(process.cwd(), 'migrations')
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(resolve(dir, file), 'utf8'))
  }
  return db
}

export type SeedOptions = Readonly<{ format?: VideoFormat; durationMs?: number; byteSize?: number }>

export function seedDraft(db: DatabaseSync, options: SeedOptions = {}): void {
  const format = options.format ?? 'long'
  const durationMs = options.durationMs ?? 5 * 60_000
  const byteSize = options.byteSize ?? 1_000_000
  const objectKey = `videos/${ids.video}/drafts/${ids.file}`
  db.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES (?, 'Studio User', 'studio@example.com', 1, 1, 1)`).run(ids.user)
  db.prepare(`INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
    VALUES (?, 'Draft AI', ?, 'organic', 'ready-to-review', '{"type":"doc","content":[]}', 1, 1, 1)`).run(ids.video, format)
  const uploadId = crypto.randomUUID()
  db.prepare(`INSERT INTO upload_session (
    id, video_id, created_by_user_id, client_request_id, file_id, object_key,
    display_name, byte_size, content_type, part_size, part_count, state, purpose,
    draft_id, draft_duration_ms, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'draft.mp4', ?, 'video/mp4', 33554432, 1, 'ready', 'draft', ?, ?, 1, 1)`).run(
    uploadId, ids.video, ids.user, crypto.randomUUID(), ids.file, objectKey, byteSize, ids.draft, durationMs,
  )
  db.prepare(`INSERT INTO media_file (
    id, video_id, created_by_user_id, upload_session_id, object_key, display_name,
    byte_size, content_type, object_etag, purpose, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'draft.mp4', ?, 'video/mp4', 'etag', 'draft', 1, 1)`).run(
    ids.file, ids.video, ids.user, uploadId, objectKey, byteSize,
  )
  db.prepare(`INSERT INTO draft (id, video_id, media_file_id, version, duration_ms, created_by_user_id, created_at)
    VALUES (?, ?, ?, 1, ?, ?, 1)`).run(ids.draft, ids.video, ids.file, durationMs, ids.user)
}

export type Param = string | number | null

/** D1 binds `?NNN` placeholders by position. node:sqlite binds them only by name, so the values get numbered. */
export function statement(db: DatabaseSync, sql: string) {
  const prepared = db.prepare(sql)
  const numbered = /\?\d/.test(sql)
  const named = (params: readonly Param[]) =>
    Object.fromEntries(params.map((value, index) => [String(index + 1), value]))
  return {
    run: (...params: Param[]) => (numbered ? prepared.run(named(params)) : prepared.run(...params)),
    all: (...params: Param[]) => (numbered ? prepared.all(named(params)) : prepared.all(...params)),
    get: (...params: Param[]) => (numbered ? prepared.get(named(params)) : prepared.get(...params)),
  }
}

type BoundStatement = Readonly<{ sql: string; params: readonly Param[] }>

function execute(db: DatabaseSync, bound: BoundStatement) {
  const results = statement(db, bound.sql).all(...bound.params)
  const { changes } = db.prepare('SELECT changes() AS changes').get() as { changes: number }
  return { results, success: true, meta: { changes } }
}

/** D1 semantics the server code relies on: `batch` is one transaction, and RETURNING rows come back in `results`. */
export function d1(db: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bound = (params: readonly Param[]) => ({
      sql,
      params,
      bind: (...next: Param[]) => bound(next),
      first: async () => statement(db, sql).get(...params) ?? null,
      run: async () => execute(db, { sql, params }),
      all: async () => execute(db, { sql, params }),
    })
    return bound([])
  }
  return {
    prepare,
    async exec(sql: string) {
      db.exec(sql)
      return { count: 0, duration: 0 }
    },
    async batch(statements: readonly BoundStatement[]) {
      db.exec('BEGIN')
      try {
        const results = statements.map((statement) => execute(db, statement))
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as D1Database
}
