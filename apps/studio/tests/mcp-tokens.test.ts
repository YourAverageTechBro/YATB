import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { applyPosted } from '../src/domain/mcp-posts'
import {
  MCP_SCOPES,
  isMcpScope,
  parseBearerToken,
  parseMcpScopes,
  parseMcpTokenName,
  sha256Hex,
  signMcpMedia,
  verifyMcpMediaMac,
} from '../src/domain/mcp-tokens'
import { getPost, markPosted, type PostDraft } from '../src/domain/posts'

const ids = {
  draft: '1b0e913b-645c-4306-a71d-78115390b46d',
  post: '28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27',
  post2: '3879b960-ec74-4c13-b823-c6d32cb15b7d',
  user: '6c04e985-3580-4ea9-9c4e-5af7d30ca441',
} as const

function draft(): PostDraft {
  return getPost({
    draft: {
      id: ids.draft,
      target: 'both',
      x_premium: 0,
      status: 'draft',
      revision: 1,
      updated_by_user_id: ids.user,
      created_at: 1,
      updated_at: 1,
    },
    posts: [
      { id: ids.post, position: 0, body: 'First line of the thread' },
      { id: ids.post2, position: 1, body: 'Second' },
    ],
    media: [],
    publications: [],
  })
}

describe('MCP token parsing', () => {
  it('accepts a Bearer yst_ token and hashes with SHA-256', async () => {
    const plaintext = `yst_${'ab'.repeat(32)}`
    expect(parseBearerToken(`Bearer ${plaintext}`)).toBe(plaintext)
    expect(parseBearerToken('Bearer not-a-token')).toBeNull()
    expect(parseBearerToken(null)).toBeNull()
    const hash = await sha256Hex(plaintext)
    expect(hash).toHaveLength(64)
    expect(hash).not.toBe(plaintext)
  })

  it('keeps named scopes and rejects an empty list', () => {
    expect(parseMcpTokenName(' Poster bot ')).toBe('Poster bot')
    expect(parseMcpScopes(['posts:mark_posted', 'posts:read', 'posts:read'])).toEqual([...MCP_SCOPES])
    expect(isMcpScope(['posts:read'], 'posts:mark_posted')).toBe(false)
    expect(() => parseMcpScopes([])).toThrow(/at least one scope/)
  })

  it('accepts a 15 minute media mac and rejects an expired one', async () => {
    const now = 1_700_000_000_000
    const exp = now + 15 * 60 * 1000
    const mac = await signMcpMedia('secret', ids.post, exp)
    expect(await verifyMcpMediaMac('secret', ids.post, exp, mac, now)).toBe(true)
    expect(await verifyMcpMediaMac('secret', ids.post, exp, mac, exp + 1)).toBe(false)
  })
})

describe('applyPosted', () => {
  it('keeps a draft until every target is posted, then marks posted', () => {
    const first = applyPosted(draft(), 'x', ['aa', 'bb'], 10)
    expect(first.kind).toBe('ok')
    if (first.kind !== 'ok') return
    expect(first.draft.status).toBe('draft')
    const done = applyPosted(first.draft, 'threads', ['cc', 'dd'], 11, [
      'https://www.threads.net/t/cc',
      'https://www.threads.net/t/dd',
    ])
    expect(done.kind).toBe('ok')
    if (done.kind !== 'ok') return
    expect(done.draft.status).toBe('posted')
    expect(done.draft.publications.find((row) => row.platform === 'threads')?.urls).toEqual([
      'https://www.threads.net/t/cc',
      'https://www.threads.net/t/dd',
    ])
  })

  it('is idempotent for the same posted ids', () => {
    const ready = { ...draft(), status: 'ready' as const }
    const once = applyPosted(ready, 'x', ['aa', 'bb'], 10)
    expect(once.kind).toBe('ok')
    if (once.kind !== 'ok') return
    const twice = applyPosted(once.draft, 'x', ['aa', 'bb'], 99)
    expect(twice).toEqual(once)
    expect(markPosted(once.draft, 'x', ['zz', 'yy'], 12).kind).toBe('invalid')
  })
})

describe('0015_mcp_access_tokens.sql', () => {
  it('stores a hash, not the plaintext token', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON;')
    db.exec(readFileSync(resolve(process.cwd(), 'migrations/0001_auth.sql'), 'utf8'))
    db.exec(readFileSync(resolve(process.cwd(), 'migrations/0015_mcp_access_tokens.sql'), 'utf8'))
    db.prepare('INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, 1, 1)')
      .run(ids.user, 'T', 'dohyun@youraveragetechbro.com')
    db.prepare(`INSERT INTO mcp_access_token (
      id, name, token_hash, scopes_json, created_by_user_id, created_at, last_used_at, revoked_at
    ) VALUES (?, 'bot', ?, ?, ?, 1, NULL, NULL)`).run(
      ids.draft,
      'a'.repeat(64),
      JSON.stringify(['posts:read']),
      ids.user,
    )
    const row = db.prepare('SELECT token_hash, scopes_json FROM mcp_access_token').get() as { token_hash: string; scopes_json: string }
    expect(row.token_hash).toHaveLength(64)
    expect(row.token_hash.startsWith('yst_')).toBe(false)
    expect(JSON.parse(row.scopes_json)).toEqual(['posts:read'])
  })
})
