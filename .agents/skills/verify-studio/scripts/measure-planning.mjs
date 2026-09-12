import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toJSONAsync } from 'seroval'

const baseUrl = process.env.STUDIO_URL ?? 'http://localhost:3001'
const email = process.env.STUDIO_TEST_EMAIL
const password = process.env.STUDIO_TEST_PASSWORD
const trunkP95 = Number(process.env.STUDIO_TRUNK_P95_MS)
const taskCount = 200
const seedPrefix = 'STUDIO-02 performance fixture '

if (!email || !password) throw new Error('STUDIO_TEST_EMAIL and STUDIO_TEST_PASSWORD are required')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function p95(values) {
  return values.toSorted((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1]
}

function planningDatabase() {
  const files = readdirSync(resolve('apps/studio/.wrangler/state'), {
    recursive: true,
    withFileTypes: true,
  }).filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
  for (const entry of files) {
    const candidate = new DatabaseSync(resolve(entry.parentPath, entry.name), { readOnly: true })
    if (candidate.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'video'").get()) {
      return candidate
    }
    candidate.close()
  }
  throw new Error('Local Studio D1 database was not found')
}

const signIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: baseUrl },
  body: JSON.stringify({ email, password }),
})
assert(signIn.ok, `Sign in returned ${signIn.status}`)
const cookie = signIn.headers.get('set-cookie')?.split(';', 1)[0]
assert(cookie, 'Sign in returned no session cookie')

const manifest = await (await fetch(`${baseUrl}/src/server/videos.functions.ts?tss-serverfn-split`)).text()
const createFunctionId = manifest.match(/id: "([^"]+)",\n\s*name: "createVideo"/)?.[1]
const moveFunctionId = manifest.match(/id: "([^"]+)",\n\s*name: "moveVideoStatus"/)?.[1]
assert(createFunctionId && moveFunctionId, 'Planning functions are missing from the development manifest')

const db = planningDatabase()
const existing = db.prepare('SELECT title FROM video WHERE title LIKE ?').all(`${seedPrefix}%`)
const existingTitles = new Set(existing.map((row) => row.title))
const missing = Array.from({ length: taskCount }, (_, index) => index)
  .filter((index) => !existingTitles.has(`${seedPrefix}${String(index).padStart(3, '0')}`))

async function createFixture(index) {
  const isShort = index % 2 === 0
  const response = await fetch(`${baseUrl}/_serverFn/${createFunctionId}`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'Content-Type': 'application/json',
      'x-tsr-serverfn': 'true',
      Cookie: cookie,
    },
    body: JSON.stringify(await toJSONAsync({
      data: {
        title: `${seedPrefix}${String(index).padStart(3, '0')}`,
        production: isShort
          ? { format: 'short', promotion: index % 4 === 0 ? 'advertisement' : 'organic' }
          : { format: 'long', promotion: index % 3 === 0 ? 'integration' : 'organic' },
        publishDate: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
        script: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    })),
  })
  assert(response.ok, `Fixture ${index} returned ${response.status}`)
  await response.arrayBuffer()
}

for (let index = 0; index < missing.length; index += 8) {
  await Promise.all(missing.slice(index, index + 8).map(createFixture))
}

const statuses = ['not-started', 'filming', 'ready-to-edit', 'ready-to-review', 'published']
const statusRows = db.prepare(
  'SELECT id, title, revision, status FROM video WHERE title LIKE ? AND deleted_at IS NULL',
).all(`${seedPrefix}%`)
const moves = statusRows.filter((row) => {
  const index = Number(row.title.slice(seedPrefix.length))
  return row.status !== statuses[index % statuses.length]
})
async function moveFixture(row) {
  const index = Number(row.title.slice(seedPrefix.length))
  const response = await fetch(`${baseUrl}/_serverFn/${moveFunctionId}`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'Content-Type': 'application/json',
      'x-tsr-serverfn': 'true',
      Cookie: cookie,
    },
    body: JSON.stringify(await toJSONAsync({
      data: { id: row.id, expectedRevision: row.revision, status: statuses[index % statuses.length] },
    })),
  })
  assert(response.ok, `Status fixture ${index} returned ${response.status}`)
  await response.arrayBuffer()
}
for (let index = 0; index < moves.length; index += 8) {
  await Promise.all(moves.slice(index, index + 8).map(moveFixture))
}

const seeded = db.prepare(
  'SELECT count(*) AS count FROM video WHERE title LIKE ? AND deleted_at IS NULL',
).get(`${seedPrefix}%`).count
assert(seeded === taskCount, `Expected ${taskCount} performance fixtures, found ${seeded}`)

const listTimes = []
for (let run = 0; run < 20; run += 1) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}/videos?layout=list&groupBy=none&status=all&format=all&sort=updated-desc`, {
    headers: { Cookie: cookie },
  })
  const html = await response.text()
  assert(response.ok && html.includes(seedPrefix), `List run ${run + 1} did not render fixtures`)
  listTimes.push(performance.now() - started)
}

const filterTimes = []
for (const status of ['not-started', 'filming', 'ready-to-edit', 'ready-to-review', 'published']) {
  const started = performance.now()
  const response = await fetch(`${baseUrl}/videos?layout=board&groupBy=status&status=${status}&format=all&sort=updated-desc`, {
    headers: { Cookie: cookie },
  })
  await response.arrayBuffer()
  assert(response.ok, `Board filter ${status} returned ${response.status}`)
  filterTimes.push({ status, milliseconds: performance.now() - started })
}

const listP95 = p95(listTimes)
const boardMax = Math.max(...filterTimes.map((entry) => entry.milliseconds))
console.log(`seeded_tasks=${seeded}`)
console.log(`head_list_p95_ms=${listP95.toFixed(1)}`)
console.log(`head_board_filter_max_ms=${boardMax.toFixed(1)}`)
for (const entry of filterTimes) console.log(`board_${entry.status}_ms=${entry.milliseconds.toFixed(1)}`)
if (Number.isFinite(trunkP95)) {
  console.log(`trunk_shell_p95_ms=${trunkP95.toFixed(1)}`)
  console.log(`head_over_trunk_ms=${(listP95 - trunkP95).toFixed(1)}`)
  assert(listP95 <= trunkP95 + 25, 'Head list p95 exceeds trunk shell p95 by more than 25 ms')
}
assert(listP95 <= 750, 'Head list p95 exceeds 750 ms')
assert(boardMax <= 300, 'A board filter response exceeds 300 ms')

db.close()
