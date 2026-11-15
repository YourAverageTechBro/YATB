import { createFileRoute } from '@tanstack/react-router'

async function handle({ request, params }: { request: Request; params: { kind: string; fileId: string } }) {
  return (await import('#/server/files-http.server')).handleFileTags(request, params.kind, params.fileId)
}

export const Route = createFileRoute('/api/files/$kind/$fileId/tags')({
  server: { handlers: { GET: handle, PUT: handle } },
})
