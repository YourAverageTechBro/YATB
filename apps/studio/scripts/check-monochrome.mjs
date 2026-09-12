import { readdir, readFile } from 'node:fs/promises'

const files = ['src/styles.css', '../../packages/ui/src/styles.css']
for (const directory of ['dist/client/assets', 'dist/server/assets']) {
  const entries = await readdir(directory)
  files.push(...entries.filter((entry) => entry.endsWith('.css')).map((entry) => `${directory}/${entry}`))
}

const failures = []
const literals = new Set()

for (const file of files) {
  const css = await readFile(file, 'utf8')

  for (const match of css.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
    const hex = match[1]
    const channels = hex.length <= 4 ? [...hex.slice(0, 3)] : hex.match(/.{2}/g).slice(0, 3)
    literals.add(`#${hex}`)
    if (new Set(channels).size !== 1) failures.push(`${file}: #${hex}`)
  }

  for (const match of css.matchAll(/rgb(a)?\(([^)]*)\)/gi)) {
    if (/^from\s/i.test(match[2])) continue
    const channels = match[2].split('/')[0].trim().split(/[\s,]+/).slice(0, 3)
    literals.add(match[0])
    if (channels.length !== 3 || new Set(channels).size !== 1) failures.push(`${file}: ${match[0]}`)
  }

  for (const match of css.matchAll(/hsl(a)?\(([^)]*)\)/gi)) {
    const saturation = match[2].split('/')[0].trim().split(/[\s,]+/)[1]
    literals.add(match[0])
    if (saturation !== '0' && saturation !== '0%') failures.push(`${file}: ${match[0]}`)
  }

  for (const match of css.matchAll(/oklch\(\s*[^\s)]+\s+([^\s/)]+)/gi)) {
    literals.add(match[0])
    if (Number.parseFloat(match[1]) !== 0) failures.push(`${file}: ${match[0]}`)
  }
}

if (failures.length > 0) throw new Error(`Studio CSS contains non-grayscale colors:\n${failures.join('\n')}`)

console.log(`Studio authored and emitted CSS use ${literals.size} grayscale literal colors.`)
