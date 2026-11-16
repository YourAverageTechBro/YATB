import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  FILE_TAG_MAX_COUNT,
  FILES_MIGRATION_MESSAGE,
  contentTypeFilter,
  parseFileKind,
  type CatalogFile,
  type FileKind,
  type ListFilesInput,
} from '#/domain/mcp-files'
import { ACTIVE_VIDEO_SQL } from './video-sql'

const bindings = env as Cloudflare.Env & { DB: D1Database }

export class FilesCatalogError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

type CatalogRow = {
  id: string
  kind: FileKind
  name: string
  content_type: string
  size_bytes: number
  duration_ms: number | null
  created_at: number
  video_id: string | null
  post_id: string | null
}

const CATALOG_SQL = `
SELECT id, kind, name, content_type, size_bytes, duration_ms, created_at, video_id, post_id FROM (
  SELECT f.id, 'footage' AS kind, f.display_name AS name, f.content_type, f.byte_size AS size_bytes,
         f.duration_ms, f.created_at, f.video_id, NULL AS post_id
  FROM media_file f JOIN video v ON v.id = f.video_id
  WHERE f.purpose = 'footage' AND v.${ACTIVE_VIDEO_SQL}
  UNION ALL
  SELECT f.id, 'review_cut' AS kind, f.display_name AS name, f.content_type, f.byte_size AS size_bytes,
         d.duration_ms, f.created_at, f.video_id, NULL AS post_id
  FROM media_file f
  JOIN draft d ON d.media_file_id = f.id AND d.video_id = f.video_id
  JOIN video v ON v.id = f.video_id
  WHERE f.purpose = 'draft' AND v.${ACTIVE_VIDEO_SQL}
  UNION ALL
  SELECT m.id, 'post_media' AS kind, m.display_name AS name, m.content_type, m.byte_size AS size_bytes,
         m.duration_ms, m.created_at, NULL AS video_id, m.post_id
  FROM post_media m
  JOIN post p ON p.id = m.post_id
)`

export async function filesCatalogReady(): Promise<boolean> {
  const row = await bindings.DB.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'file_tag'",
  ).first()
  return row !== null
}

export async function assertFilesCatalog(): Promise<void> {
  if (!(await filesCatalogReady())) {
    throw new FilesCatalogError(503, FILES_MIGRATION_MESSAGE)
  }
}

function catalogFile(row: CatalogRow, tags: readonly string[]): CatalogFile {
  return {
    id: row.id,
    kind: parseFileKind(row.kind),
    name: row.name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
    tags,
    video_id: row.video_id,
    post_id: row.post_id,
  }
}

