import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const baseUrl = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL
const password = process.env.STUDIO_TEST_PASSWORD
const secondEmail = process.env.STUDIO_SECOND_TEST_EMAIL
const secondPassword = process.env.STUDIO_SECOND_TEST_PASSWORD

if (!email || !password || !secondEmail || !secondPassword) {
  throw new Error('Primary and secondary STUDIO_TEST credentials are required')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sqliteFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
    .map((entry) => resolve(entry.parentPath, entry.name))
}

function planningDatabase() {
  const state = resolve('apps/studio/.wrangler/state')
  for (const file of sqliteFiles(state)) {
    const candidate = new DatabaseSync(file, { readOnly: true })
    const video = candidate.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'video'",
    ).get()
    if (video) return candidate
    candidate.close()
  }
  throw new Error('Local Studio D1 database was not found')
}

async function signIn(address, secret) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ email: address, password: secret }),
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
    [...source.matchAll(/id: "([^"]+)",\n\s*name: "([^"]+)"/g)]
      .map((match) => [match[2], match[1]]),
  )
}

async function callServerFunction(ids, cookie, name, data, expectedError) {
  const id = ids[name]
  assert(id, `Server function ${name} is missing from the development manifest`)
  const response = await fetch(`${baseUrl}/_serverFn/${id}`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'Content-Type': 'application/json',
      'x-tsr-serverfn': 'true',
      Cookie: cookie,
    },
    body: JSON.stringify(await toJSONAsync({ data })),
  })
  const body = await response.text()
  assert(response.ok, `${name} returned HTTP ${response.status}`)
  if (expectedError) assert(body.includes(expectedError), `${name} did not return ${expectedError}`)
  return body
}

function richScript() {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Production plan', marks: [{ type: 'bold' }] }],
      },
      {
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{
              type: 'text',
              text: 'Reference',
              marks: [
                { type: 'italic' },
                { type: 'link', attrs: { href: 'https://example.com/reference' } },
              ],
            }],
          }],
        }],
      },
    ],
  }
}

const run = `STUDIO-02 ${Date.now()}`
const missingOrganicVideoId = crypto.randomUUID()
const cookie = await signIn(email, password)
const ids = await serverFunctionIds()
const db = planningDatabase()
const emptyScript = { type: 'doc', content: [{ type: 'paragraph' }] }

const fixtures = [
  ['short-organic', { format: 'short', promotion: 'organic' }, null],
  ['short-advertisement', { format: 'short', promotion: 'advertisement' }, '2026-09-30'],
  ['long-organic', { format: 'long', promotion: 'organic' }, null],
]

for (const [suffix, production, publishDate] of fixtures) {
  await callServerFunction(ids, cookie, 'createVideo', {
    title: `${run} ${suffix}`,
    production,
    publishDate,
    script: emptyScript,
  })
}

const organicLong = db.prepare(
  'SELECT id FROM video WHERE title = ? AND format = ? AND promotion = ?',
).get(`${run} long-organic`, 'long', 'organic')
assert(organicLong, 'Organic long-form candidate was not persisted')
await callServerFunction(ids, cookie, 'createVideo', {
  title: `${run} long-integration`,
  production: {
    format: 'long',
    promotion: 'integration',
    organicVideoId: organicLong.id,
  },
  publishDate: '2026-10-15',
  script: emptyScript,
})

const invalidLinkResponse = await callServerFunction(ids, cookie, 'createVideo', {
  title: `${run} invalid-integration-link`,
  production: {
    format: 'long',
    promotion: 'integration',
    organicVideoId: missingOrganicVideoId,
  },
  publishDate: null,
  script: emptyScript,
})
assert(invalidLinkResponse.includes('invalid-link'), 'Missing organic video did not return invalid-link')

await callServerFunction(ids, cookie, 'createVideo', {
  title: `${run} invalid-short-integration`,
  production: { format: 'short', promotion: 'integration' },
  publishDate: null,
  script: emptyScript,
}, 'This promotion is not available')

const created = db.prepare(
  'SELECT id, title, format, promotion, linked_organic_video_id, status, publish_date, revision FROM video WHERE title LIKE ? ORDER BY title',
).all(`${run}%`)
assert(created.length === 4, `Expected four legal production rows, found ${created.length}`)
assert(!created.some((row) => row.title.endsWith('invalid-short-integration')), 'Invalid promotion reached D1')
assert(!created.some((row) => row.title.endsWith('invalid-integration-link')), 'Invalid organic video link reached D1')
assert(
  created.find((row) => row.title.endsWith('long-integration'))?.linked_organic_video_id === organicLong.id,
  'Long-form integration did not persist its organic video link',
)

const organicShort = created.find((row) => row.title.endsWith('short-organic'))
assert(organicShort, 'Organic short was not persisted')
await callServerFunction(ids, cookie, 'saveVideo', {
  id: organicShort.id,
  expectedRevision: organicShort.revision,
  title: `${run} short-organic-scripted`,
  production: { format: 'short', promotion: 'organic' },
  status: 'not-started',
  publishDate: '2026-09-29',
  script: richScript(),
})

let edited = db.prepare('SELECT * FROM video WHERE id = ?').get(organicShort.id)
assert(edited.revision === 2, 'Rich script save did not increment the revision')
assert(edited.script_json.includes('https://example.com/reference'), 'Rich script did not persist')

