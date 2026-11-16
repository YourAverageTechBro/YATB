#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const origin = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL ?? 'videos-mcp-upload@youraveragetechbro.com'
const password = process.env.STUDIO_TEST_PASSWORD ?? 'VideosMcp-upload-32-characters!!'
const evidenceDir = process.env.STUDIO_MCP_EVIDENCE ?? resolve('artifacts/studio/mcp-draft-upload-local')
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
    const table = candidate.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mcp_video_upload'").get()
    if (table) return candidate
    candidate.close()
  }
  throw new Error('Local Studio D1 database with mcp_video_upload was not found')
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
  const client = new Client({ name: 'verify-mcp-draft-upload', version: '0' })
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

function box(type, payload) {
  const out = Buffer.alloc(8 + payload.length)
  out.writeUInt32BE(out.length, 0)
  out.write(type, 4, 4, 'ascii')
  payload.copy(out, 8)
  return out
}

function testMp4(durationMs) {
  const mvhdPayload = Buffer.alloc(108)
  mvhdPayload.writeUInt32BE(1000, 12)
  mvhdPayload.writeUInt32BE(durationMs, 16)
  const moov = box('moov', box('mvhd', mvhdPayload))
  const ftyp = box('ftyp', Buffer.from('isomiso2mp41'))
  const mdat = box('mdat', Buffer.from([0, 0, 0, 1]))
  return Buffer.concat([ftyp, moov, mdat])
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
    body: JSON.stringify({ name: 'MCP draft upload', email, password }),
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

const writeToken = process.env.STUDIO_MCP_TOKEN ?? extractPlaintext(await callFn('createMcpAccessToken', {
  name: 'draft-upload-write',
  scopes: ['videos:read', 'videos:write'],
}))
const readToken = process.env.STUDIO_MCP_READ_TOKEN ?? extractPlaintext(await callFn('createMcpAccessToken', {
  name: 'draft-upload-read',
  scopes: ['videos:read'],
}))

const created = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'create_video',
  arguments: { title: 'MCP draft upload carrier', format: 'long', promotion: 'organic' },
})))
assert(!created.isError, `create_video failed: ${JSON.stringify(created.body)}`)
const videoId = created.body.id
const bytes = testMp4(4000)

const requested = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'request_video_upload',
  arguments: {
    video_id: videoId,
    filename: 'mcp-cut.mp4',
    content_type: 'video/mp4',
    size: bytes.byteLength,
  },
})))
assert(!requested.isError, `request_video_upload failed: ${JSON.stringify(requested.body)}`)
assert(requested.body.upload_url, 'request_video_upload missing upload_url')
assert(requested.body.headers?.['Content-Type'] === 'video/mp4', 'missing Content-Type header')

const denied = parseTool(await withClient(readToken, (client) => client.callTool({
  name: 'request_video_upload',
  arguments: {
    video_id: videoId,
    filename: 'mcp-cut.mp4',
    content_type: 'video/mp4',
    size: bytes.byteLength,
  },
})))
assert(denied.isError, 'read-only token was allowed to request_video_upload')

const put = await fetch(requested.body.upload_url, {
  method: 'PUT',
  headers: requested.body.headers,
  body: bytes,
})
assert(put.ok, `presigned PUT returned ${put.status} ${await put.text()}`)

const finalized = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'finalize_video_upload',
  arguments: { upload_id: requested.body.upload_id },
})))
assert(!finalized.isError, `finalize_video_upload failed: ${JSON.stringify(finalized.body)}`)
assert(finalized.body.version === 1, `expected version 1, got ${finalized.body.version}`)
assert(finalized.body.filename === 'mcp-cut.mp4', 'filename mismatch')

const again = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'finalize_video_upload',
  arguments: { upload_id: requested.body.upload_id },
})))
assert(!again.isError, `idempotent finalize failed: ${JSON.stringify(again.body)}`)
assert(again.body.id === finalized.body.id, 'idempotent finalize returned a different draft')
assert(again.body.version === 1, 'idempotent finalize created another version')

const listed = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'list_draft_versions',
  arguments: { video_id: videoId },
})))
assert(!listed.isError, `list_draft_versions failed: ${JSON.stringify(listed.body)}`)
assert(listed.body.drafts?.[0]?.id === finalized.body.id, 'list_draft_versions did not put the new draft first')

const got = parseTool(await withClient(writeToken, (client) => client.callTool({
  name: 'get_video',
  arguments: { id: videoId },
})))
assert(!got.isError, `get_video failed: ${JSON.stringify(got.body)}`)
assert(got.body.draft_versions?.[0]?.id === finalized.body.id, 'get_video missing newest draft version')
assert(got.body.draft_versions[0].download_url.includes('/mcp/media/draft/'), 'missing signed original URL')

const page = await fetch(`${origin}/videos/${videoId}`, { headers: { Cookie: cookie }, redirect: 'manual' })
assert(page.status === 200, `/videos/${videoId} returned ${page.status}`)
const html = await page.text()
assert(html.includes('Video drafts') || html.includes('mcp-cut.mp4') || html.includes(videoId), 'video page did not load the task')

const stored = db.prepare(
  `SELECT d.version, f.display_name, f.object_key FROM draft d
   JOIN media_file f ON f.id = d.media_file_id WHERE d.video_id = ? ORDER BY d.version DESC`,
).get(videoId)
assert(stored?.version === 1, `D1 draft version ${stored?.version}`)
assert(stored?.display_name === 'mcp-cut.mp4', `D1 filename ${stored?.display_name}`)
assert(String(stored.object_key).startsWith(`videos/${videoId}/drafts/`), `unexpected object key ${stored?.object_key}`)

const evidence = {
  videoId,
  uploadId: requested.body.upload_id,
  draftId: finalized.body.id,
  version: finalized.body.version,
  putStatus: put.status,
  downloadUrlHost: new URL(got.body.draft_versions[0].download_url).host,
  scopeFailure: denied.body,
}
writeFileSync(resolve(evidenceDir, 'mcp-draft-upload.json'), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
console.log(`MCP draft upload attached version ${finalized.body.version} on ${videoId}`)
