import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const base = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL
const password = process.env.STUDIO_TEST_PASSWORD
if (!email || !password) throw new Error('STUDIO_TEST_EMAIL and STUDIO_TEST_PASSWORD are required')

function assert(ok, message) { if (!ok) throw new Error(message) }
const state = resolve('apps/studio/.wrangler/state')
const file = readdirSync(state, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
  .map((entry) => resolve(entry.parentPath, entry.name))
  .find((path) => {
    const probe = new DatabaseSync(path)
    const exists = probe.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_file_share'").get()
    probe.close()
    return exists
  })
assert(file, 'Local share database was not found')
const db = new DatabaseSync(file)
const preexisting = Boolean(db.prepare('SELECT 1 FROM user WHERE email = ?').get(email))
const allowed = Boolean(db.prepare('SELECT 1 FROM allowed_email WHERE email = ?').get(email))
if (!allowed) db.prepare('INSERT INTO allowed_email (email) VALUES (?)').run(email)

if (!preexisting) {
  const signup = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'File library verification', email, password }),
  })
  assert(signup.ok, `Signup returned ${signup.status}`)
  const delivery = db.prepare('SELECT body FROM email_outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1').get(email)
  const verifyUrl = delivery?.body.match(/https?:\/\/\S+/)?.[0]
  assert(verifyUrl, 'Verification link was not captured')
  const verification = await fetch(verifyUrl, { redirect: 'manual' })
  assert(verification.status >= 200 && verification.status < 400, `Verification returned ${verification.status}`)
}

const login = await fetch(`${base}/api/auth/sign-in/email`, {
  method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
assert(login.ok, `Sign-in returned ${login.status}`)
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
assert(cookie, 'Sign-in returned no cookie')

async function functionIds(fileName) {
  const response = await fetch(`${base}/src/server/${fileName}.ts?tss-serverfn-split`)
  assert(response.ok, `Function manifest returned ${response.status}`)
  const source = await response.text()
  return Object.fromEntries([...source.matchAll(/id: "([^"]+)",\n\s*name: "([^"]+)"/g)].map((match) => [match[2], match[1]]))
}
const videoIds = await functionIds('videos.functions')
const libraryIds = await functionIds('file-library.functions')

async function call(ids, name, data, origin = base) {
  const response = await fetch(`${base}/_serverFn/${ids[name]}`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'x-tsr-serverfn': 'true' },
    body: JSON.stringify(await toJSONAsync({ data })),
  })
  return response
}

if (process.env.STUDIO_CLEAN_FIXTURE_VIDEO_ID) {
  const fixtureId = process.env.STUDIO_CLEAN_FIXTURE_VIDEO_ID
  const fixture = db.prepare('SELECT revision FROM video WHERE id = ?').get(fixtureId)
  assert(fixture, 'Fixture video was not found')
  assert((await call(videoIds, 'removeVideo', { id: fixtureId, expectedRevision: fixture.revision })).ok, 'Could not remove fixture video')
  db.prepare('UPDATE video SET cleanup_after = 0 WHERE id = ?').run(fixtureId)
  await fetch(`${base}/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*`)
  assert(!db.prepare('SELECT 1 FROM video WHERE id = ?').get(fixtureId), 'Fixture video was not cleaned up')
  const user = db.prepare('SELECT id FROM user WHERE email = ?').get(email)
  db.prepare('DELETE FROM session WHERE "userId" = ?').run(user.id)
  db.prepare('DELETE FROM verification WHERE identifier = ?').run(email)
  db.prepare('DELETE FROM email_outbox WHERE recipient = ?').run(email)
  db.prepare('DELETE FROM user WHERE id = ?').run(user.id)
  db.prepare('DELETE FROM allowed_email WHERE email = ?').run(email)
  console.log('fixture_cleanup=complete')
  db.close()
  process.exit(0)
}

const title = `File library verification ${Date.now()}`
assert((await call(videoIds, 'createVideo', {
  title, production: { format: 'short', promotion: 'organic' }, publishDate: null,
  script: { type: 'doc', content: [{ type: 'paragraph' }] },
})).ok, 'Could not create verification video')
const video = db.prepare('SELECT id, revision FROM video WHERE title = ?').get(title)
assert(video, 'Created video not found')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')
const began = await fetch(`${base}/api/videos/${video.id}/uploads`, {
  method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientRequestId: crypto.randomUUID(), displayName: 'share-proof.png', byteSize: png.length, contentType: 'image/png', purpose: { kind: 'footage' } }),
})
assert(began.ok, `Upload start returned ${began.status}`)
const upload = await began.json()
const part = await fetch(`${base}/api/videos/${video.id}/uploads/${upload.id}/parts/1`, {
  method: 'PUT', headers: { Origin: base, Cookie: cookie, 'Content-Length': String(png.length) }, body: png,
})
assert(part.ok, `Upload part returned ${part.status}`)
const completed = await fetch(`${base}/api/videos/${video.id}/uploads/${upload.id}/complete`, {
  method: 'POST', headers: { Origin: base, Cookie: cookie },
})
assert(completed.ok, `Upload completion returned ${completed.status}`)
const completeBody = await completed.json()
const fileId = completeBody.result.file.id

