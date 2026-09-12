import { createFileRoute } from '@tanstack/react-router'

async function handle({ params }: { params: { videoId: string } }) {
  return (await import('#/server/media-http.server')).handleMediaCollection(params.videoId)
}

export const Route = createFileRoute('/api/videos/$videoId/media')({
  server: { handlers: { GET: handle } },
})
