import { createFileRoute } from '@tanstack/react-router'

async function handle({ params }: { params: { videoId: string; uploadId: string } }) {
  return (await import('#/server/media-http.server')).handleUploadComplete(params.videoId, params.uploadId)
}

export const Route = createFileRoute('/api/videos/$videoId/uploads/$uploadId/complete')({
  server: { handlers: { POST: handle } },
})