const library = await fetch(`${base}/files`, { headers: { Cookie: cookie } })
assert(library.ok && (await library.text()).includes('share-proof.png'), 'Library did not render uploaded file')
const denied = await call(libraryIds, 'createSharedFileLink', fileId, 'https://attacker.example')
assert(denied.status === 403, `Cross-origin share mutation returned ${denied.status}`)
const created = await call(libraryIds, 'createSharedFileLink', fileId)
assert(created.ok, `Share creation returned ${created.status}`)
const share = db.prepare('SELECT token FROM media_file_share WHERE media_file_id = ?').get(fileId)
assert(share?.token?.length === 64, 'Share token was not persisted')
const page = await fetch(`${base}/shared-files/${share.token}`)
assert(page.ok && (await page.text()).includes('share-proof.png'), 'Public viewer did not render without a session')
const mediaUrl = `${base}/api/shared-files/${share.token}`
const head = await fetch(mediaUrl, { method: 'HEAD' })
assert(head.status === 200 && head.headers.get('cache-control')?.includes('no-store'), 'Shared HEAD did not return no-store metadata')
const range = await fetch(mediaUrl, { headers: { Range: 'bytes=0-7' } })
assert(range.status === 206 && Buffer.from(await range.arrayBuffer()).equals(png.subarray(0, 8)), 'Shared byte range differs from uploaded file')
assert(range.headers.get('referrer-policy') === 'no-referrer', 'Shared media lacks referrer protection')
if (process.env.STUDIO_KEEP_FIXTURES === '1') {
  console.log(JSON.stringify({ email, videoId: video.id, fileId, shareUrl: `${base}/shared-files/${share.token}` }))
  db.close()
  process.exit(0)
}
const revoked = await call(libraryIds, 'revokeSharedFileLink', fileId)
assert(revoked.ok, `Share revoke returned ${revoked.status}`)
assert((await fetch(mediaUrl)).status === 404, 'Revoked media link still works')
assert((await fetch(`${base}/shared-files/${share.token}`)).status === 404, 'Revoked viewer still works')
assert((await call(libraryIds, 'createSharedFileLink', fileId)).ok, 'Could not create a new link after revocation')
const replacement = db.prepare('SELECT token FROM media_file_share WHERE media_file_id = ?').get(fileId)
assert(replacement?.token !== share.token, 'Revoked link was reused')
const deleted = await call(videoIds, 'removeVideo', { id: video.id, expectedRevision: video.revision })
assert(deleted.ok && (await deleted.text()).includes('deleted'), 'Could not delete verification video')
assert((await fetch(`${base}/api/shared-files/${replacement.token}`)).status === 404, 'Deleted video still exposes shared media')
assert((await fetch(`${base}/shared-files/${replacement.token}`)).status === 404, 'Deleted video still exposes shared viewer')
db.prepare('UPDATE video SET cleanup_after = 0 WHERE id = ? AND deleted_at IS NOT NULL').run(video.id)
await fetch(`${base}/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*`)
assert(!db.prepare('SELECT 1 FROM video WHERE id = ?').get(video.id), 'Scheduled cleanup retained verification video')
if (!preexisting || process.env.STUDIO_CLEAN_TEST_USER === '1') {
  const user = db.prepare('SELECT id FROM user WHERE email = ?').get(email)
  db.prepare('DELETE FROM session WHERE "userId" = ?').run(user.id)
  db.prepare('DELETE FROM verification WHERE identifier = ?').run(email)
  db.prepare('DELETE FROM email_outbox WHERE recipient = ?').run(email)
  db.prepare('DELETE FROM user WHERE id = ?').run(user.id)
}
if (!allowed || process.env.STUDIO_CLEAN_TEST_USER === '1') db.prepare('DELETE FROM allowed_email WHERE email = ?').run(email)
console.log('file_library=visible share_origin=403 viewer=200 head=200 range=206 revoke=404 delete=404')
db.close()
