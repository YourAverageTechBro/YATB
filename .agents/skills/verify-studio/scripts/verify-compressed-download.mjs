import { mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { toJSONAsync } from 'seroval'

const baseUrl = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL ?? 'studio-compressed-verify@example.com'
const password = process.env.STUDIO_TEST_PASSWORD ?? 'studio-compressed-verify-password-32'
const artifactDir = resolve(process.env.STUDIO_EVIDENCE_DIR ?? 'artifacts/studio/28')
const root = resolve(process.cwd())

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readIfFailed(response, ok) {
  if (ok) return ''
  return `: ${await response.text()}`
}

function sqliteFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
    .map((entry) => resolve(entry.parentPath, entry.name))
}

function studioDatabase() {
  const state = resolve(root, 'apps/studio/.wrangler/state')
  for (const file of sqliteFiles(state)) {
    const candidate = new DatabaseSync(file)
    const ok = candidate.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'media_derivative'").get()
    if (ok) return candidate
    candidate.close()
  }
  throw new Error('Local Studio D1 database was not found')
}

async function headersOf(response) {
  return Object.fromEntries(response.headers.entries())
}

async function record(response, extra = {}) {
  const contentType = response.headers.get('content-type') ?? ''
  const text = contentType.includes('video/') || contentType.includes('octet-stream')
    ? undefined
    : await response.clone().text()
  return {
    status: response.status,
    ok: response.ok,
    headers: await headersOf(response),
    body: text?.slice(0, 500) ?? null,
    byteLength: Number(response.headers.get('content-length') ?? 0) || (text ? Buffer.byteLength(text) : null),
    ...extra,
  }
}

const db = studioDatabase()
if (!db.prepare('SELECT 1 FROM allowed_email WHERE email = ?').get(email)) {
  db.prepare('INSERT INTO allowed_email (email) VALUES (?)').run(email)
}

if (!db.prepare('SELECT 1 FROM user WHERE email = ?').get(email)) {
  const signup = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Compressed download verification', email, password }),
  })
  assert(signup.ok, `Signup returned ${signup.status}${await readIfFailed(signup, signup.ok)}`)
  const delivery = db.prepare('SELECT body FROM email_outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1').get(email)
  const verifyUrl = delivery?.body.match(/https?:\/\/\S+/)?.[0]
  assert(verifyUrl, 'Verification link was not captured')
  const verification = await fetch(verifyUrl, { redirect: 'manual' })
  assert(verification.status >= 200 && verification.status < 400, `Verification returned ${verification.status}`)
}

const login = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
assert(login.ok, `Sign-in returned ${login.status}${await readIfFailed(login, login.ok)}`)
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
assert(cookie, 'Sign-in returned no session cookie')

async function functionIds(fileName) {
  const response = await fetch(`${baseUrl}/src/server/${fileName}.ts?tss-serverfn-split`)
  assert(response.ok, `Function manifest ${fileName} returned ${response.status}`)
  const source = await response.text()
  return Object.fromEntries([...source.matchAll(/id: "([^"]+)",\n\s*name: "([^"]+)"/g)].map((match) => [match[2], match[1]]))
}

const videoIds = await functionIds('videos.functions')
const reviewIds = await functionIds('reviews.functions')

async function call(ids, name, data) {
  const response = await fetch(`${baseUrl}/_serverFn/${ids[name]}`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'x-tsr-serverfn': 'true',
    },
    body: JSON.stringify(await toJSONAsync({ data })),
  })
  const text = await response.text()
  assert(response.ok, `${name} returned HTTP ${response.status}: ${text.slice(0, 300)}`)
  return text
}

const title = `Compressed download proof ${Date.now()}`
await call(videoIds, 'createVideo', {
  title,
  production: { format: 'short', promotion: 'organic' },
  publishDate: null,
  script: { type: 'doc', content: [{ type: 'paragraph' }] },
})
const video = db.prepare('SELECT id, revision FROM video WHERE title = ?').get(title)
assert(video, 'Created video not found')

const fixturePath = resolve(root, 'artifacts/studio/28/fixture.mp4')
mkdirSync(artifactDir, { recursive: true })
const ffmpeg = spawnSync('ffmpeg', [
  '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-t', '1', fixturePath,
], { encoding: 'utf8' })
assert(ffmpeg.status === 0, `ffmpeg fixture failed: ${ffmpeg.stderr}`)
const bytes = readFileSync(fixturePath)

