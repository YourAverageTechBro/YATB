import { createFileRoute } from '@tanstack/react-router'

async function read({ request, params }: { request: Request; params: { token: string } }) {
  return (await import('#/server/media-http.server')).handleSharedMediaRead(request, params.token)
}

export const Route = createFileRoute('/api/shared-files/$token')({
  server: { handlers: { GET: read, HEAD: read } },
})
