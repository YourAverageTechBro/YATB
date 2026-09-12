import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const appNames = ['studio', 'web']
const rawControls = /<(button|input|progress|select|textarea)\b/
const browserPrompts = /window\.(alert|confirm|prompt)\s*\(/
const legacyImports = /(?:components\/ui|@\/lib\/utils)/
const retiredImports = /@yatb\/ui\/native-select/
const rangeInputs = /<Input\b[^>]*\btype=["']range["']/
const retiredCss = [
  '.auth-card input',
  '.theme-control select',
  '.planning-toolbar select',
  '.planning-toolbar button',
  '.video-card select',
  '.pagination button',
  '.conflict button',
  '.footage-rename button',
  ".custom-player input[type='range']",
  '.upload-row progress',
  "[data-slot='native-select-wrapper']",
]
const root = resolve(process.argv[2] ?? '.')

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
  const appRoot = join(root, 'apps', appName)
  const packageJson = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  if (packageJson.dependencies?.['@yatb/ui'] !== '*') failures.push(`apps/${appName}/package.json must depend on @yatb/ui`)

  const styles = await readFile(join(appRoot, 'src/styles.css'), 'utf8')
  if (!styles.includes("@import '@yatb/ui/styles.css';")) failures.push(`apps/${appName}/src/styles.css must import shared styles`)
  for (const selector of retiredCss) {
    if (styles.includes(selector)) failures.push(`apps/${appName}/src/styles.css restores retired primitive styling: ${selector}`)
  }

  for (const file of await filesUnder(join(appRoot, 'src'), '.tsx')) {
    const source = await readFile(file, 'utf8')
    if (rawControls.test(source)) failures.push(`${file} owns a raw interactive primitive`)
    if (browserPrompts.test(source)) failures.push(`${file} uses a browser prompt instead of an accessible component`)
    if (legacyImports.test(source)) failures.push(`${file} imports an app-local UI primitive`)
    if (retiredImports.test(source)) failures.push(`${file} imports retired NativeSelect instead of shadcn Select`)
    if (rangeInputs.test(source)) failures.push(`${file} styles a range Input instead of using shadcn Slider`)
  }

  try {
    const localPrimitives = await filesUnder(join(appRoot, 'src/components/ui'), '.tsx')
    if (localPrimitives.length > 0) failures.push(`apps/${appName}/src/components/ui duplicates the shared package`)
  } catch {}
}

if (failures.length > 0) throw new Error(`Shared UI ownership check failed:\n${failures.join('\n')}`)
console.log('Both apps consume shared shadcn primitives without retired control styling.')
