import { createFileRoute } from '@tanstack/react-router'

async function handle({ request, params }: { request: Request; params: { videoId: string } }) {
  return (await import('#/server/media-http.server')).handleUploadCollection(request, params.videoId)
}

export const Route = createFileRoute('/api/videos/$videoId/uploads')({
  server: { handlers: { POST: handle } },
})
