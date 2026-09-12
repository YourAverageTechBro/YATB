import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('allows only the exact Studio marker declaration in authored and emitted CSS', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'review-palette-'))
  const scripts = [
    { path: resolve('scripts/check-monochrome.mjs'), cwd: join(fixture, 'apps/studio') },
    { path: resolve('../../scripts/check-emitted-ui.mjs'), cwd: fixture },
  ]
  const files = ['packages/ui/src/styles.css', ...['studio', 'web'].flatMap((app) => [
    `apps/${app}/src/styles.css`, `apps/${app}/dist/client/assets/styles.css`, `apps/${app}/dist/server/assets/styles.css`,
  ])]
  function write(file: string, css: string) {
    const path = join(fixture, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, css)
  }
  try {
    for (const file of files) write(file, ':root{color:#fff}')
    for (const file of files.filter((file) => file.startsWith('apps/studio/'))) write(file, '.custom-player{--review-comment-marker:#facc15;color:#fff}')
    for (const script of scripts) {
      expect(spawnSync(process.execPath, [script.path], { cwd: script.cwd }).status).toBe(0)
      write('apps/studio/src/styles.css', '.custom-player{color:#facc15}')
      expect(spawnSync(process.execPath, [script.path], { cwd: script.cwd }).status).toBe(1)
      write('apps/studio/src/styles.css', '.custom-player{--review-comment-marker:#ff0000}')
      expect(spawnSync(process.execPath, [script.path], { cwd: script.cwd }).status).toBe(1)
      write('apps/studio/src/styles.css', '.custom-player{--review-comment-marker:#facc15}')
    }
    write('apps/web/src/styles.css', '.custom-player{--review-comment-marker:#facc15}')
    expect(spawnSync(process.execPath, [scripts[1]!.path], { cwd: fixture }).status).toBe(1)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
