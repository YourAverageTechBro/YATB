export const MCP_SCOPES = ['posts:read', 'posts:mark_posted', 'videos:read', 'videos:write'] as const
export type McpScope = (typeof MCP_SCOPES)[number]

export const MCP_TOKEN_PREFIX = 'yst_'
export const MCP_MEDIA_TTL_MS = 15 * 60 * 1000

export type McpAccessToken = Readonly<{
  id: string
  name: string
  scopes: readonly McpScope[]
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}>

export type CreatedMcpAccessToken = McpAccessToken & Readonly<{ plaintext: string }>

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_PATTERN = /^[0-9a-f]{64}$/
const PLAINTEXT_PATTERN = /^yst_[0-9a-f]{64}$/

function invalid(message: string): never {
  throw new Error(message)
}

export function parseMcpTokenId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) invalid('Token id is invalid.')
  return value
}

export function parseMcpTokenName(value: unknown): string {
  if (typeof value !== 'string') invalid('Token name is required.')
  const name = value.trim()
  if (name.length < 1 || name.length > 80) invalid('Token name must be between 1 and 80 characters.')
  return name
}

export function parseMcpScope(value: unknown): McpScope {
  if (typeof value === 'string' && (MCP_SCOPES as readonly string[]).includes(value)) {
    return value as McpScope
  }
  invalid('Token scope is invalid.')
}

export function parseMcpScopes(value: unknown): readonly McpScope[] {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { invalid('Token scopes are invalid.') }
  }
  if (!Array.isArray(parsed) || parsed.length < 1) invalid('Choose at least one scope.')
  const scopes = [...new Set(parsed.map(parseMcpScope))]
  return MCP_SCOPES.filter((scope) => scopes.includes(scope))
}

export function parseBearerToken(header: string | null): string | null {
  if (header === null || header === '') return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1]
  return PLAINTEXT_PATTERN.test(token) ? token : null
}

export function isMcpScope(scopes: readonly McpScope[], needed: McpScope): boolean {
  return scopes.includes(needed)
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sameHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return diff === 0
}

export async function mintMcpPlaintext(): Promise<{ plaintext: string; hash: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32))
  const plaintext = `${MCP_TOKEN_PREFIX}${[...random].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  return { plaintext, hash: await sha256Hex(plaintext) }
}

export function parseTokenHash(value: unknown): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) invalid('Token hash is invalid.')
  return value
}

export async function signMcpMedia(secret: string, mediaId: string, exp: number): Promise<string> {
  return hmacHex(secret, `${mediaId}.${exp}`)
}

export async function verifyMcpMediaMac(
  secret: string,
  mediaId: string,
  exp: number,
  mac: string,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isSafeInteger(exp) || exp <= now || exp > now + MCP_MEDIA_TTL_MS + 60_000) return false
  if (!HASH_PATTERN.test(mac)) return false
  return sameHex(await signMcpMedia(secret, mediaId, exp), mac)
}

export function parseMcpTokenRow(value: unknown): McpAccessToken {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('Stored token is invalid.')
  const row = value as Record<string, unknown>
  const lastUsed = row.last_used_at ?? row.lastUsedAt
  const revoked = row.revoked_at ?? row.revokedAt
  return {
    id: parseMcpTokenId(row.id),
    name: parseMcpTokenName(row.name),
    scopes: parseMcpScopes(row.scopes_json ?? row.scopes),
    createdAt: asInt(row.created_at ?? row.createdAt, 'Token created time is invalid.'),
    lastUsedAt: lastUsed === null || lastUsed === undefined ? null : asInt(lastUsed, 'Token last used time is invalid.'),
    revokedAt: revoked === null || revoked === undefined ? null : asInt(revoked, 'Token revoked time is invalid.'),
  }
}

function asInt(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(message)
  return value
}
