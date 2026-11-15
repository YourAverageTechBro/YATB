#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const remote = process.argv.includes('--remote')
const cwd = fileURLToPath(new URL('..', import.meta.url))
const wrangler = ['wrangler']
const d1 = ['d1', 'execute', 'yatb-studio', '--cwd', cwd, '--json']
if (!remote) d1.push('--local')
else d1.push('--remote')

function runJson(args) {
  const result = spawnSync('npx', [...wrangler, ...args], { encoding: 'utf8', cwd })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `wrangler failed: ${args.join(' ')}`)
  }
  const text = result.stdout.trim()
  const start = text.indexOf('[')
  const parsed = JSON.parse(start >= 0 ? text.slice(start) : text)
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  return first?.results ?? first?.result ?? []
}

function parseMp4DurationMs(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let offset = 0
  while (offset + 8 <= view.byteLength) {
    let size = view.getUint32(offset)
    const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7))
    if (size === 1 && offset + 16 <= view.byteLength) size = Number(view.getBigUint64(offset + 8))
    if (size < 8) break
    if (type === 'moov' || type === 'trak' || type === 'mdia') {
      const nested = parseMp4DurationMs(buffer.subarray(offset + 8, offset + size))
      if (nested) return nested
    }
    if (type === 'mvhd' && offset + 32 <= view.byteLength) {
      const version = view.getUint8(offset + 8)
      const timescale = version === 1 ? view.getUint32(offset + 28) : view.getUint32(offset + 20)
      const duration = version === 1
        ? Number(view.getBigUint64(offset + 32))
        : view.getUint32(offset + 24)
      if (timescale > 0 && duration > 0) return Math.round(duration / timescale * 1000)
    }
    offset += size
  }
  return null
}

function ffprobeMs(path) {
  const probed = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path,
  ], { encoding: 'utf8' })
  if (probed.status !== 0) return null
  const seconds = Number(probed.stdout.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.round(seconds * 1000)
}

const rows = runJson([
  ...d1,
  '--command',
  "SELECT id, object_key, content_type FROM media_file WHERE purpose = 'footage' AND duration_ms IS NULL AND content_type LIKE 'video/%'",
])

let updated = 0
let skipped = 0
const scratch = mkdtempSync(join(tmpdir(), 'yatb-duration-'))
try {
  for (const row of rows) {
    if (typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)) {
      skipped += 1
      continue
    }
    const dest = join(scratch, `${row.id}.bin`)
    const getArgs = [
      'r2', 'object', 'get', `yatb-studio-media/${row.object_key}`,
      '--file', dest,
    ]
    if (!remote) getArgs.push('--local', '--persist-to', join(cwd, '.wrangler/state'))
    const got = spawnSync('npx', ['wrangler', ...getArgs], { encoding: 'utf8', cwd })
    if (got.status !== 0) {
      skipped += 1
      continue
    }
    let duration = null
    try { duration = parseMp4DurationMs(readFileSync(dest)) } catch { duration = null }
    if (duration === null) duration = ffprobeMs(dest)
    if (duration === null || duration < 1) {
      skipped += 1
      continue
    }
    runJson([
      ...d1,
      '--command',
      `UPDATE media_file SET duration_ms = ${duration} WHERE id = '${row.id}' AND purpose = 'footage' AND duration_ms IS NULL`,
    ])
    updated += 1
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

console.log(JSON.stringify({ updated, skipped, remainingUnchecked: rows.length - updated - skipped, remote }, null, 2))
console.log(remote
  ? 'Prod backfill: node apps/studio/scripts/backfill-footage-duration.mjs --remote'
  : 'Local backfill: node apps/studio/scripts/backfill-footage-duration.mjs --local')
