#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const origin = process.env.STUDIO_URL ?? 'http://localhost:3001'
const token = process.env.STUDIO_MCP_TOKEN
const readToken = process.env.STUDIO_MCP_READ_TOKEN
const postId = process.env.STUDIO_MCP_POST_ID
const evidenceDir = process.env.STUDIO_MCP_EVIDENCE ?? resolve('artifacts/studio/mcp-local')

if (!token || !postId) {
  throw new Error('STUDIO_MCP_TOKEN and STUDIO_MCP_POST_ID are required')
}

mkdirSync(evidenceDir, { recursive: true })

async function rpcUnauthorized() {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'verify-mcp', version: '0' },
      },
    }),
  })
  return response.status
}

async function withClient(bearer, fn) {
  const client = new Client({ name: 'verify-mcp', version: '0' })
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

function parseTool(result) {
  const text = result.content?.find((part) => part.type === 'text')?.text
  if (!text) throw new Error('Tool result had no text')
  return { isError: result.isError === true, body: JSON.parse(text) }
}

const unauthorized = await rpcUnauthorized()
if (unauthorized !== 401) throw new Error(`Expected 401 without a token, got ${unauthorized}`)

const listed = await withClient(token, (client) => client.callTool({ name: 'list_posts', arguments: {} }))
const listBody = parseTool(listed)
if (listBody.isError) throw new Error(`list_posts failed: ${JSON.stringify(listBody.body)}`)

const got = await withClient(token, (client) => client.callTool({ name: 'get_post', arguments: { id: postId } }))
const getBody = parseTool(got)
if (getBody.isError) throw new Error(`get_post failed: ${JSON.stringify(getBody.body)}`)
if (!Array.isArray(getBody.body.posts)) throw new Error('get_post did not return posts')

const postIds = getBody.body.posts.map((_, index) => `verify-x-${index + 1}`)
const marked = await withClient(token, (client) => client.callTool({
  name: 'mark_posted',
  arguments: { id: postId, platform: 'x', post_ids: postIds },
}))
const markBody = parseTool(marked)
if (markBody.isError) throw new Error(`mark_posted failed: ${JSON.stringify(markBody.body)}`)

let scopeFailure = null
if (readToken) {
  const denied = await withClient(readToken, (client) => client.callTool({
    name: 'mark_posted',
    arguments: { id: postId, platform: 'threads', post_ids: postIds.map((id) => id.replace('verify-x-', 'verify-threads-')) },
  }))
  scopeFailure = parseTool(denied)
  if (!scopeFailure.isError) throw new Error('read-only token was allowed to mark_posted')
  if (!String(scopeFailure.body.error ?? '').includes('posts:mark_posted')) {
    throw new Error(`Expected missing-scope error, got ${JSON.stringify(scopeFailure.body)}`)
  }
}

const evidence = {
  unauthorized,
  listCount: Array.isArray(listBody.body) ? listBody.body.length : 0,
  getStatus: getBody.body.status,
  markStatus: markBody.body.status,
  scopeFailure: scopeFailure?.body ?? null,
}
writeFileSync(resolve(evidenceDir, 'mcp-tools.json'), JSON.stringify(evidence, null, 2))

console.log(JSON.stringify(evidence, null, 2))
console.log(`Studio MCP tools passed at ${origin}/mcp`)
