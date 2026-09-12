import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const appNames = ['studio', 'web']
const rawControls = /<(button|input|progress|select|textarea)\b/
const browserPrompts = /window\.(alert|confirm|prompt)\s*\(/
const legacyImports = /(?:components\/ui|@\/lib\/utils)/

async function filesUnder(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path, extension) : entry.name.endsWith(extension) ? [path] : []
  }))
  return nested.flat()
}

const failures = []
for (const appName of appNames) {
  const packageJson = JSON.parse(await readFile(`apps/${appName}/package.json`, 'utf8'))
  if (packageJson.dependencies?.['@yatb/ui'] !== '*') failures.push(`apps/${appName}/package.json must depend on @yatb/ui`)

  const styles = await readFile(`apps/${appName}/src/styles.css`, 'utf8')
  if (!styles.includes("@import '@yatb/ui/styles.css';")) failures.push(`apps/${appName}/src/styles.css must import shared styles`)

  for (const file of await filesUnder(`apps/${appName}/src`, '.tsx')) {
    const source = await readFile(file, 'utf8')
    if (rawControls.test(source)) failures.push(`${file} owns a raw interactive primitive`)
    if (browserPrompts.test(source)) failures.push(`${file} uses a browser prompt instead of an accessible component`)
    if (legacyImports.test(source)) failures.push(`${file} imports an app-local UI primitive`)
  }

  try {
    const localPrimitives = await filesUnder(`apps/${appName}/src/components/ui`, '.tsx')
    if (localPrimitives.length > 0) failures.push(`apps/${appName}/src/components/ui duplicates the shared package`)
  } catch {}
}

if (failures.length > 0) throw new Error(`Shared UI ownership check failed:\n${failures.join('\n')}`)
console.log('Both apps consume shared styles and own no duplicate interactive primitives.')