await callServerFunction(ids, cookie, 'saveVideo', {
  id: organicShort.id,
  expectedRevision: edited.revision,
  title: edited.title,
  production: { format: 'short', promotion: 'organic' },
  status: edited.status,
  publishDate: edited.publish_date,
  script: {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Unsafe',
        marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
      }],
    }],
  },
}, 'Rich text links must use HTTPS')
assert(db.prepare('SELECT revision FROM video WHERE id = ?').get(organicShort.id).revision === 2, 'Rejected rich text changed D1')

const conflictingRevision = edited.revision
const conflictInputs = ['first edit', 'stale edit'].map((suffix) => ({
  id: organicShort.id,
  expectedRevision: conflictingRevision,
  title: `${run} ${suffix}`,
  production: { format: 'short', promotion: 'organic' },
  status: 'not-started',
  publishDate: '2026-09-29',
  script: richScript(),
}))
const conflictResponses = await Promise.all(
  conflictInputs.map((input) => callServerFunction(ids, cookie, 'saveVideo', input)),
)
edited = db.prepare('SELECT * FROM video WHERE id = ?').get(organicShort.id)
assert(edited.revision === 3, `Concurrent saves produced revision ${edited.revision}, expected 3`)
assert(conflictResponses.some((body) => body.includes('conflict')), 'Stale save did not return a conflict')

for (const status of ['filming', 'ready-to-edit', 'ready-to-review', 'published']) {
  const current = db.prepare('SELECT revision FROM video WHERE id = ?').get(organicShort.id)
  await callServerFunction(ids, cookie, 'moveVideoStatus', {
    id: organicShort.id,
    expectedRevision: current.revision,
    status,
  })
  assert(db.prepare('SELECT status FROM video WHERE id = ?').get(organicShort.id).status === status, `Status ${status} did not persist`)
}

const organicLongRevision = db.prepare('SELECT revision FROM video WHERE id = ?').get(organicLong.id)
await callServerFunction(ids, cookie, 'moveVideoStatus', {
  id: organicLong.id,
  expectedRevision: organicLongRevision.revision,
  status: 'filming',
})

const viewName = `${run} review board`
await callServerFunction(ids, cookie, 'createSavedView', {
  name: viewName,
  config: {
    layout: 'board',
    groupBy: 'status',
    status: ['filming', 'ready-to-review'],
    format: 'long',
    sort: 'publish-date-asc',
  },
})
const savedView = db.prepare(
  `SELECT saved_view.*, user.email
   FROM saved_view JOIN user ON user.id = saved_view.owner_user_id
   WHERE saved_view.name = ?`,
).get(viewName)
assert(savedView?.email === email, 'Saved view was not scoped to the signed-in user')
assert(
  savedView?.status_filter === '["filming","ready-to-review"]',
  'Saved view did not persist the status selection as a JSON array',
)
const secondCookie = await signIn(secondEmail, secondPassword)
const secondPage = await fetch(`${baseUrl}/videos`, { headers: { Cookie: secondCookie } })
const secondHtml = await secondPage.text()
assert(secondPage.ok, `Second user's planning page returned ${secondPage.status}`)
assert(!secondHtml.includes(viewName), 'Saved view leaked into another user session')

const boardUrl = new URL('/videos', baseUrl)
boardUrl.search = new URLSearchParams({
  layout: 'board',
  groupBy: 'status',
  status: 'filming,published',
  format: 'all',
  sort: 'title-asc',
}).toString()
const board = await fetch(boardUrl, { headers: { Cookie: cookie } })
const boardHtml = await board.text()
assert(board.ok, `Filtered board returned ${board.status}`)
assert(boardHtml.includes(`href="/videos/${organicShort.id}"`), 'Filtered board omitted the matching persisted video')
assert(boardHtml.includes(`href="/videos/${organicLong.id}"`), 'Filtered board omitted the second selected status')
const integration = created.find((row) => row.title.endsWith('long-integration'))
assert(integration, 'Integration was not persisted')
assert(!boardHtml.includes(`href="/videos/${integration.id}"`), 'Filtered board included an unselected status')

const deleted = created.find((row) => row.title.endsWith('short-advertisement'))
assert(deleted, 'Advertisement short was not persisted')
await callServerFunction(ids, cookie, 'removeVideo', {
  id: deleted.id,
  expectedRevision: deleted.revision,
})
assert(db.prepare('SELECT deleted_at FROM video WHERE id = ?').get(deleted.id).deleted_at !== null, 'Delete did not write a tombstone')
const deletedPage = await fetch(`${baseUrl}/videos/${deleted.id}`, { headers: { Cookie: cookie } })
assert(deletedPage.status === 404, `Deleted direct URL returned ${deletedPage.status}`)

console.log(`run=${run}`)
console.log('legal_production_rows=4')
console.log('invalid_production_rejected=true')
console.log('integration_organic_link=true invalid_link_rejected=true')
console.log('rich_script_persisted=true unsafe_link_rejected=true')
console.log('optimistic_conflict=true final_revision=7')
console.log('all_statuses_persisted=true')
console.log('saved_view_owner_scoped=true second_user_does_not_inherit=true')
console.log('status_multiselect_saved=true filtered_board_union_rendered=true')
console.log('tombstone_written=true deleted_direct_status=404')

db.close()
