import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMiddleware } from '../server/http.ts'
import { openStore } from '../server/store.ts'

let server: Server
let base: string
let draftId: string

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-media-'))
  writeFileSync(join(dir, 'clip.mp4'), '0123456789')
  const store = openStore(join(dir, 'review.db'))
  draftId = store.postDraft({ slug: 'clip', file: join(dir, 'clip.mp4') }).draft.id
  const middleware = createMiddleware(store)
  server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

describe('GET /media/:draftId', () => {
  it('serves a byte range as 206', async () => {
    const response = await fetch(`${base}/media/${draftId}`, { headers: { range: 'bytes=2-5' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(await response.text()).toBe('2345')
  })

  it('serves the whole file as 200 without Range', async () => {
    const response = await fetch(`${base}/media/${draftId}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(await response.text()).toBe('0123456789')
  })

  it('supports open-ended and suffix ranges', async () => {
    expect(await (await fetch(`${base}/media/${draftId}`, { headers: { range: 'bytes=7-' } })).text()).toBe('789')
    expect(await (await fetch(`${base}/media/${draftId}`, { headers: { range: 'bytes=-3' } })).text()).toBe('789')
  })

  it('answers 416 when the range starts past the end', async () => {
    const response = await fetch(`${base}/media/${draftId}`, { headers: { range: 'bytes=50-60' } })
    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
  })

  it('answers 404 for an unknown draft', async () => {
    expect((await fetch(`${base}/media/nope`)).status).toBe(404)
  })
})

describe('JSON API', () => {
  it('lets Thomas comment and reopen, and rejects an illegal transition', async () => {
    const json = { 'content-type': 'application/json' }
    const created = await fetch(`${base}/api/drafts/${draftId}/comments`, { method: 'POST', headers: json, body: JSON.stringify({ anchor: { kind: 'point', atMs: 500 }, body: ' fix ' }) })
    expect(created.status).toBe(201)
    const comment = await created.json()
    expect(comment).toMatchObject({ author: 'thomas', body: 'fix', status: 'open' })

    const resolved = await fetch(`${base}/api/comments/${comment.id}/status`, { method: 'POST', headers: json, body: JSON.stringify({ status: 'resolved' }) })
    expect(resolved.status).toBe(200)
    const bad = await fetch(`${base}/api/comments/${comment.id}/status`, { method: 'POST', headers: json, body: JSON.stringify({ status: 'addressed' }) })
    expect(bad.status).toBe(409)
    const crossSite = await fetch(`${base}/api/drafts/${draftId}/comments`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
    expect(crossSite.status).toBe(415)
    const list = await (await fetch(`${base}/api/projects`)).json()
    expect(list[0]).toMatchObject({ slug: 'clip', latestVersion: 1, openCount: 0 })
  })
})
