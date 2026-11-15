import '@tanstack/react-start/server-only'
import { parseFileKind, parseTags } from '#/domain/mcp-files'
import { parseMediaId } from '#/domain/media'
import { PRIVATE_NO_STORE, requireStudioMutationOrigin, requireStudioSession } from './auth.server'
import { FilesCatalogError, listFileTags, setFileTags } from './files.server'

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': PRIVATE_NO_STORE },
  })
}

function errorResponse(error: unknown): Response {
  if (error instanceof FilesCatalogError) return json({ error: error.message }, error.status)
  if (error instanceof Error && /(?:required|invalid|between|at most|kind)/i.test(error.message)) {
    return json({ error: error.message }, 400)
  }
  console.error('File catalog request failed', error)
  return json({ error: 'File catalog request failed.' }, 500)
}

export function handleFileTags(request: Request, kindValue: string, fileIdValue: string): Promise<Response> {
  return (async () => {
    try {
      await requireStudioSession()
      const kind = parseFileKind(kindValue)
      const fileId = parseMediaId(fileIdValue)
      if (request.method === 'GET') {
        return json({ tags: await listFileTags(kind, fileId) })
      }
      requireStudioMutationOrigin()
      const body = await request.json() as { tags?: unknown }
      const file = await setFileTags(kind, fileId, parseTags(body.tags))
      return json({ tags: file.tags })
    } catch (error) {
      if (error instanceof Response) return error
      if (error instanceof SyntaxError) return json({ error: 'Request body is invalid.' }, 400)
      return errorResponse(error)
    }
  })()
}
