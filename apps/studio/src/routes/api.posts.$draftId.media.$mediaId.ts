import { createFileRoute } from '@tanstack/react-router'

async function read({ request, params }: { request: Request; params: { draftId: string; mediaId: string } }) {
  return (await import('#/server/posts-http.server')).handlePostMediaRead(request, params.draftId, params.mediaId)
}

export const Route = createFileRoute('/api/posts/$draftId/media/$mediaId')({
  server: { handlers: { GET: read, HEAD: read } },
})