const begin = await fetch(`${baseUrl}/api/videos/${video.id}/uploads`, {
  method: 'POST',
  headers: { Cookie: cookie, Origin: baseUrl, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    clientRequestId: crypto.randomUUID(),
    displayName: 'proof-draft.mp4',
    byteSize: bytes.length,
    contentType: 'video/mp4',
    purpose: { kind: 'draft', durationMs: 1000 },
  }),
})
assert(begin.ok, `Begin upload returned ${begin.status}${await readIfFailed(begin, begin.ok)}`)
const snapshot = await begin.json()
for (let part = 1; part <= snapshot.partCount; part += 1) {
  const start = (part - 1) * snapshot.partSize
  const body = bytes.subarray(start, Math.min(bytes.length, start + snapshot.partSize))
  const response = await fetch(`${baseUrl}/api/videos/${video.id}/uploads/${snapshot.id}/parts/${part}`, {
    method: 'PUT',
    headers: { Cookie: cookie, Origin: baseUrl, 'Content-Length': String(body.length) },
    body,
  })
  assert(response.ok, `Part ${part} returned ${response.status}`)
}
const complete = await fetch(`${baseUrl}/api/videos/${video.id}/uploads/${snapshot.id}/complete`, {
  method: 'POST',
  headers: { Cookie: cookie, Origin: baseUrl },
})
assert(complete.ok, `Complete returned ${complete.status}${await readIfFailed(complete, complete.ok)}`)
const published = await complete.json()
assert(published.result.kind === 'draft', 'Upload did not publish a draft')
const fileId = published.result.file.id
const compressedUrl = `${baseUrl}/api/videos/${video.id}/media/${fileId}?download=compressed`

const derivative = db.prepare(
  `SELECT id, state, object_key, source_media_file_id FROM media_derivative WHERE source_media_file_id = ?`,
).get(fileId)
assert(derivative, 'Derivative row was not created')
const source = db.prepare('SELECT object_key, byte_size FROM media_file WHERE id = ?').get(fileId)
const observedAfterUpload = derivative.state
db.prepare(
  `UPDATE media_derivative
   SET state = 'processing', byte_size = NULL, content_type = NULL, object_etag = NULL,
       lease_until = ?, last_error = NULL, updated_at = ?
   WHERE id = ?`,
).run(Date.now() + 60 * 60 * 1000, Date.now(), derivative.id)
derivative.state = 'processing'

