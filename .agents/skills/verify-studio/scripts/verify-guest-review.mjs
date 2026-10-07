import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const base = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL
const password = process.env.STUDIO_TEST_PASSWORD
if (!email || !password) throw new Error('STUDIO_TEST_EMAIL and STUDIO_TEST_PASSWORD are required')

function assert(ok, message) { if (!ok) throw new Error(message) }

function localDatabase() {
  const files = readdirSync(resolve('apps/studio/.wrangler/state'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
    .map((entry) => resolve(entry.parentPath, entry.name))
  for (const file of files) {
    const database = new DatabaseSync(file)
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='draft_review_share'").get()) return database
    database.close()
  }
  throw new Error('Local Studio D1 database with draft_review_share was not found')
}

function fixtureBytes() {
  if (process.env.STUDIO_REVIEW_FIXTURE) return readFileSync(resolve(process.env.STUDIO_REVIEW_FIXTURE))
  return Buffer.from(
    'AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhlcmZ5AAAA',
    'base64',
  )
}

const db = localDatabase()
const preexisting = Boolean(db.prepare('SELECT 1 FROM user WHERE email = ?').get(email))
const allowed = Boolean(db.prepare('SELECT 1 FROM allowed_email WHERE email = ?').get(email))
if (!allowed) db.prepare('INSERT INTO allowed_email (email) VALUES (?)').run(email)

if (!preexisting) {
  const signup = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Guest review verification', email, password }),
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
const reviewIds = await functionIds('reviews.functions')

async function call(ids, name, data, origin = base, session = cookie) {
  const method = name.startsWith('load') ? 'GET' : 'POST'
  const payload = JSON.stringify(await toJSONAsync({ data }))
  const url = method === 'GET'
    ? `${base}/_serverFn/${ids[name]}?payload=${encodeURIComponent(payload)}`
    : `${base}/_serverFn/${ids[name]}`
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'x-tsr-serverfn': 'true' }
  if (session) headers.Cookie = session
  return fetch(url, { method, headers, body: method === 'POST' ? payload : undefined })
}

async function uploadDraft(bytes, name, durationMs) {
  const began = await fetch(`${base}/api/videos/${video.id}/uploads`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRequestId: crypto.randomUUID(), displayName: name, byteSize: bytes.length,
      contentType: 'video/mp4', purpose: { kind: 'draft', durationMs },
    }),
  })
  if (!began.ok) throw new Error(`Upload start returned ${began.status}: ${await began.text()}`)
  const upload = await began.json()
  const part = await fetch(`${base}/api/videos/${video.id}/uploads/${upload.id}/parts/1`, {
    method: 'PUT', headers: { Origin: base, Cookie: cookie, 'Content-Length': String(bytes.length) }, body: bytes,
  })
  assert(part.ok, `Upload part returned ${part.status}`)
  const completed = await fetch(`${base}/api/videos/${video.id}/uploads/${upload.id}/complete`, {
    method: 'POST', headers: { Origin: base, Cookie: cookie },
  })
  if (!completed.ok) throw new Error(`Upload completion returned ${completed.status}: ${await completed.text()}`)
  const ready = await completed.json()
  return ready.result ?? ready
}

const title = `Guest review verification ${Date.now()}`
assert((await call(videoIds, 'createVideo', {
  title, production: { format: 'short', promotion: 'organic' }, publishDate: null,
  script: { type: 'doc', content: [{ type: 'paragraph' }] },
})).ok, 'Could not create verification video')
const video = db.prepare('SELECT id, revision FROM video WHERE title = ?').get(title)
assert(video, 'Created video not found')

const bytes = fixtureBytes()
const first = await uploadDraft(bytes, 'guest-v1.mp4', 1000)
assert(first.kind === 'draft' && first.draft.version === 1, 'First draft was not version 1')

const denied = await call(reviewIds, 'createDraftReviewLink', { videoId: video.id, draftId: first.draft.id }, 'https://attacker.example')
assert(denied.status === 403, `Cross-origin share mutation returned ${denied.status}`)
const created = await call(reviewIds, 'createDraftReviewLink', { videoId: video.id, draftId: first.draft.id })
assert(created.ok, `Share creation returned ${created.status}`)
const share = db.prepare('SELECT token, draft_id FROM draft_review_share WHERE draft_id = ?').get(first.draft.id)
assert(share?.token?.length === 64, 'Share token was not persisted')
assert(share.draft_id === first.draft.id, 'Share was not pinned to draft v1')

