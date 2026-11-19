import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { ReviewError, parseStatus } from '../shared/domain.ts'
import type { Store } from './store.ts'

type Next = () => void
const MAX_JSON_BYTES = 64 * 1024
const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' }

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  // Requiring JSON blocks cross-site form posts, which cannot set this header without a CORS preflight.
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ReviewError('content-type must be application/json', 415)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_JSON_BYTES) throw new ReviewError('request body too large', 413)
    chunks.push(chunk as Buffer)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>
  } catch { /* falls through */ }
  throw new ReviewError('body must be a JSON object')
}

// Returns undefined for no/garbled Range (serve whole file) and null when unsatisfiable.
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '')
  if (!match || (match[1] === '' && match[2] === '')) return undefined
  let start: number
  let end: number
  if (match[1] === '') {
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  return start >= size || start > end ? null : { start, end }
}

function serveMedia(store: Store, draftId: string, req: IncomingMessage, res: ServerResponse): void {
  // The path comes only from the DB row, never from the request.
  const draft = store.getDraft(draftId)
  let size = -1
  try { if (draft) size = statSync(draft.filePath).size } catch { /* missing file is a 404 */ }
  if (!draft || size < 0) return void sendJson(res, 404, { error: 'draft file not found' })

  const headers = { 'content-type': MIME[extname(draft.filePath).toLowerCase()] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
  const range = parseRange(req.headers.range, size)
  if (range === null) return void res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` }).end()
  const [status, start, end] = range ? [206, range.start, range.end] : [200, 0, size - 1]
  res.writeHead(status, { ...headers, 'content-length': size === 0 ? 0 : end - start + 1, ...(range && { 'content-range': `bytes ${start}-${end}/${size}` }) })
  if (req.method === 'HEAD' || size === 0) return void res.end()
  const stream = createReadStream(draft.filePath, { start, end })
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

async function route(store: Store, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const method = req.method ?? 'GET'
  let m: RegExpExecArray | null
  if (method === 'GET' && path === '/api/projects') return sendJson(res, 200, store.listProjects())
  if (method === 'GET' && (m = /^\/api\/projects\/([^/]+)$/.exec(path))) return sendJson(res, 200, store.getProject(decodeURIComponent(m[1]!)))
  if (method === 'POST' && (m = /^\/api\/drafts\/([^/]+)\/comments$/.exec(path))) {
    const body = await readJson(req)
    const parentId = typeof body.parentId === 'string' ? body.parentId : null
    return sendJson(res, 201, store.addComment({ draftId: m[1]!, parentId, anchor: body.anchor, body: body.body, author: 'thomas' }))
  }
  if (method === 'PATCH' && (m = /^\/api\/comments\/([^/]+)$/.exec(path))) return sendJson(res, 200, store.editComment(m[1]!, (await readJson(req)).body))
  if (method === 'POST' && (m = /^\/api\/comments\/([^/]+)\/status$/.exec(path))) return sendJson(res, 200, store.setStatus(m[1]!, parseStatus((await readJson(req)).status)))
  if (method === 'DELETE' && (m = /^\/api\/comments\/([^/]+)$/.exec(path))) {
    store.deleteComment(m[1]!)
    return void res.writeHead(204).end()
  }
  throw new ReviewError('not found', 404)
}

export function createMiddleware(store: Store) {
  return (req: IncomingMessage, res: ServerResponse, next: Next): void => {
    const path = (req.url ?? '').split('?')[0] ?? ''
    const media = /^\/media\/([^/]+)$/.exec(path)
    if (media && (req.method === 'GET' || req.method === 'HEAD')) return serveMedia(store, media[1]!, req, res)
    if (!path.startsWith('/api/')) return next()
    route(store, req, res, path).catch((error: unknown) => {
      const status = error instanceof ReviewError ? error.status : 500
      sendJson(res, status, { error: error instanceof Error ? error.message : 'internal error' })
    })
  }
}
