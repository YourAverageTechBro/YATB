import { createFileRoute } from '@tanstack/react-router'

async function handle(request: Request): Promise<Response> {
  const { createAuth } = await import('#/server/auth.server')
  return createAuth().handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) } },
})