const second = await uploadDraft(bytes, 'guest-v2.mp4', 2000)
assert(second.kind === 'draft' && second.draft.version === 2, 'Second version was not published')
const still = db.prepare('SELECT token, draft_id FROM draft_review_share WHERE token = ?').get(share.token)
assert(still?.draft_id === first.draft.id, 'Uploading v2 moved the existing guest link')

const page = await fetch(`${base}/shared-reviews/${share.token}`)
const pageText = await page.text()
assert(page.ok && pageText.includes('guest-v1.mp4'), 'Guest page did not render the pinned v1 draft')
assert(page.headers.get('referrer-policy') === 'strict-origin', `Guest page Referrer-Policy was ${page.headers.get('referrer-policy')}`)
assert(pageText.includes('Draft version') && pageText.includes('Version 1: guest-v1.mp4'), 'Guest page did not name version 1')
assert(!pageText.includes('guest-v2.mp4'), 'Guest page showed a later draft')
assert(pageText.includes(`data-fallback-src="/api/shared-reviews/${share.token}"`), 'Guest page omitted progressive media fallback')
assert(!/Download (original|smaller|file|version)/.test(pageText), 'Guest page exposed a download control')

const mediaUrl = `${base}/api/shared-reviews/${share.token}`
const media = await fetch(mediaUrl)
assert(media.status === 200, `Guest media returned ${media.status}`)
assert(media.headers.get('referrer-policy') === 'no-referrer', `Guest media Referrer-Policy was ${media.headers.get('referrer-policy')}`)
assert((await media.arrayBuffer()).byteLength === bytes.length, 'Guest media bytes changed')
const download = await fetch(`${mediaUrl}?download=1`)
assert(download.status === 403, `Guest download query returned ${download.status}`)

const guestComment = await call(reviewIds, 'addGuestComment', {
  clientRequestId: crypto.randomUUID(),
  token: share.token,
  parentId: null,
  anchor: { kind: 'point', atMs: 250 },
  text: 'Guest note on v1',
  identity: { email: 'alex.guest@example.com', name: 'Alex Guest' },
}, base, null)
assert(guestComment.ok, `Guest comment returned ${guestComment.status}: ${await guestComment.text()}`)
const stored = db.prepare(
  'SELECT guest_email, guest_name, author_user_id, draft_id FROM review_comment WHERE guest_email = ? AND draft_id = ? ORDER BY created_at DESC',
).get('alex.guest@example.com', first.draft.id)
assert(stored?.author_user_id === null && stored.draft_id === first.draft.id, 'Guest comment was not stored on v1')
assert(stored.guest_name === 'Alex Guest', 'Guest name was not stored')

const studioComments = await call(reviewIds, 'loadComments', { videoId: video.id, draftId: first.draft.id })
const studioBody = await studioComments.text()
assert(studioComments.ok && studioBody.includes('alex.guest@example.com'), 'Studio thread omitted the guest email')

const root = db.prepare('SELECT id FROM review_comment WHERE guest_email = ? AND draft_id = ? AND parent_id IS NULL ORDER BY created_at DESC').get('alex.guest@example.com', first.draft.id)
if (!root?.id) throw new Error('Guest root comment id was not found')
const reply = await call(reviewIds, 'addGuestComment', {
  clientRequestId: crypto.randomUUID(),
  token: share.token,
  parentId: root.id,
  anchor: { kind: 'point', atMs: 250 },
  text: 'Guest reply',
  identity: { email: 'alex.guest@example.com', name: 'Alex Guest' },
}, base, null)
if (!reply.ok) throw new Error(`Guest reply returned ${reply.status}: ${await reply.text()}`)

await call(reviewIds, 'addComment', {
  clientRequestId: crypto.randomUUID(),
  videoId: video.id,
  draftId: first.draft.id,
  parentId: root.id,
  anchor: { kind: 'point', atMs: 250 },
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Studio reply' }] }] },
  attachmentIds: [],
})
const resolved = await call(reviewIds, 'resolveComment', {
  videoId: video.id, id: root.id, expectedRevision: 1,
})
assert(resolved.ok, `Resolve returned ${resolved.status}`)
const guestView = await call(reviewIds, 'loadSharedReview', share.token, base, null)
const guestViewBody = await guestView.text()
assert(guestView.ok && !guestViewBody.includes('Guest note on v1'), 'Resolved guest thread remained visible')

