#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const origin = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL ?? 'files-mcp-proof@youraveragetechbro.com'
const password = process.env.STUDIO_TEST_PASSWORD ?? 'FilesMcp-pass-32-characters!!'
const evidenceDir = process.env.STUDIO_MCP_EVIDENCE ?? resolve('artifacts/studio/files-mcp-local')
mkdirSync(evidenceDir, { recursive: true })

function assert(ok, message) { if (!ok) throw new Error(message) }

function sqliteFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
    .map((entry) => resolve(entry.parentPath, entry.name))
}

function studioDb() {
  const state = resolve('apps/studio/.wrangler/state')
  for (const file of sqliteFiles(state)) {
    const candidate = new DatabaseSync(file)
    const table = candidate.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mcp_access_token'").get()
    if (table) return candidate
    candidate.close()
  }
  throw new Error('Local Studio D1 database with mcp_access_token was not found')
}

function parseTool(result) {
  const text = result.content?.find((part) => part.type === 'text')?.text
  if (!text) throw new Error('Tool result had no text')
  try {
    return { isError: result.isError === true, body: JSON.parse(text) }
  } catch {
    return { isError: result.isError === true, body: { error: text } }
  }
}

async function withClient(bearer, fn) {
  const client = new Client({ name: 'verify-files-mcp', version: '0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    authProvider: { token: async () => bearer },
  })
  await client.connect(transport)
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

async function rpcStatus(headers, body) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  })
  return response.status
}

const unauthorized = await rpcStatus({}, {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'verify-files-mcp', version: '0' } },
})
assert(unauthorized === 401, `Expected 401 without a token, got ${unauthorized}`)

const db = studioDb()
if (!db.prepare('SELECT 1 FROM allowed_email WHERE email = ?').get(email)) {
  db.prepare('INSERT INTO allowed_email (email) VALUES (?)').run(email)
}

const preexisting = Boolean(db.prepare('SELECT 1 FROM user WHERE email = ?').get(email))
if (!preexisting) {
  const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Files MCP proof', email, password }),
  })
  assert(signup.ok, `Signup returned ${signup.status}`)
  const delivery = db.prepare('SELECT body FROM email_outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1').get(email)
  const verifyUrl = delivery?.body.match(/https?:\/\/\S+/)?.[0]
  assert(verifyUrl, 'Verification link was not captured')
  const verification = await fetch(verifyUrl, { redirect: 'manual' })
  assert(verification.status >= 200 && verification.status < 400, `Verification returned ${verification.status}`)
}

const login = await fetch(`${origin}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
assert(login.ok, `Sign-in returned ${login.status}`)
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
assert(cookie, 'Sign-in returned no cookie')

const manifest = await fetch(`${origin}/src/server/mcp-tokens.functions.ts?tss-serverfn-split`)
assert(manifest.ok, `Token function manifest returned ${manifest.status}`)
const ids = Object.fromEntries([... (await manifest.text()).matchAll(/id: "([^"]+)",\n\s*name: "([^"]+)"/g)].map((match) => [match[2], match[1]]))

async function callFn(name, data) {
  const response = await fetch(`${origin}/_serverFn/${ids[name]}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'x-tsr-serverfn': 'true',
    },
    body: JSON.stringify(await toJSONAsync({ data })),
  })
  const body = await response.text()
  assert(response.ok, `${name} returned HTTP ${response.status}: ${body.slice(0, 300)}`)
  return body
}

function extractPlaintext(body) {
  const match = body.match(/yst_[0-9a-f]{64}/)
  assert(match, 'createMcpAccessToken did not return plaintext')
  return match[0]
}

const writeBody = await callFn('createMcpAccessToken', {
  name: 'files-mcp-write',
  scopes: ['files:read', 'files:write'],
})
const readBody = await callFn('createMcpAccessToken', {
  name: 'files-mcp-read',
  scopes: ['files:read'],
})
const writeToken = process.env.STUDIO_MCP_TOKEN ?? extractPlaintext(writeBody)
const readToken = process.env.STUDIO_MCP_READ_TOKEN ?? extractPlaintext(readBody)

const tools = await withClient(writeToken, (client) => client.listTools())
const names = tools.tools.map((tool) => tool.name).sort()
for (const name of ['list_files', 'get_file', 'set_file_tags', 'add_file_tags', 'remove_file_tags']) {
  assert(names.includes(name), `tools/list missing ${name}: ${names.join(',')}`)
}

