import { createFileRoute } from '@tanstack/react-router'

async function handle({ request, params }: { request: Request; params: { draftId: string; uploadId: string } }) {
  return (await import('#/server/posts-http.server')).handlePostUpload(request, params.draftId, params.uploadId)
}

export const Route = createFileRoute('/api/posts/$draftId/uploads/$uploadId')({
  server: { handlers: { GET: handle, DELETE: handle } },
})
