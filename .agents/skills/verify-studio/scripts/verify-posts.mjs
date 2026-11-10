import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const base = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL ?? 'posts-proof@youraveragetechbro.com'
const password = process.env.STUDIO_TEST_PASSWORD ?? 'PostsProof-pass-32-characters!!'

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
    const table = candidate.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='post_draft'").get()
    if (table) return candidate
    candidate.close()
  }
  throw new Error('Local Studio D1 database with post_draft was not found')
}

const db = studioDb()
if (!db.prepare('SELECT 1 FROM allowed_email WHERE email = ?').get(email)) {
  db.prepare('INSERT INTO allowed_email (email) VALUES (?)').run(email)
}

const preexisting = Boolean(db.prepare('SELECT 1 FROM user WHERE email = ?').get(email))
if (!preexisting) {
  const signup = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Posts proof', email, password }),
  })
  assert(signup.ok, `Signup returned ${signup.status}`)
  const delivery = db.prepare('SELECT body FROM email_outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1').get(email)
  const verifyUrl = delivery?.body.match(/https?:\/\/\S+/)?.[0]
  assert(verifyUrl, 'Verification link was not captured')
  const verification = await fetch(verifyUrl, { redirect: 'manual' })
  assert(verification.status >= 200 && verification.status < 400, `Verification returned ${verification.status}`)
}

const login = await fetch(`${base}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
assert(login.ok, `Sign-in returned ${login.status}`)
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
assert(cookie, 'Sign-in returned no cookie')

const anonymousMedia = await fetch(`${base}/api/posts/1b0e913b-645c-4306-a71d-78115390b46d/media/28a2b4a2-1ee2-44d8-8e3a-0c2dbd5b2d27`)
assert(anonymousMedia.status === 401, `Anonymous post media returned ${anonymousMedia.status}`)
assert((anonymousMedia.headers.get('cache-control') ?? '').includes('private'), 'Anonymous post media cache-control is not private')

const postsPage = await fetch(`${base}/posts`, { headers: { Cookie: cookie } })
const postsHtml = await postsPage.text()
assert(postsPage.ok, `Posts page returned ${postsPage.status}`)
assert(postsHtml.includes('Posts') && postsHtml.includes('New draft'), 'Posts page did not render the composer list')

const manifest = await fetch(`${base}/src/server/posts.functions.ts?tss-serverfn-split`)
assert(manifest.ok, `Posts function manifest returned ${manifest.status}`)
const ids = Object.fromEntries([... (await manifest.text()).matchAll(/id: "([^"]+)",\n\s*name: "([^"]+)"/g)].map((match) => [match[2], match[1]]))

async function call(name, data) {
  const response = await fetch(`${base}/_serverFn/${ids[name]}`, {
    method: 'POST',
    headers: {
      Origin: base,
      Cookie: cookie,
      'Content-Type': 'application/json',
      'x-tsr-serverfn': 'true',
    },
    body: JSON.stringify(await toJSONAsync(data === undefined ? {} : { data })),
  })
  const body = await response.text()
  assert(response.ok, `${name} returned HTTP ${response.status}: ${body.slice(0, 200)}`)
  return body
}

const createdBody = await call('createPostDraft')
const createdId = createdBody.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0]
assert(createdId, 'createPostDraft did not return an id')

const firstId = db.prepare('SELECT id FROM post WHERE draft_id = ?').get(createdId).id
const secondId = crypto.randomUUID()
await call('savePostDraft', {
  id: createdId,
  expectedRevision: 1,
  target: 'both',
  xPremium: false,
  items: [
    { id: firstId, body: 'First post in the thread https://example.com/long/path', media: [] },
    { id: secondId, body: 'Second post with #one and #two', media: [] },
  ],
})

const stored = db.prepare('SELECT status, target, revision FROM post_draft WHERE id = ?').get(createdId)
assert(stored.status === 'draft', `Autosave left status ${stored.status}`)
assert(stored.target === 'both', 'Target was not both')
const bodies = db.prepare('SELECT body FROM post WHERE draft_id = ? ORDER BY position').all(createdId).map((row) => row.body)
assert(bodies[0]?.includes('First post'), 'First post did not persist')
assert(bodies[1]?.includes('Second post'), 'Second post did not persist')

const over = await call('savePostDraft', {
  id: createdId,
  expectedRevision: stored.revision,
  target: 'both',
  xPremium: false,
  items: [
    { id: firstId, body: 'a'.repeat(281), media: [] },
    { id: secondId, body: 'Second post with #one and #two', media: [] },
  ],
})
assert(over.includes('saved') || over.includes('draft'), 'Over-limit text did not save')
const readyOver = await fetch(`${base}/_serverFn/${ids.markPostReady}`, {
  method: 'POST',
  headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json', 'x-tsr-serverfn': 'true' },
  body: JSON.stringify(await toJSONAsync({ data: { id: createdId, expectedRevision: db.prepare('SELECT revision FROM post_draft WHERE id = ?').get(createdId).revision } })),
})
assert(readyOver.ok, `markPostReady returned ${readyOver.status}`)
const readyOverBody = await readyOver.text()
assert(readyOverBody.includes('invalid'), 'Over-limit draft was marked ready')

await call('savePostDraft', {
  id: createdId,
  expectedRevision: db.prepare('SELECT revision FROM post_draft WHERE id = ?').get(createdId).revision,
  target: 'both',
  xPremium: false,
  items: [
    { id: firstId, body: 'First post in the thread', media: [] },
    { id: secondId, body: 'Second post', media: [] },
  ],
})
await call('markPostReady', {
  id: createdId,
  expectedRevision: db.prepare('SELECT revision FROM post_draft WHERE id = ?').get(createdId).revision,
})
assert(db.prepare('SELECT status FROM post_draft WHERE id = ?').get(createdId).status === 'ready', 'Valid thread was not marked ready')

const composer = await fetch(`${base}/posts/${createdId}`, { headers: { Cookie: cookie } })
const composerHtml = await composer.text()
assert(composer.ok, `Composer returned ${composer.status}`)
assert(composerHtml.includes('X preview') && composerHtml.includes('Threads preview'), 'Composer omitted platform previews')
assert(composerHtml.includes('Premium long post'), 'Composer omitted the Premium toggle')
assert(composerHtml.includes('Mark ready'), 'Composer omitted Mark ready')

console.log(`posts_draft_id=${createdId}`)
console.log('posts_http_proof=pass')
db.close()
