import { createFileRoute } from '@tanstack/react-router'

async function handle({ request, params }: { request: Request; params: { draftId: string } }) {
  return (await import('#/server/posts-http.server')).handlePostUploadCollection(request, params.draftId)
}

export const Route = createFileRoute('/api/posts/$draftId/uploads')({
  server: { handlers: { POST: handle } },
})