async function tagsFor(files: readonly CatalogRow[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>()
  if (files.length === 0) return grouped
  const placeholders = files.map(() => '?').join(', ')
  const binds = files.map((file) => `${file.kind}:${file.id}`)
  const result = await bindings.DB.prepare(
    `SELECT kind, file_id, tag FROM file_tag WHERE (kind || ':' || file_id) IN (${placeholders}) ORDER BY tag ASC`,
  ).bind(...binds).all<{ kind: FileKind; file_id: string; tag: string }>()
  for (const row of result.results) {
    const key = `${row.kind}:${row.file_id}`
    const tags = grouped.get(key) ?? []
    tags.push(row.tag)
    grouped.set(key, tags)
  }
  return grouped
}

async function lookupRows(id: string, kind?: FileKind): Promise<CatalogRow[]> {
  const result = await bindings.DB.prepare(
    `${CATALOG_SQL} WHERE id = ?${kind ? ' AND kind = ?' : ''}`,
  ).bind(...(kind ? [id, kind] : [id])).all<CatalogRow>()
  return result.results
}

export async function resolveCatalogFile(id: string, kind?: FileKind): Promise<CatalogFile> {
  await assertFilesCatalog()
  const rows = await lookupRows(id, kind)
  if (rows.length === 0) throw new FilesCatalogError(404, 'File not found.')
  if (rows.length > 1) throw new FilesCatalogError(400, 'kind is required because this id matches more than one file.')
  const row = rows[0]
  if (!row) throw new FilesCatalogError(404, 'File not found.')
  const tags = await tagsFor([row])
  return catalogFile(row, tags.get(`${row.kind}:${row.id}`) ?? [])
}

export async function listCatalogFiles(input: ListFilesInput): Promise<{
  files: CatalogFile[]
  page: number
  limit: number
  has_more: boolean
}> {
  await assertFilesCatalog()
  const where: string[] = []
  const binds: unknown[] = []
  if (input.kind) {
    where.push('kind = ?')
    binds.push(input.kind)
  }
  if (input.video_id) {
    where.push('video_id = ?')
    binds.push(input.video_id)
  }
  if (input.post_id) {
    where.push('post_id = ?')
    binds.push(input.post_id)
  }
  if (input.name) {
    where.push("name LIKE ? ESCAPE '\\'")
    binds.push(`%${input.name.replace(/[%_\\]/g, '\\$&')}%`)
  }
  if (input.content_type) {
    const filter = contentTypeFilter(input.content_type)
    if (filter.exact) {
      where.push('content_type = ?')
      binds.push(filter.exact)
    } else if (filter.prefix) {
      where.push("content_type LIKE ? ESCAPE '\\'")
      binds.push(`${filter.prefix.replace(/[%_\\]/g, '\\$&')}%`)
    }
  }
  if (input.created_after !== undefined) {
    where.push('created_at >= ?')
    binds.push(input.created_after)
  }
  if (input.created_before !== undefined) {
    where.push('created_at <= ?')
    binds.push(input.created_before)
  }
  if (input.tag) {
    where.push('EXISTS (SELECT 1 FROM file_tag t WHERE t.kind = files.kind AND t.file_id = files.id AND t.tag = ?)')
    binds.push(input.tag)
  }
  const sql = `SELECT id, kind, name, content_type, size_bytes, duration_ms, created_at, video_id, post_id
FROM (${CATALOG_SQL}) AS files
${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
ORDER BY created_at DESC, kind ASC, id ASC
LIMIT ? OFFSET ?`
  const rows = (await bindings.DB.prepare(sql).bind(
    ...binds, input.limit + 1, (input.page - 1) * input.limit,
  ).all<CatalogRow>()).results
  const pageRows = rows.slice(0, input.limit)
  const tags = await tagsFor(pageRows)
  return {
    files: pageRows.map((row) => catalogFile(row, tags.get(`${row.kind}:${row.id}`) ?? [])),
    page: input.page,
    limit: input.limit,
    has_more: rows.length > input.limit,
  }
}

export async function listFileTags(kind: FileKind, fileId: string): Promise<readonly string[]> {
  const file = await resolveCatalogFile(fileId, kind)
  return file.tags
}

export async function setFileTags(kind: FileKind | undefined, fileId: string, tags: readonly string[]): Promise<CatalogFile> {
  const file = await resolveCatalogFile(fileId, kind)
  const statements = [
    bindings.DB.prepare('DELETE FROM file_tag WHERE kind = ? AND file_id = ?').bind(file.kind, file.id),
    ...tags.map((tag) => bindings.DB.prepare(
      'INSERT INTO file_tag (kind, file_id, tag) VALUES (?, ?, ?)',
    ).bind(file.kind, file.id, tag)),
  ]
  await bindings.DB.batch(statements)
  return { ...file, tags }
}

export async function addFileTags(kind: FileKind | undefined, fileId: string, tags: readonly string[]): Promise<CatalogFile> {
  const file = await resolveCatalogFile(fileId, kind)
  const next = [...new Set([...file.tags, ...tags])]
  if (next.length > FILE_TAG_MAX_COUNT) {
    throw new FilesCatalogError(400, `Use at most ${FILE_TAG_MAX_COUNT} tags.`)
  }
  if (tags.length > 0) {
    await bindings.DB.batch(tags.map((tag) => bindings.DB.prepare(
      'INSERT OR IGNORE INTO file_tag (kind, file_id, tag) VALUES (?, ?, ?)',
    ).bind(file.kind, file.id, tag)))
  }
  return { ...file, tags: next.sort() }
}

export async function removeFileTags(kind: FileKind | undefined, fileId: string, tags: readonly string[]): Promise<CatalogFile> {
  const file = await resolveCatalogFile(fileId, kind)
  if (tags.length > 0) {
    const placeholders = tags.map(() => '?').join(', ')
    await bindings.DB.prepare(
      `DELETE FROM file_tag WHERE kind = ? AND file_id = ? AND tag IN (${placeholders})`,
    ).bind(file.kind, file.id, ...tags).run()
  }
  const remaining = file.tags.filter((tag) => !tags.includes(tag))
  return { ...file, tags: remaining }
}

export async function getCatalogObject(kind: FileKind, fileId: string): Promise<{
  object_key: string
  display_name: string
  content_type: string
  byte_size: number
} | null> {
  await assertFilesCatalog()
  switch (kind) {
    case 'footage':
    case 'review_cut': {
      const purpose = kind === 'footage' ? 'footage' : 'draft'
      return bindings.DB.prepare(
        `SELECT f.object_key, f.display_name, f.content_type, f.byte_size
         FROM media_file f JOIN video v ON v.id = f.video_id
         WHERE f.id = ? AND f.purpose = ? AND v.${ACTIVE_VIDEO_SQL}`,
      ).bind(fileId, purpose).first()
    }
    case 'post_media':
      return bindings.DB.prepare(
        'SELECT object_key, display_name, content_type, byte_size FROM post_media WHERE id = ?',
      ).bind(fileId).first()
    default: {
      const unexpected: never = kind
      throw new Error(unexpected)
    }
  }
}