const processingHead = await fetch(compressedUrl, { method: 'HEAD', headers: { Cookie: cookie } })
const processingGetJson = await fetch(compressedUrl, {
  headers: { Cookie: cookie, Accept: 'application/json' },
})
const processingGetHtml = await fetch(compressedUrl, {
  headers: { Cookie: cookie, Accept: 'text/html' },
})
const processingGetNavigate = await fetch(compressedUrl, {
  headers: { Cookie: cookie, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
})
const signedOut = await fetch(compressedUrl)

const processingEvidence = {
  observedStateAfterUpload: observedAfterUpload,
  derivativeState: derivative.state,
  head: await record(processingHead),
  getJson: await record(processingGetJson),
  getHtml: await record(processingGetHtml),
  getBrowserAccept: await record(processingGetNavigate),
  signedOut: await record(signedOut),
  responseOkWouldTreat202AsSuccess: processingHead.ok === true && processingHead.status === 202,
}

assert(processingHead.status === 202, `Processing HEAD returned ${processingHead.status}`)
assert(processingGetJson.status === 202, `Processing JSON GET returned ${processingGetJson.status}`)
assert((await processingGetJson.clone().json()).state !== 'ready', 'Processing JSON claimed ready')
assert(processingGetHtml.status === 202, `Processing HTML GET returned ${processingGetHtml.status}`)
assert((processingGetHtml.headers.get('content-type') ?? '').includes('text/html'), 'Processing HTML GET was not HTML')
assert(!(await processingGetHtml.clone().text()).includes('{"state"'), 'Processing HTML GET still returned raw JSON')
assert((await processingGetNavigate.clone().text()).includes('still being prepared'), 'Browser GET omitted preparing copy')
assert(signedOut.status === 401, `Signed-out compressed download returned ${signedOut.status}`)

const sourceDump = resolve(artifactDir, 'source.mp4')
const getSource = spawnSync('npx', [
  'wrangler', 'r2', 'object', 'get', `yatb-studio-media/${source.object_key}`,
  '--file', sourceDump, '--local',
], { encoding: 'utf8', cwd: resolve(root, 'apps/studio') })
assert(getSource.status === 0, `Local R2 get failed: ${getSource.stderr || getSource.stdout}`)
const putDerivative = spawnSync('npx', [
  'wrangler', 'r2', 'object', 'put', `yatb-studio-media/${derivative.object_key}`,
  '--file', sourceDump, '--content-type', 'video/mp4', '--local',
], { encoding: 'utf8', cwd: resolve(root, 'apps/studio') })
assert(putDerivative.status === 0, `Local R2 put failed: ${putDerivative.stderr || putDerivative.stdout}`)
const compactBytes = readFileSync(sourceDump)
const now = Date.now()
db.prepare(
  `UPDATE media_derivative
   SET state = 'ready', byte_size = ?, content_type = 'video/mp4', object_etag = ?, lease_until = NULL, last_error = NULL, updated_at = ?
   WHERE id = ?`,
).run(compactBytes.length, 'verify-etag', now, derivative.id)

const readyHead = await fetch(compressedUrl, { method: 'HEAD', headers: { Cookie: cookie } })
const readyGet = await fetch(compressedUrl, { headers: { Cookie: cookie, Accept: '*/*' } })
const readyBody = Buffer.from(await readyGet.arrayBuffer())
const readyEvidence = {
  head: await record(readyHead),
  get: {
    status: readyGet.status,
    ok: readyGet.ok,
    headers: await headersOf(readyGet),
    byteLength: readyBody.length,
    matchesSource: readyBody.equals(compactBytes),
  },
}

assert(readyHead.status === 200, `Ready HEAD returned ${readyHead.status}`)
assert(readyGet.status === 200, `Ready GET returned ${readyGet.status}`)
assert((readyGet.headers.get('content-disposition') ?? '').startsWith('attachment;'), 'Ready GET was not an attachment')
assert((readyGet.headers.get('content-disposition') ?? '').includes('smaller.mp4'), 'Ready GET filename omitted smaller.mp4')
assert((readyGet.headers.get('content-type') ?? '').includes('video/mp4'), 'Ready GET was not video/mp4')
assert(readyBody.equals(compactBytes), 'Ready GET bytes did not match the compact object')

const prodUrl = 'https://studio.youraveragetechbro.com/api/videos/934c3718-427c-40e8-80e8-bb5318ca0e28/media/493975af-5734-408a-b8b3-f7bd61186a57?download=compressed'
const prodHead = await fetch(prodUrl, { method: 'HEAD' })
const prodGet = await fetch(prodUrl, { headers: { Accept: 'text/html,application/xhtml+xml' } })
const prodEvidence = {
  url: prodUrl,
  head: await record(prodHead),
  get: await record(prodGet),
  note: 'No Studio session cookie in this environment; this is the signed-out prod boundary only.',
}

writeFileSync(resolve(artifactDir, 'compressed-download-evidence.json'), JSON.stringify({
  localUrl: compressedUrl,
  videoId: video.id,
  fileId,
  processing: processingEvidence,
  ready: readyEvidence,
  prodUnsigned: prodEvidence,
  wrangler: { authenticated: false, attempted: 'local D1/R2 only' },
}, null, 2))

if (process.env.STUDIO_KEEP_FIXTURES === '1') {
  db.close()
  console.log(`kept_video_id=${video.id}`)
  console.log(`kept_file_id=${fileId}`)
} else {
  const videoRow = db.prepare('SELECT revision FROM video WHERE id = ?').get(video.id)
  await call(videoIds, 'removeVideo', { id: video.id, expectedRevision: videoRow.revision })
  db.close()
}

console.log(`evidence_dir=${artifactDir}`)
console.log(`processing_head=${processingHead.status} processing_json=${processingGetJson.status} processing_html=${processingGetHtml.status}`)
console.log(`ready_head=${readyHead.status} ready_get=${readyGet.status} attachment=${readyGet.headers.get('content-disposition')}`)
console.log(`prod_unsigned_head=${prodHead.status} prod_unsigned_get=${prodGet.status}`)
console.log('compressed_download_proof=pass')
