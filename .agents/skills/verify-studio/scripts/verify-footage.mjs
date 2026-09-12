import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const baseUrl = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL
const password = process.env.STUDIO_TEST_PASSWORD

if (!email || !password) throw new Error('STUDIO_TEST_EMAIL and STUDIO_TEST_PASSWORD are required')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function localDatabase() {
  const state = resolve('apps/studio/.wrangler/state')
  const files = readdirSync(state, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
    .map((entry) => resolve(entry.parentPath, entry.name))
  for (const file of files) {
    const database = new DatabaseSync(file)
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'upload_session'").get()) return database
    database.close()
  }
  throw new Error('Local Studio D1 database was not found')
}

async function json(response) {
  const body = await response.json()
  assert(response.ok, body.error ?? `HTTP ${response.status}`)
  return body
}

async function ensureAccount(database) {
  if (!database.prepare('SELECT 1 FROM user WHERE email = ?').get(email)) {
    const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ name: 'Studio verification', email, password }),
    })
    assert(signup.ok, `Sign up returned ${signup.status}`)
    const delivery = database.prepare(
      'SELECT body FROM email_outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1',
    ).get(email)
    const verificationUrl = delivery?.body.match(/https?:\/\/\S+/)?.[0]
    assert(verificationUrl, 'Verification email was not captured')
    const verification = await fetch(verificationUrl, { redirect: 'manual' })
    assert(verification.status >= 200 && verification.status < 400, `Verification returned ${verification.status}`)
  }
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ email, password }),
  })
  assert(response.ok, `Sign in returned ${response.status}`)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  assert(cookie, 'Sign in returned no session cookie')
  return cookie
}

async function serverFunctionIds() {
  const response = await fetch(`${baseUrl}/src/server/videos.functions.ts?tss-serverfn-split`)
  assert(response.ok, `Server function manifest returned ${response.status}`)
  const source = await response.text()
  return Object.fromEntries(
    [...source.matchAll(/id: "([^"]+)",\n\s*name: "([^"]+)"/g)].map((match) => [match[2], match[1]]),
  )
}

async function callServerFunction(ids, cookie, name, data) {
  const response = await fetch(`${baseUrl}/_serverFn/${ids[name]}`, {
    method: 'POST',
    headers: { Origin: baseUrl, 'Content-Type': 'application/json', 'x-tsr-serverfn': 'true', Cookie: cookie },
    body: JSON.stringify(await toJSONAsync({ data })),
  })
  assert(response.ok, `${name} returned ${response.status}`)
  return response.text()
}

