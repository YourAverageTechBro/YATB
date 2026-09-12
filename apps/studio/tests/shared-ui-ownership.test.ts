import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../../scripts/check-shared-ui.mjs', import.meta.url))
const fixtures: string[] = []

async function fixture(overrides: { source?: string; styles?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'yatb-ui-audit-'))
  fixtures.push(root)
  for (const app of ['studio', 'web']) {
    const sourceRoot = join(root, 'apps', app, 'src')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(join(root, 'apps', app, 'package.json'), JSON.stringify({ dependencies: { '@yatb/ui': '*' } }))
    await writeFile(join(sourceRoot, 'styles.css'), overrides.styles ?? "@import '@yatb/ui/styles.css';\n")
    await writeFile(join(sourceRoot, 'app.tsx'), overrides.source ?? "import { Button } from '@yatb/ui/button'; export const App = () => <Button>Go</Button>\n")
  }
  return root
}

afterEach(async () => Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function run(root: string) {
  return spawnSync(process.execPath, [script, root], { encoding: 'utf8' })
}

describe('shared UI ownership audit', () => {
  it('accepts shared shadcn composition', async () => {
    const result = run(await fixture())
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('shared shadcn primitives')
  })

  it.each([
    ['raw control', { source: 'export const App = () => <button>Go</button>\n' }],
    ['retired select', { source: "import { NativeSelect } from '@yatb/ui/native-select'; export const App = () => <NativeSelect />\n" }],
    ['retired primitive CSS', { styles: "@import '@yatb/ui/styles.css';\n.pagination button { color: inherit; }\n" }],
  ])('rejects %s', async (_name, overrides) => {
    const result = run(await fixture(overrides))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Shared UI ownership check failed')
  })
})
