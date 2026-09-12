import { createFileRoute } from '@tanstack/react-router'

async function handle({ request, params }: { request: Request; params: { videoId: string; uploadId: string } }) {
  return (await import('#/server/media-http.server')).handleUpload(request, params.videoId, params.uploadId)
}

export const Route = createFileRoute('/api/videos/$videoId/uploads/$uploadId')({
  server: { handlers: { GET: handle, DELETE: handle } },
})
