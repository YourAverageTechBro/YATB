import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeApprovedStudioColors } from './studio-color-tokens.mjs'

function colorFailures(css, file) {
  if (file.startsWith('apps/studio/')) css = normalizeApprovedStudioColors(css)
  const failures = []
  for (const match of css.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
    const channels = match[1].length <= 4 ? [...match[1].slice(0, 3)] : match[1].match(/.{2}/g)?.slice(0, 3) ?? []
    if (new Set(channels).size !== 1) failures.push(`${file}: ${match[0]}`)
  }
  for (const match of css.matchAll(/rgb(?:a)?\(([^)]*)\)/gi)) {
    if (/^from\s/i.test(match[1])) continue
    const channels = match[1].split('/')[0].trim().split(/[\s,]+/).slice(0, 3)
    if (channels.length !== 3 || new Set(channels).size !== 1) failures.push(`${file}: ${match[0]}`)
  }
  for (const match of css.matchAll(/hsl(?:a)?\(([^)]*)\)/gi)) {
    const saturation = match[1].split('/')[0].trim().split(/[\s,]+/)[1]
    if (saturation !== '0' && saturation !== '0%') failures.push(`${file}: ${match[0]}`)
  }
  for (const match of css.matchAll(/oklch\(\s*[^\s)]+\s+([^\s/)]+)/gi)) {
    if (Number.parseFloat(match[1]) !== 0) failures.push(`${file}: ${match[0]}`)
  }
  return failures
}

const files = ['packages/ui/src/styles.css', 'apps/studio/src/styles.css', 'apps/web/src/styles.css']
for (const appName of ['studio', 'web']) {
  for (const side of ['client', 'server']) {
    const directory = `apps/${appName}/dist/${side}/assets`
    const entries = await readdir(directory)
    files.push(...entries.filter((entry) => entry.endsWith('.css')).map((entry) => join(directory, entry)))
  }
}

const failures = []
for (const file of files) failures.push(...colorFailures(await readFile(file, 'utf8'), file))
if (failures.length > 0) throw new Error(`Shared UI emitted non-grayscale colors:\n${failures.join('\n')}`)
console.log(`Shared authored and emitted CSS remain grayscale across ${files.length} files except approved Studio color tokens.`)
