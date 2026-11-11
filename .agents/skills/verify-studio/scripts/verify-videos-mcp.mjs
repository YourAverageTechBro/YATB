#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const origin = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL ?? 'videos-mcp-proof@youraveragetechbro.com'
const password = process.env.STUDIO_TEST_PASSWORD ?? 'VideosMcp-pass-32-characters!!'
const evidenceDir = process.env.STUDIO_MCP_EVIDENCE ?? resolve('artifacts/studio/videos-mcp-local')
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
  const client = new Client({ name: 'verify-videos-mcp', version: '0' })
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

const db = studioDb()
if (!db.prepare('SELECT 1 FROM allowed_email WHERE email = ?').get(email)) {
  db.prepare('INSERT INTO allowed_email (email) VALUES (?)').run(email)
}

const preexisting = Boolean(db.prepare('SELECT 1 FROM user WHERE email = ?').get(email))
if (!preexisting) {
  const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Videos MCP proof', email, password }),
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
  name: 'videos-mcp-write',
  scopes: ['videos:read', 'videos:write'],
})
const readBody = await callFn('createMcpAccessToken', {
  name: 'videos-mcp-read',
  scopes: ['videos:read'],
})
const writeToken = process.env.STUDIO_MCP_TOKEN ?? extractPlaintext(writeBody)
const readToken = process.env.STUDIO_MCP_READ_TOKEN ?? extractPlaintext(readBody)

const tools = await withClient(writeToken, (client) => client.listTools())
const names = tools.tools.map((tool) => tool.name).sort()
assert(names.includes('list_videos'), `tools/list missing list_videos: ${names.join(',')}`)
assert(names.includes('get_video'), 'tools/list missing get_video')
assert(names.includes('create_video'), 'tools/list missing create_video')
assert(names.includes('update_video'), 'tools/list missing update_video')
assert(names.includes('list_posts'), 'posts tools were removed')

const listed = parseTool(await withClient(writeToken, (client) => client.callTool({ name: 'list_videos', arguments: {} })))
assert(!listed.isError, `list_videos failed: ${JSON.stringify(listed.body)}`)
assert(Array.isArray(listed.body.videos), 'list_videos did not return videos')

const short = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'create_video',
  arguments: { title: 'MCP short proof', format: 'short', promotion: 'organic' },
})))
assert(!short.isError, `create short failed: ${JSON.stringify(short.body)}`)
assert(short.body.format === 'short', 'short video format mismatch')
assert(short.body.status === 'not-started', 'omitted create status should be not-started')

const filming = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'create_video',
  arguments: { title: 'MCP filming proof', format: 'short', promotion: 'organic', status: 'filming' },
})))
assert(!filming.isError, `create with status failed: ${JSON.stringify(filming.body)}`)
assert(filming.body.status === 'filming', `expected filming, got ${filming.body.status}`)

const organic = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'create_video',
  arguments: { title: 'MCP organic carrier', format: 'long', promotion: 'organic' },
})))
assert(!organic.isError, `create organic failed: ${JSON.stringify(organic.body)}`)

const integration = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'create_video',
  arguments: {
    title: 'MCP integration proof',
    format: 'long',
    promotion: 'integration',
    organic_video_id: organic.body.id,
  },
})))
assert(!integration.isError, `create integration failed: ${JSON.stringify(integration.body)}`)
assert(integration.body.organic_video_id === organic.body.id, 'integration did not store the organic link')

const got = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'get_video',
  arguments: { id: integration.body.id },
})))
assert(!got.isError, `get_video failed: ${JSON.stringify(got.body)}`)
assert(got.body.linked_organic?.id === organic.body.id, 'get_video missing linked organic')

const inbound = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'get_video',
  arguments: { id: organic.body.id },
})))
assert(inbound.body.inbound_integrations?.some((row) => row.id === integration.body.id), 'organic missing inbound integration')

const script = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{
      type: 'text',
      text: 'Script: https://docs.google.com/document/d/mcp-proof',
      marks: [{ type: 'link', attrs: { href: 'https://docs.google.com/document/d/mcp-proof' } }],
    }],
  }],
}
const updated = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'update_video',
  arguments: { id: short.body.id, script },
})))
assert(!updated.isError, `update_video failed: ${JSON.stringify(updated.body)}`)
assert(JSON.stringify(updated.body.script).includes('docs.google.com'), 'script update did not persist')

const denied = parseTool(await withClient(readToken, (client) => client.callTool({
  name: 'create_video',
  arguments: { title: 'Should fail', format: 'short', promotion: 'organic' },
})))
assert(denied.isError, 'read-only token was allowed to create_video')
assert(String(denied.body.error ?? '').includes('videos:write'), `Expected missing-scope error, got ${JSON.stringify(denied.body)}`)

const unknown = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'list_videos',
  arguments: { layout: 'board' },
})))
assert(unknown.isError, 'unknown list field was accepted')

const storedShort = db.prepare('SELECT title, format, promotion, script_json FROM video WHERE id = ?').get(short.body.id)
assert(storedShort?.title === 'MCP short proof', 'D1 missing short video')
assert(String(storedShort.script_json).includes('docs.google.com'), 'D1 script was not updated')
const storedFilming = db.prepare('SELECT status FROM video WHERE id = ?').get(filming.body.id)
assert(storedFilming?.status === 'filming', `D1 status ${storedFilming?.status}`)

const evidence = {
  tools: names,
  shortId: short.body.id,
  filmingId: filming.body.id,
  filmingStatus: filming.body.status,
  organicId: organic.body.id,
  integrationId: integration.body.id,
  shortTokenSuffix: writeToken.slice(-4),
  readTokenSuffix: readToken.slice(-4),
  scopeFailure: denied.body,
  unknownField: unknown.body,
}
writeFileSync(resolve(evidenceDir, 'videos-mcp-tools.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
console.log(`Studio video MCP tools passed at ${origin}/mcp`)