const otherToken = db.prepare('SELECT token FROM media_file_share LIMIT 1').get()?.token
const footage = await fetch(`${base}/api/videos/${video.id}/media/${first.draft.file.id}`)
assert(footage.status === 401, `Unauthenticated draft media returned ${footage.status}`)
const wrongDraft = await fetch(`${base}/api/shared-reviews/${share.token.replace(/a/g, 'b').replace(/b/g, 'a')}`)
assert(wrongDraft.status === 404 || wrongDraft.status === 400, `Unknown guest token returned ${wrongDraft.status}`)
if (otherToken) {
  const fileAsReview = await fetch(`${base}/api/shared-reviews/${otherToken}`)
  assert(fileAsReview.status === 404, `File share token unlocked draft media (${fileAsReview.status})`)
}

const revoked = await call(reviewIds, 'revokeDraftReviewLink', { videoId: video.id, draftId: first.draft.id })
assert(revoked.ok, `Revoke returned ${revoked.status}`)
const revokedPage = await fetch(`${base}/shared-reviews/${share.token}`)
assert((await revokedPage.text()).includes('Link no longer available'), 'Revoked page did not explain unavailability')
const revokedMedia = await fetch(mediaUrl)
assert(revokedMedia.status === 404, `Revoked media returned ${revokedMedia.status}`)
const revokedComment = await call(reviewIds, 'addGuestComment', {
  clientRequestId: crypto.randomUUID(),
  token: share.token,
  parentId: null,
  anchor: { kind: 'point', atMs: 100 },
  text: 'Should fail',
  identity: { email: 'alex.guest@example.com', name: 'Alex Guest' },
}, base, null)
assert(revokedComment.status === 404, `Revoked comment POST returned ${revokedComment.status}`)

if (process.env.STUDIO_KEEP_FIXTURES === '1') {
  const replacement = await call(reviewIds, 'createDraftReviewLink', { videoId: video.id, draftId: first.draft.id })
  assert(replacement.ok, `Could not recreate a guest link for the browser pass: ${replacement.status}`)
  const live = db.prepare('SELECT token FROM draft_review_share WHERE draft_id = ?').get(first.draft.id)
  console.log(JSON.stringify({
    email, videoId: video.id, draftId: first.draft.id, shareToken: live.token,
  }))
  db.close()
  process.exit(0)
}

assert((await call(videoIds, 'removeVideo', { id: video.id, expectedRevision: video.revision })).ok, 'Could not delete verification video')
db.prepare('UPDATE video SET cleanup_after = 0 WHERE id = ? AND deleted_at IS NOT NULL').run(video.id)
await fetch(`${base}/cdn-cgi/local/scheduled?cron=*/15+*+*+*+*`)
if (!preexisting || process.env.STUDIO_CLEAN_TEST_USER === '1') {
  const user = db.prepare('SELECT id FROM user WHERE email = ?').get(email)
  db.prepare('DELETE FROM session WHERE "userId" = ?').run(user.id)
  db.prepare('DELETE FROM verification WHERE identifier = ?').run(email)
  db.prepare('DELETE FROM email_outbox WHERE recipient = ?').run(email)
  db.prepare('DELETE FROM user WHERE id = ?').run(user.id)
}
if (!allowed || process.env.STUDIO_CLEAN_TEST_USER === '1') db.prepare('DELETE FROM allowed_email WHERE email = ?').run(email)

const out = resolve('artifacts/studio/guest-review')
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'verify-guest-review.txt'), [
  'guest_review=ok',
  'pin=v1',
  'origin=403',
  'viewer=200',
  'download=403',
  'referrer_policy=strict-origin',
  'media_referrer_policy=no-referrer',
  'progressive_fallback=ok',
  'guest_comment=ok',
  'resolve_hides=ok',
  'revoke=404',
].join('\n') + '\n')
console.log('guest_review=ok pin=v1 origin=403 viewer=200 download=403 referrer=strict-origin media_referrer=no-referrer fallback=ok comment=ok resolve_hides=ok revoke=404')
db.close()