async function createVideo(database, ids, cookie, title) {
  await callServerFunction(ids, cookie, 'createVideo', {
    title,
    production: { format: 'long', promotion: 'organic' },
    publishDate: null,
    script: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  const row = database.prepare('SELECT id, revision FROM video WHERE title = ?').get(title)
  assert(row, `Video ${title} was not created`)
  return row
}

function requestHeaders(cookie, extra = {}) {
  return { Cookie: cookie, Origin: baseUrl, ...extra }
}

async function begin(cookie, videoId, clientRequestId, name, bytes, contentType = 'video/mp4') {
  return json(await fetch(`${baseUrl}/api/videos/${videoId}/uploads`, {
    method: 'POST',
    headers: requestHeaders(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ clientRequestId, displayName: name, byteSize: bytes.length, contentType }),
  }))
}

async function sendParts(cookie, videoId, upload, bytes, repeatFirst = false) {
  const numbers = Array.from({ length: upload.partCount }, (_, index) => index + 1)
  const send = async (part) => {
    const start = (part - 1) * upload.partSize
    const body = bytes.subarray(start, Math.min(bytes.length, start + upload.partSize))
    const response = await fetch(`${baseUrl}/api/videos/${videoId}/uploads/${upload.id}/parts/${part}`, {
      method: 'PUT',
      headers: requestHeaders(cookie, { 'Content-Length': String(body.length) }),
      body,
    })
    assert(response.ok, `Part ${part} returned ${response.status}`)
  }
  let cursor = 0
  const worker = async () => {
    while (cursor < numbers.length) {
      const part = numbers[cursor++]
      if (part) await send(part)
    }
  }
  await Promise.all([worker(), worker()])
  if (repeatFirst) await send(1)
}

async function upload(cookie, videoId, clientRequestId, name, bytes) {
  const upload = await begin(cookie, videoId, clientRequestId, name, bytes)
  await sendParts(cookie, videoId, upload, bytes)
  return json(await fetch(`${baseUrl}/api/videos/${videoId}/uploads/${upload.id}/complete`, {
    method: 'POST', headers: requestHeaders(cookie),
  }))
}

async function uploadMany(cookie, videoId, fixtures) {
  const results = []
  let cursor = 0
  const worker = async () => {
    while (cursor < fixtures.length) {
      const fixture = fixtures[cursor++]
      if (fixture) results.push(await upload(cookie, videoId, crypto.randomUUID(), fixture.name, fixture.bytes))
    }
  }
  await Promise.all([worker(), worker()])
  return results
}

const run = `STUDIO-03 ${Date.now()}`
const database = localDatabase()
const cookie = await ensureAccount(database)
const ids = await serverFunctionIds()
const owner = await createVideo(database, ids, cookie, `${run} footage`)
const other = await createVideo(database, ids, cookie, `${run} isolation`)

const multipartBytes = Buffer.alloc(34 * 1024 * 1024 + 37, 0x3a)
const requestId = crypto.randomUUID()
const first = await begin(cookie, owner.id, requestId, 'camera-a.mp4', multipartBytes)
const duplicate = await begin(cookie, owner.id, requestId, 'camera-a.mp4', multipartBytes)
assert(first.id === duplicate.id && first.fileId === duplicate.fileId, 'Duplicate begin changed upload identity')
await sendParts(cookie, owner.id, first, multipartBytes, true)
let completed = await json(await fetch(`${baseUrl}/api/videos/${owner.id}/uploads/${first.id}/complete`, {
  method: 'POST', headers: requestHeaders(cookie),
}))
assert(completed.state === 'ready' && completed.file, 'Multipart upload did not become ready')
assert(!JSON.stringify(completed).match(/object_key|r2_upload_id|initializer_token|etag/i), 'Private R2 state leaked')

const storedBefore = database.prepare(
  'SELECT object_key, object_etag FROM media_file WHERE id = ?',
).get(completed.file.id)
database.prepare('DELETE FROM media_file WHERE id = ?').run(completed.file.id)
database.prepare("UPDATE upload_session SET state = 'completing', object_etag = NULL, completed_at = NULL, updated_at = 0 WHERE id = ?").run(first.id)
completed = await json(await fetch(`${baseUrl}/api/videos/${owner.id}/uploads/${first.id}/complete`, {
  method: 'POST', headers: requestHeaders(cookie),
}))
assert(completed.state === 'ready', 'R2-complete D1 retry did not recover')

const sourceHash = createHash('sha256').update(multipartBytes).digest('hex')
const download = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${completed.file.id}?download=1`, {
  headers: { Cookie: cookie },
})
assert(download.ok, `Download returned ${download.status}`)
const downloadedHash = createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex')
assert(downloadedHash === sourceHash, 'Downloaded bytes differ from the source')

const range = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${completed.file.id}`, {
  headers: { Cookie: cookie, Range: 'bytes=33554420-33554450' },
})
assert(range.status === 206, `Range returned ${range.status}`)
assert(range.headers.get('content-range') === `bytes 33554420-33554450/${multipartBytes.length}`, 'Range header is incorrect')
assert(Buffer.from(await range.arrayBuffer()).equals(multipartBytes.subarray(33554420, 33554451)), 'Range bytes differ')

const renamed = await json(await fetch(`${baseUrl}/api/videos/${owner.id}/media/${completed.file.id}`, {
  method: 'PATCH',
  headers: requestHeaders(cookie, { 'Content-Type': 'application/json' }),
  body: JSON.stringify({ displayName: 'camera-a-renamed.mp4' }),
}))
assert(renamed.displayName === 'camera-a-renamed.mp4', 'Rename did not persist')
const storedAfter = database.prepare('SELECT object_key, object_etag FROM media_file WHERE id = ?').get(completed.file.id)
assert(storedAfter.object_key === storedBefore.object_key && storedAfter.object_etag === storedBefore.object_etag, 'Rename changed object identity')

