import { createFileRoute } from '@tanstack/react-router'

async function handle({ params }: { params: { draftId: string; uploadId: string } }) {
  return (await import('#/server/posts-http.server')).handlePostUploadComplete(params.draftId, params.uploadId)
}

export const Route = createFileRoute('/api/posts/$draftId/uploads/$uploadId/complete')({
  server: { handlers: { POST: handle } },
})
