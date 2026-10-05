import { createFileRoute } from '@tanstack/react-router'

async function read({ request, params }: { request: Request; params: { fileId: string } }) {
  return (await import('#/server/media-http.server')).handleStreamSource(request, params.fileId)
}

export const Route = createFileRoute('/api/stream-source/$fileId')({
  server: { handlers: { GET: read, HEAD: read } },
})
