import { createFileRoute } from '@tanstack/react-router'

async function read({ request, params }: { request: Request; params: { videoId: string; fileId: string } }) {
  return (await import('#/server/media-http.server')).handleMediaRead(request, params.videoId, params.fileId)
}

async function mutate({ request, params }: { request: Request; params: { videoId: string; fileId: string } }) {
  return (await import('#/server/media-http.server')).handleMediaMutation(request, params.videoId, params.fileId)
}

export const Route = createFileRoute('/api/videos/$videoId/media/$fileId')({
  server: { handlers: { GET: read, HEAD: read, PATCH: mutate } },
})
