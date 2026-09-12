import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const baseUrl = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL
const password = process.env.STUDIO_TEST_PASSWORD
const fixturePath = process.env.STUDIO_REVIEW_FIXTURE

if (!email || !password || !fixturePath) {
  throw new Error('STUDIO_TEST_EMAIL, STUDIO_TEST_PASSWORD, and STUDIO_REVIEW_FIXTURE are required')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function localDatabase() {
  const files = readdirSync(resolve('apps/studio/.wrangler/state'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
    .map((entry) => resolve(entry.parentPath, entry.name))
  for (const file of files) {
    const database = new DatabaseSync(file)
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'draft'").get()) return database
    database.close()
  }
  throw new Error('Local Studio D1 database was not found')
}

async function signIn() {
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

async function serverFunctionIds(source) {
  const response = await fetch(`${baseUrl}/src/server/${source}.functions.ts`)
  assert(response.ok, `${source} server function manifest returned ${response.status}`)
  const body = await response.text()
  return Object.fromEntries(
    [...body.matchAll(/export const (\w+) = createServerFn[\s\S]*?createClientRpc\("([^"]+)"\)/g)]
      .map((match) => [match[1], match[2]]),
  )
}

async function call(ids, cookie, name, data, expectedError) {
  assert(ids[name], `Server function ${name} is missing`)
  const method = name.startsWith('load') ? 'GET' : 'POST'
  const payload = JSON.stringify(await toJSONAsync({ data }))
  const url = method === 'GET'
    ? `${baseUrl}/_serverFn/${ids[name]}?payload=${encodeURIComponent(payload)}`
    : `${baseUrl}/_serverFn/${ids[name]}`
  const response = await fetch(url, {
    method,
    headers: { Origin: baseUrl, 'Content-Type': 'application/json', 'x-tsr-serverfn': 'true', Cookie: cookie },
    body: method === 'POST' ? payload : undefined,
  })
  const body = await response.text()
  assert(response.ok, `${name} returned HTTP ${response.status}`)
  if (expectedError) assert(body.includes(expectedError), `${name} did not return ${expectedError}`)
  return body
}

async function timedCall(ids, cookie, name, data) {
  const started = performance.now()
  await call(ids, cookie, name, data)
  return performance.now() - started
}

function p95(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

async function upload(cookie, videoId, bytes, purpose, name, contentType) {
  const base = `${baseUrl}/api/videos/${videoId}/uploads`
  const begin = await fetch(base, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRequestId: crypto.randomUUID(), displayName: name, byteSize: bytes.length, contentType, purpose,
    }),
  })
  if (!begin.ok) throw new Error(`Begin upload returned ${begin.status}: ${await begin.text()}`)
  const snapshot = await begin.json()
  for (let part = 1; part <= snapshot.partCount; part += 1) {
    const start = (part - 1) * snapshot.partSize
    const body = bytes.subarray(start, Math.min(bytes.length, start + snapshot.partSize))
    const response = await fetch(`${base}/${snapshot.id}/parts/${part}`, {
      method: 'PUT', headers: { Cookie: cookie, Origin: baseUrl, 'Content-Length': String(body.length) }, body,
    })
    assert(response.ok, `Part ${part} returned ${response.status}`)
  }
  const completeUrl = `${base}/${snapshot.id}/complete`
  const complete = await fetch(completeUrl, { method: 'POST', headers: { Cookie: cookie, Origin: baseUrl } })
  if (!complete.ok) throw new Error(`Complete returned ${complete.status}: ${await complete.text()}`)
  const ready = await complete.json()
  const replay = await fetch(completeUrl, { method: 'POST', headers: { Cookie: cookie, Origin: baseUrl } })
  assert(replay.ok, `Completion replay returned ${replay.status}`)
  const replayed = await replay.json()
  assert(JSON.stringify(replayed.result) === JSON.stringify(ready.result), 'Completion replay changed the published result')
  return ready.result
}

const cookie = await signIn()
const database = localDatabase()
const videoIds = await serverFunctionIds('videos')
const reviewIds = await serverFunctionIds('reviews')
const run = `STUDIO-06 ${Date.now()}`
const empty = { type: 'doc', content: [{ type: 'paragraph' }] }

for (const title of [`${run} review`, `${run} isolation`]) {
  await call(videoIds, cookie, 'createVideo', {
    title, production: { format: 'long', promotion: 'organic' }, publishDate: null, script: empty,
  })
}
const [owner, other] = database.prepare('SELECT id, title, revision FROM video WHERE title LIKE ? ORDER BY title DESC').all(`${run}%`)
assert(owner && other, 'Review fixture videos were not created')
const fixture = readFileSync(resolve(fixturePath))
const drafts = await Promise.all([1, 2, 3].map((version) => upload(
  cookie, owner.id, fixture, { kind: 'draft', durationMs: 2000 }, `draft-${version}.mp4`, 'video/mp4',
)))
assert(drafts.every((result) => result.kind === 'draft'), 'Draft upload returned footage')
const versions = drafts.map((result) => result.draft.version).sort((left, right) => left - right)
assert(JSON.stringify(versions) === '[1,2,3]', `Draft versions were ${versions.join(',')}`)
const newestDrafts = [...drafts].sort((left, right) => right.draft.version - left.draft.version)
for (const { draft } of drafts) {
  const downloadUrl = `${baseUrl}/api/videos/${owner.id}/media/${draft.file.id}?download=1`
  const download = await fetch(downloadUrl, { headers: { Cookie: cookie } })
  assert(download.status === 200, `Version ${draft.version} download returned ${download.status}`)
  const disposition = download.headers.get('Content-Disposition') ?? ''
  assert(disposition.startsWith('attachment;'), `Version ${draft.version} was not an attachment`)
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1]
  assert(encodedName && decodeURIComponent(encodedName) === draft.file.displayName, `Version ${draft.version} download filename changed`)
  assert(download.headers.get('Content-Length') === String(fixture.length), `Version ${draft.version} download length changed`)
  assert(Buffer.from(await download.arrayBuffer()).equals(fixture), `Version ${draft.version} download bytes changed`)
  const signedOut = await fetch(downloadUrl)
  assert(signedOut.status === 401, `Signed-out version ${draft.version} download returned ${signedOut.status}`)
}
const foreignDraft = await upload(cookie, other.id, fixture, { kind: 'draft', durationMs: 2000 }, 'foreign-draft.mp4', 'video/mp4')
assert(foreignDraft.kind === 'draft', 'Foreign comparison fixture returned footage')

const comparison = await call(reviewIds, cookie, 'loadComparison', { videoId: owner.id })
assert(comparison.includes(newestDrafts[0].draft.id) && comparison.includes(newestDrafts[1].draft.id), 'Default comparison omitted a newest draft')
const reversedComparison = await call(reviewIds, cookie, 'loadComparison', {
  videoId: owner.id, left: drafts[0].draft.id, right: drafts[2].draft.id,
})
assert(reversedComparison.includes(drafts[0].draft.id) && reversedComparison.includes(drafts[2].draft.id), 'Explicit comparison omitted a selected draft')
await call(reviewIds, cookie, 'loadComparison', {
  videoId: owner.id, left: drafts[0].draft.id, right: drafts[0].draft.id,
}, 'Comparison is unavailable.')
await call(reviewIds, cookie, 'loadComparison', {
  videoId: owner.id, left: drafts[0].draft.id, right: foreignDraft.draft.id,
}, 'Comparison is unavailable.')

const attachment = await upload(cookie, owner.id, Buffer.from('review-image'), { kind: 'footage' }, 'reference.png', 'image/png')
assert(attachment.kind === 'footage', 'Attachment upload did not use footage')
const videoAttachment = await upload(cookie, owner.id, fixture, { kind: 'footage' }, 'reference.mp4', 'video/mp4')
assert(videoAttachment.kind === 'footage', 'Video attachment upload did not use footage')
const crossTaskAttachment = await upload(cookie, other.id, Buffer.from('other-task-image'), { kind: 'footage' }, 'other.png', 'image/png')
assert(crossTaskAttachment.kind === 'footage', 'Cross-task fixture upload did not use footage')
const selectedDraft = drafts[0].draft
const rich = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Trim this beat', marks: [{ type: 'bold' }] }] }],
}
const pointRequestId = crypto.randomUUID()
const pointInput = {
  clientRequestId: pointRequestId,
  videoId: owner.id, draftId: selectedDraft.id, anchor: { kind: 'point', atMs: 750 }, body: rich,
  attachmentIds: [attachment.file.id, videoAttachment.file.id],
}
await call(reviewIds, cookie, 'addComment', pointInput)
await call(reviewIds, cookie, 'addComment', pointInput)
await call(reviewIds, cookie, 'addComment', {
  clientRequestId: crypto.randomUUID(),
  videoId: owner.id, draftId: selectedDraft.id, anchor: { kind: 'range', startMs: 1000, endMs: 1500 }, body: rich,
  attachmentIds: [],
})
await call(reviewIds, cookie, 'addComment', {
  clientRequestId: crypto.randomUUID(),
  videoId: owner.id, draftId: selectedDraft.id, anchor: { kind: 'point', atMs: 2001 }, body: rich,
  attachmentIds: [],
}, 'exceeds the draft duration')
await call(reviewIds, cookie, 'addComment', {
  clientRequestId: crypto.randomUUID(),
  videoId: owner.id, draftId: selectedDraft.id, anchor: { kind: 'point', atMs: 1000 }, body: rich,
  attachmentIds: [drafts[1].file.id],
}, 'footage from this video')
await call(reviewIds, cookie, 'addComment', {
  clientRequestId: crypto.randomUUID(),
  videoId: owner.id, draftId: selectedDraft.id, anchor: { kind: 'point', atMs: 1000 }, body: rich,
  attachmentIds: [crossTaskAttachment.file.id],
}, 'footage from this video')

const comments = database.prepare('SELECT id, anchor_kind, start_ms, end_ms, revision FROM review_comment WHERE video_id = ? ORDER BY start_ms').all(owner.id)
assert(comments.length === 2, `Expected two valid comments, found ${comments.length}`)
const point = comments.find((comment) => comment.anchor_kind === 'point')
await call(reviewIds, cookie, 'saveComment', {
  videoId: owner.id, id: point.id, expectedRevision: point.revision,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated note' }] }] },
})
await call(reviewIds, cookie, 'saveComment', {
  videoId: owner.id, id: point.id, expectedRevision: point.revision, body: rich,
}, 'changed in another session')

const range = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${selectedDraft.file.id}`, {
  headers: { Cookie: cookie, Range: 'bytes=0-31' },
})
assert(range.status === 206 && (await range.arrayBuffer()).byteLength === 32, 'Authenticated draft range playback failed')
const crossTask = await fetch(`${baseUrl}/api/videos/${other.id}/media/${selectedDraft.file.id}`, { headers: { Cookie: cookie } })
assert(crossTask.status === 404, `Cross-task draft playback returned ${crossTask.status}`)
const footage = await fetch(`${baseUrl}/api/videos/${owner.id}/media`, { headers: { Cookie: cookie } }).then((response) => response.json())
assert(footage.some((file) => file.id === attachment.file.id), 'Comment attachment is absent from task footage')
assert(footage.some((file) => file.id === videoAttachment.file.id), 'Comment video attachment is absent from task footage')
assert(!footage.some((file) => drafts.some((draft) => draft.file.id === file.id)), 'Draft leaked into task footage')

if (process.env.STUDIO_REVIEW_PERF === '1') {
  const rangeLoads = []
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now()
    const response = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${selectedDraft.file.id}`, {
      headers: { Cookie: cookie, Range: 'bytes=0-4095' },
    })
    await response.arrayBuffer()
    assert(response.status === 206, `Player range probe returned ${response.status}`)
    rangeLoads.push(performance.now() - started)
  }
  const seeks = []
  for (let index = 0; index < 10; index += 1) {
    const offset = Math.min(fixture.length - 33, index * 997)
    const started = performance.now()
    const response = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${selectedDraft.file.id}`, {
      headers: { Cookie: cookie, Range: `bytes=${offset}-${offset + 31}` },
    })
    await response.arrayBuffer()
    assert(response.status === 206, `Seek probe returned ${response.status}`)
    seeks.push(performance.now() - started)
  }
  const workspaceLoads = []
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now()
    await Promise.all([
      call(reviewIds, cookie, 'loadDrafts', owner.id),
      call(reviewIds, cookie, 'loadComments', { videoId: owner.id, draftId: selectedDraft.id }),
    ])
    workspaceLoads.push(performance.now() - started)
  }
  const comparisonLoads = []
  const leftComparisonSeeks = []
  const rightComparisonSeeks = []
  for (let index = 0; index < 10; index += 1) {
    const started = performance.now()
    await Promise.all([
      call(reviewIds, cookie, 'loadComparison', {
        videoId: owner.id, left: drafts[0].draft.id, right: drafts[1].draft.id,
      }),
      call(reviewIds, cookie, 'loadComments', { videoId: owner.id, draftId: drafts[0].draft.id }),
      call(reviewIds, cookie, 'loadComments', { videoId: owner.id, draftId: drafts[1].draft.id }),
    ])
    comparisonLoads.push(performance.now() - started)

    const offset = Math.min(fixture.length - 33, index * 401)
    const seek = async (draft, samples) => {
      const seekStarted = performance.now()
      const response = await fetch(`${baseUrl}/api/videos/${owner.id}/media/${draft.file.id}`, {
        headers: { Cookie: cookie, Range: `bytes=${offset}-${offset + 31}` },
      })
      await response.arrayBuffer()
      assert(response.status === 206, `Comparison seek returned ${response.status}`)
      samples.push(performance.now() - seekStarted)
    }
    await Promise.all([
      seek(drafts[0].draft, leftComparisonSeeks),
      seek(drafts[1].draft, rightComparisonSeeks),
    ])
  }
  const insert = database.prepare(`INSERT INTO review_comment (
    id, video_id, draft_id, author_user_id, anchor_kind, start_ms, end_ms, body_json, revision, created_at, updated_at
  ) VALUES (?, ?, ?, (SELECT id FROM user WHERE email = ?), 'point', ?, NULL, ?, 1, ?, ?)`)
  database.exec('BEGIN')
  for (let index = 0; index < 500; index += 1) {
    insert.run(crypto.randomUUID(), owner.id, selectedDraft.id, email, index, JSON.stringify(rich), index + 10, index + 10)
  }
  database.exec('COMMIT')
  const comments500Ms = await timedCall(reviewIds, cookie, 'loadComments', { videoId: owner.id, draftId: selectedDraft.id })
  database.prepare('DELETE FROM review_comment WHERE video_id = ? AND created_at BETWEEN 10 AND 509').run(owner.id)
  const playerP95 = p95(rangeLoads)
  const seekP95 = p95(seeks)
  const workspaceP95 = p95(workspaceLoads)
  const comparisonP95 = p95(comparisonLoads)
  const leftComparisonSeekP95 = p95(leftComparisonSeeks)
  const rightComparisonSeekP95 = p95(rightComparisonSeeks)
  assert(playerP95 <= 1500, `Player first-byte p95 ${playerP95.toFixed(1)} ms exceeded 1500 ms`)
  assert(seekP95 <= 1500, `Seek p95 ${seekP95.toFixed(1)} ms exceeded 1500 ms`)
  assert(comments500Ms <= 500, `500 comments loaded in ${comments500Ms.toFixed(1)} ms`)
  assert(comparisonP95 <= workspaceP95 * 2 + 500 && comparisonP95 <= 2500, `Comparison p95 ${comparisonP95.toFixed(1)} ms exceeded its bound`)
  assert(leftComparisonSeekP95 <= 1500 && rightComparisonSeekP95 <= 1500, 'A comparison seek exceeded 1500 ms')
  console.log(`player_range_p95_ms=${playerP95.toFixed(1)} seek_p95_ms=${seekP95.toFixed(1)} workspace_p95_ms=${workspaceP95.toFixed(1)} comparison_p95_ms=${comparisonP95.toFixed(1)} left_comparison_seek_p95_ms=${leftComparisonSeekP95.toFixed(1)} right_comparison_seek_p95_ms=${rightComparisonSeekP95.toFixed(1)} comments_500_ms=${comments500Ms.toFixed(1)}`)
}

if (process.env.STUDIO_KEEP_FIXTURES === '1') {
  database.close()
  console.log(`browser_fixture_video_id=${owner.id}`)
  console.log(`browser_fixture_cleanup=delete video ${owner.id} and ${other.id}, then run the local scheduled handler`)
  process.exit(0)
}

await call(videoIds, cookie, 'removeVideo', { id: owner.id, expectedRevision: owner.revision })
await call(videoIds, cookie, 'removeVideo', { id: other.id, expectedRevision: other.revision })
const scheduled = await fetch(`${baseUrl}/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*`)
assert(scheduled.ok, `Scheduled cleanup returned ${scheduled.status}`)
await new Promise((resolve) => setTimeout(resolve, 300))
assert(!database.prepare('SELECT 1 FROM video WHERE id IN (?, ?)').get(owner.id, other.id), 'Scheduled cleanup retained review fixtures')
database.close()

console.log(`run=${run}`)
console.log(`draft_versions=${versions.join(',')} completion_replay=same_result`)
console.log('draft_downloads=attachment exact_filenames=true exact_bytes=true signed_out_status=401')
console.log('comparison_default=newest_two explicit_pair=preserved identical_and_cross_task=rejected')
console.log('point_ms=750 range_ms=1000-1500 rich_body=persisted author=joined comment_replay=no_duplicate')
console.log('image_and_video_reused_as_footage=true invalid_anchor=rejected invalid_purpose_and_cross_task_attachments=rejected')
console.log('draft_range_status=206 cross_task_status=404 optimistic_comment_conflict=rejected cleanup=complete')
