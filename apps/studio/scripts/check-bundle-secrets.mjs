import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function files(root) {
  const entries = await readdir(root, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name)
        return entry.isDirectory() ? files(path) : [path]
      }),
    )
  ).flat()
}

const emitted = await files('dist')
const envFiles = emitted.filter((path) => /(^|\/)\.dev\.vars(?:\.|$)/.test(path))

if (envFiles.length > 0) {
  throw new Error(`Build emitted local environment files: ${envFiles.join(', ')}`)
}

const probe = process.env.SECRET_SCAN_VALUE
if (!probe) throw new Error('SECRET_SCAN_VALUE is required')

for (const path of emitted) {
  if ((await readFile(path)).includes(probe)) {
    throw new Error(`Build emitted the secret probe value: ${path}`)
  }
}

console.log('Build contains no local environment files or secret probe value.')
