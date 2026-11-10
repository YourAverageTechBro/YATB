import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import {
  mintMcpPlaintext,
  parseMcpScopes,
  parseMcpTokenId,
  parseMcpTokenName,
  parseMcpTokenRow,
  sha256Hex,
  type CreatedMcpAccessToken,
  type McpAccessToken,
} from '#/domain/mcp-tokens'

const bindings = env as Cloudflare.Env

type TokenRow = {
  id: string
  name: string
  scopes_json: string
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

export async function listMcpTokens(): Promise<readonly McpAccessToken[]> {
  const result = await bindings.DB.prepare(
    `SELECT id, name, scopes_json, created_at, last_used_at, revoked_at
     FROM mcp_access_token
     ORDER BY created_at DESC, id ASC`,
  ).all<TokenRow>()
  return result.results.map(parseMcpTokenRow)
}

export async function createMcpToken(
  nameValue: unknown,
  scopesValue: unknown,
  userId: string,
  now = Date.now(),
): Promise<CreatedMcpAccessToken> {
  const name = parseMcpTokenName(nameValue)
  const scopes = parseMcpScopes(scopesValue)
  const id = crypto.randomUUID()
  const minted = await mintMcpPlaintext()
  await bindings.DB.prepare(
    `INSERT INTO mcp_access_token (
      id, name, token_hash, scopes_json, created_by_user_id, created_at, last_used_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).bind(id, name, minted.hash, JSON.stringify(scopes), userId, now).run()
  return {
    id,
    name,
    scopes,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
    plaintext: minted.plaintext,
  }
}

export async function revokeMcpToken(idValue: unknown, now = Date.now()): Promise<void> {
  const id = parseMcpTokenId(idValue)
  await bindings.DB.prepare(
    `UPDATE mcp_access_token SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
  ).bind(now, id).run()
}

export type ResolvedMcpToken = McpAccessToken & Readonly<{ hash: string }>

export async function resolveMcpBearer(plaintext: string, now = Date.now()): Promise<ResolvedMcpToken | null> {
  const hash = await sha256Hex(plaintext)
  const row = await bindings.DB.prepare(
    `SELECT id, name, token_hash, scopes_json, created_at, last_used_at, revoked_at
     FROM mcp_access_token WHERE token_hash = ?`,
  ).bind(hash).first<TokenRow & { token_hash: string }>()
  if (!row || row.revoked_at !== null) return null
  const token = parseMcpTokenRow(row)
  await bindings.DB.prepare(
    `UPDATE mcp_access_token SET last_used_at = ? WHERE id = ?`,
  ).bind(now, token.id).run()
  return { ...token, hash: row.token_hash }
}
