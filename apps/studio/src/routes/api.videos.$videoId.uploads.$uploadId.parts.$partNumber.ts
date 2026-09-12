import { createFileRoute } from '@tanstack/react-router'

async function handle({ request, params }: { request: Request; params: { videoId: string; uploadId: string; partNumber: string } }) {
  return (await import('#/server/media-http.server')).handleUploadPart(
    request, params.videoId, params.uploadId, params.partNumber,
  )
}

export const Route = createFileRoute('/api/videos/$videoId/uploads/$uploadId/parts/$partNumber')({
  server: { handlers: { PUT: handle } },
})
