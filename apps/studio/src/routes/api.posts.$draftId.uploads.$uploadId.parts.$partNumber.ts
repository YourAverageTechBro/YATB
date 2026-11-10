import { createFileRoute } from '@tanstack/react-router'

async function handle({ request, params }: { request: Request; params: { draftId: string; uploadId: string; partNumber: string } }) {
  return (await import('#/server/posts-http.server')).handlePostUploadPart(
    request, params.draftId, params.uploadId, params.partNumber,
  )
}

export const Route = createFileRoute('/api/posts/$draftId/uploads/$uploadId/parts/$partNumber')({
  server: { handlers: { PUT: handle } },
})