const crossOrigin = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${completed.file.id}`, {
  method: 'PATCH',
  headers: { Cookie: cookie, Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
  body: JSON.stringify({ displayName: 'attacker-name.mp4' }),
})
assert(crossOrigin.status === 403, `Cross-origin mutation returned ${crossOrigin.status}`)

const isolated = await fetch(`${baseUrl}/api/videos/${other.id}/media/${completed.file.id}`, { headers: { Cookie: cookie } })
assert(isolated.status === 404, `Cross-task media request returned ${isolated.status}`)

const cancelledBytes = Buffer.alloc(34 * 1024 * 1024, 0x5c)
const cancelled = await begin(cookie, owner.id, crypto.randomUUID(), 'cancelled.mp4', cancelledBytes)
const firstPart = cancelledBytes.subarray(0, cancelled.partSize)
await fetch(`${baseUrl}/api/videos/${owner.id}/uploads/${cancelled.id}/parts/1`, {
  method: 'PUT', headers: requestHeaders(cookie, { 'Content-Length': String(firstPart.length) }), body: firstPart,
})
const cancelResult = await json(await fetch(`${baseUrl}/api/videos/${owner.id}/uploads/${cancelled.id}`, {
  method: 'DELETE', headers: requestHeaders(cookie),
}))
assert(cancelResult.state === 'cancelled', 'Cancel did not reach its terminal state')

const parallelBytes = [0x11, 0x22, 0x33].map((byte) => Buffer.alloc(6 * 1024 * 1024, byte))
const parallelStarted = performance.now()
const parallel = await uploadMany(cookie, owner.id, parallelBytes.map((bytes, index) => ({
  name: `parallel-${index + 1}.bin`, bytes,
})))
assert(parallel.every((item) => item.state === 'ready'), 'Parallel uploads did not all become ready')
const parallelMs = performance.now() - parallelStarted

const performanceRows = []
if (process.env.STUDIO_FOOTAGE_PERF === '1') {
  for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
    const singleBytes = Buffer.alloc(256 * 1024 * 1024, runIndex)
    const singleStarted = performance.now()
    await upload(cookie, owner.id, crypto.randomUUID(), `single-${runIndex}.bin`, singleBytes)
    const singleMs = performance.now() - singleStarted

    const batch = [1, 2, 3].map((offset) => ({
      name: `batch-${runIndex}-${offset}.bin`,
      bytes: Buffer.alloc(64 * 1024 * 1024, runIndex + offset),
    }))
    const batchStarted = performance.now()
    await uploadMany(cookie, owner.id, batch)
    const batchMs = performance.now() - batchStarted
    performanceRows.push({
      run: runIndex,
      singleMiBPerSecond: 256 / (singleMs / 1000),
      parallelMiBPerSecond: 192 / (batchMs / 1000),
    })
  }

  const rangeStarted = performance.now()
  const firstByte = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${completed.file.id}`, {
    headers: { Cookie: cookie, Range: 'bytes=0-0' },
  })
  const firstRangeByteMs = performance.now() - rangeStarted
  assert(firstByte.status === 206 && (await firstByte.arrayBuffer()).byteLength === 1, 'First range byte failed')
  const single = performanceRows.reduce((sum, row) => sum + row.singleMiBPerSecond, 0) / performanceRows.length
  const aggregate = performanceRows.reduce((sum, row) => sum + row.parallelMiBPerSecond, 0) / performanceRows.length
  const ratio = aggregate / single
  assert(ratio >= 0.8, `Parallel throughput ratio ${ratio.toFixed(3)} is below 0.8`)
  assert(firstRangeByteMs <= 750, `First range byte took ${firstRangeByteMs.toFixed(1)} ms`)
  console.log(`performance_runs=${performanceRows.map((row) => `${row.run}:${row.singleMiBPerSecond.toFixed(1)}/${row.parallelMiBPerSecond.toFixed(1)}`).join(',')}`)
  console.log(`parallel_single_ratio=${ratio.toFixed(3)} first_range_byte_ms=${firstRangeByteMs.toFixed(1)}`)
}

await callServerFunction(ids, cookie, 'removeVideo', { id: owner.id, expectedRevision: owner.revision })
const hidden = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${completed.file.id}`, { headers: { Cookie: cookie } })
assert(hidden.status === 404, `Tombstoned media returned ${hidden.status}`)
const scheduled = await fetch(`${baseUrl}/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*`)
assert(scheduled.ok, `Scheduled cleanup returned ${scheduled.status}`)
await new Promise((resolve) => setTimeout(resolve, 300))
assert(!database.prepare('SELECT 1 FROM video WHERE id = ?').get(owner.id), 'Scheduled cleanup retained the video')
assert(!database.prepare('SELECT 1 FROM media_file WHERE video_id = ?').get(owner.id), 'Scheduled cleanup retained media rows')

await callServerFunction(ids, cookie, 'removeVideo', { id: other.id, expectedRevision: other.revision })
await fetch(`${baseUrl}/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*`)

console.log(`run=${run}`)
console.log('duplicate_begin=same_session duplicate_part=accepted')
console.log('completion_recovery=ready private_r2_state=hidden')
console.log(`download_sha256=${sourceHash} range_status=206`)
console.log('rename_preserved_object=true cross_origin_status=403 cross_task_status=404 cancel_state=cancelled')
console.log(`parallel_files=3 parallel_elapsed_ms=${parallelMs.toFixed(1)}`)
console.log('tombstone_hidden=true scheduled_cleanup=true')

database.close()
