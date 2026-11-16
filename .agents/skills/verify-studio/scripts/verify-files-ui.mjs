#!/usr/bin/env node
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const origin = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL ?? 'files-mcp-proof@youraveragetechbro.com'
const password = process.env.STUDIO_TEST_PASSWORD ?? 'FilesMcp-pass-32-characters!!'
const videoId = process.env.STUDIO_VIDEO_ID
const evidenceDir = process.env.STUDIO_MCP_EVIDENCE ?? resolve('artifacts/studio/files-mcp-local')
mkdirSync(evidenceDir, { recursive: true })

function assert(ok, message) { if (!ok) throw new Error(message) }

function parseTool(result) {
  const text = result.content?.find((part) => part.type === 'text')?.text
  if (!text) throw new Error('Tool result had no text')
  return { isError: result.isError === true, body: JSON.parse(text) }
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
try {
  await page.goto(origin)
  await page.waitForLoadState('networkidle')
  await page.locator('form input[name="email"]').fill(email)
  await page.locator('form input[name="password"]').fill(password)
  await Promise.all([
    page.waitForURL('**/videos', { timeout: 20_000 }),
    page.locator('button[type="submit"]').click(),
  ])

  await page.goto(`${origin}/settings`)
  await page.waitForLoadState('networkidle')
  await page.locator('input[name="name"]').fill('files-ui-proof')
  await page.getByLabel('files:read', { exact: true }).click()
  await page.getByLabel('files:write', { exact: true }).click()
  await page.getByRole('button', { name: 'Create token' }).click({ timeout: 10_000 })
  const tokenBox = page.getByLabel('New access token')
  await tokenBox.waitFor({ timeout: 10_000 })
  const token = await tokenBox.inputValue()
  assert(/^yst_[0-9a-f]{64}$/.test(token), 'Settings did not mint a files token')
  await page.getByRole('button', { name: 'Copy token' }).click()

  const href = videoId
    ? `/videos/${videoId}`
    : await (async () => {
      await page.goto(`${origin}/videos`)
      await page.waitForLoadState('networkidle')
      return page.locator('a[href^="/videos/"]').first().getAttribute('href')
    })()
  assert(href, 'No video link was found')
  const videoUrl = `${origin}${href}`
  await page.goto(videoUrl)
  const tags = page.getByLabel(/^Tags for /).first()
  await tags.waitFor({ timeout: 15_000 })
  const name = await tags.getAttribute('aria-label')
  await tags.fill('UI Proof')
  const saved = page.waitForResponse((response) => response.url().includes('/tags') && response.request().method() === 'PUT', { timeout: 10_000 })
  await tags.press('Enter')
  const saveResponse = await saved
  const saveBody = await saveResponse.text()
  assert(saveResponse.ok(), `Tag save HTTP ${saveResponse.status}: ${saveBody}`)
  await page.screenshot({ path: resolve(evidenceDir, 'files-ui-tags.png'), fullPage: true })

  const client = new Client({ name: 'verify-files-ui', version: '0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    authProvider: { token: async () => token },
  })
  await client.connect(transport)
  try {
    const listed = parseTool(await client.callTool({
      name: 'list_files',
      arguments: { tag: 'ui proof' },
    }))
    assert(!listed.isError, `list_files after UI tags failed: ${JSON.stringify(listed.body)}`)
    assert(listed.body.files.some((file) => file.tags.includes('ui proof')), 'UI tag was not visible over MCP')
    writeFileSync(resolve(evidenceDir, 'files-ui-mcp.json'), JSON.stringify({
      videoUrl,
      tagField: name,
      files: listed.body.files.map((file) => ({ id: file.id, kind: file.kind, tags: file.tags })),
      tokenSuffix: token.slice(-4),
    }, null, 2))
  } finally {
    await client.close()
  }
} finally {
  await browser.close()
}

console.log('Studio files UI tags reflected in MCP')
