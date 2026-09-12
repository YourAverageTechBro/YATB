import { createFileRoute } from '@tanstack/react-router'

async function handle(): Promise<Response> {
  const { getStudioSession, PRIVATE_NO_STORE } = await import(
    '#/server/auth.server'
  )
  if (!(await getStudioSession())) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'Cache-Control': PRIVATE_NO_STORE },
    })
  }
  return new Response('Media not found', {
    status: 404,
    headers: { 'Cache-Control': PRIVATE_NO_STORE },
  })
}

export const Route = createFileRoute('/api/media/$mediaId')({
  server: { handlers: { GET: handle, HEAD: handle } },
})
