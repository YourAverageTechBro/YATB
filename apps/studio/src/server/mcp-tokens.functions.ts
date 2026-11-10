import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { parseMcpTokenId, parseMcpTokenName, parseMcpScopes } from '#/domain/mcp-tokens'

function parseCreate(value: unknown): { name: string; scopes: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Token input is invalid.')
  const input = value as Record<string, unknown>
  return { name: parseMcpTokenName(input.name), scopes: parseMcpScopes(input.scopes) }
}

async function readSession() {
  const { PRIVATE_NO_STORE, requireStudioSession } = await import('./auth.server')
  setResponseHeader('Cache-Control', PRIVATE_NO_STORE)
  return requireStudioSession()
}

async function mutationSession() {
  const { requireStudioMutationOrigin } = await import('./auth.server')
  const session = await readSession()
  requireStudioMutationOrigin()
  return session
}

export const loadMcpTokens = createServerFn({ method: 'GET' }).handler(async () => {
  await readSession()
  return (await import('./mcp-tokens.server')).listMcpTokens()
})

export const createMcpAccessToken = createServerFn({ method: 'POST' })
  .validator(parseCreate)
  .handler(async ({ data }) => {
    const session = await mutationSession()
    return (await import('./mcp-tokens.server')).createMcpToken(data.name, data.scopes, session.user.id)
  })

export const revokeMcpAccessToken = createServerFn({ method: 'POST' })
  .validator(parseMcpTokenId)
  .handler(async ({ data }) => {
    await mutationSession()
    await (await import('./mcp-tokens.server')).revokeMcpToken(data)
  })