const user = db.prepare('SELECT id FROM user WHERE email = ?').get(email)
assert(user?.id, 'proof user missing')
const videoId = crypto.randomUUID()
const fileId = crypto.randomUUID()
const uploadId = crypto.randomUUID()
const now = Date.now()
db.prepare(`INSERT INTO video (id, title, format, promotion, status, script_json, revision, created_at, updated_at)
  VALUES (?, 'Files MCP proof', 'short', 'organic', 'filming', '{"type":"doc","content":[]}', 1, ?, ?)`).run(videoId, now, now)
db.prepare(`INSERT INTO upload_session (
  id, video_id, created_by_user_id, client_request_id, file_id, object_key, display_name, byte_size,
  content_type, part_size, part_count, state, purpose, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, 'hero.mp4', 20, 'video/mp4', 33554432, 1, 'ready', 'footage', ?, ?)`).run(
  uploadId, videoId, user.id, crypto.randomUUID(), fileId, `videos/${videoId}/footage/${fileId}`, now, now,
)
db.prepare(`INSERT INTO media_file (
  id, video_id, created_by_user_id, upload_session_id, object_key, display_name, byte_size,
  content_type, object_etag, purpose, created_at, updated_at, duration_ms
) VALUES (?, ?, ?, ?, ?, 'hero.mp4', 20, 'video/mp4', 'etag', 'footage', ?, ?, NULL)`).run(
  fileId, videoId, user.id, uploadId, `videos/${videoId}/footage/${fileId}`, now, now,
)

const listed = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'list_files',
  arguments: { kind: 'footage', video_id: videoId, name: 'hero' },
})))
assert(!listed.isError, `list_files failed: ${JSON.stringify(listed.body)}`)
assert(listed.body.files.some((file) => file.id === fileId && file.kind === 'footage'), 'list_files missed seeded footage')

const tagged = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'set_file_tags',
  arguments: { id: fileId, kind: 'footage', tags: [' B-Roll ', 'product shot'] },
})))
assert(!tagged.isError, `set_file_tags failed: ${JSON.stringify(tagged.body)}`)
assert.deepEqual = undefined
assert(JSON.stringify(tagged.body.tags) === JSON.stringify(['b-roll', 'product shot']), `tags ${JSON.stringify(tagged.body.tags)}`)

const added = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'add_file_tags',
  arguments: { id: fileId, kind: 'footage', tags: ['interview'] },
})))
assert(!added.isError, `add_file_tags failed: ${JSON.stringify(added.body)}`)
assert(added.body.tags.includes('interview'), 'add_file_tags did not keep interview')

const got = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'get_file',
  arguments: { id: fileId, kind: 'footage' },
})))
assert(!got.isError, `get_file failed: ${JSON.stringify(got.body)}`)
assert(typeof got.body.download_url === 'string' && got.body.download_url.includes('/mcp/files/footage/'), 'get_file missing signed url')
assert(typeof got.body.download_expires_at === 'number', 'get_file missing expiry')

const filtered = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'list_files',
  arguments: { tag: 'b-roll', content_type: 'video/' },
})))
assert(filtered.body.files.some((file) => file.id === fileId), 'tag filter missed the file')

const removed = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'remove_file_tags',
  arguments: { id: fileId, kind: 'footage', tags: ['interview'] },
})))
assert(!removed.body.tags.includes('interview'), 'remove_file_tags left interview')

const denied = parseTool(await withClient(readToken, (client) => client.callTool({
  name: 'set_file_tags',
  arguments: { id: fileId, kind: 'footage', tags: ['nope'] },
})))
assert(denied.isError, 'read-only token was allowed to set_file_tags')
assert(String(denied.body.error ?? '').includes('files:write'), `Expected missing-scope error, got ${JSON.stringify(denied.body)}`)

const missingScopeList = parseTool(await withClient(readToken, (client) => client.callTool({
  name: 'list_videos',
  arguments: {},
})))
assert(missingScopeList.isError, 'files-only token listed videos')

const evidence = {
  tools: names,
  fileId,
  videoId,
  tags: removed.body.tags,
  downloadHost: new URL(got.body.download_url).host,
  writeTokenSuffix: writeToken.slice(-4),
  readTokenSuffix: readToken.slice(-4),
  scopeFailure: denied.body,
}
writeFileSync(resolve(evidenceDir, 'files-mcp-tools.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
console.log(`Studio files MCP tools passed at ${origin}/mcp`)
