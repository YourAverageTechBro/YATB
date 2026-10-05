import { createFileRoute } from '@tanstack/react-router'

async function post({ request }: { request: Request }) {
  return (await import('#/server/media-http.server')).handleStreamWebhookRequest(request)
}

export const Route = createFileRoute('/api/stream-webhook')({
  server: { handlers: { POST: post } },
})
