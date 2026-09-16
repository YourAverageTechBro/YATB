import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

const statuses = ['not-started', 'filming', 'ready-to-edit', 'ready-to-review', 'published']

function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left)
  return (lighter! + 0.05) / (darker! + 0.05)
}

it('keeps every status chip distinct and WCAG AA in each theme', () => {
  const css = readFileSync(resolve('src/styles.css'), 'utf8')
  const blocks = [
    css.match(/:root,\s*html\[data-theme='light'\]\s*\{([^}]*)\}/)?.[1],
    css.match(/html\[data-theme='dark'\]\s*\{([^}]*)\}/)?.[1],
    css.match(/html\[data-theme='system'\]\s*\{([^}]*)\}/)?.[1],
  ]

  for (const block of blocks) {
    expect(block).toBeDefined()
    const colors = new Map([...block!.matchAll(/--video-status-([\w-]+)-(background|foreground):\s*(#[0-9a-f]{6})/g)]
      .map((match) => [`${match[1]}:${match[2]}`, match[3]!]))
    const backgrounds = statuses.map((status) => colors.get(`${status}:background`))
    expect(new Set(backgrounds).size).toBe(statuses.length)
    for (const status of statuses) {
      const background = colors.get(`${status}:background`)
      const foreground = colors.get(`${status}:foreground`)
      expect(background).toBeDefined()
      expect(foreground).toBeDefined()
      expect(contrast(background!, foreground!)).toBeGreaterThanOrEqual(4.5)
    }
  }
})

it('allows only exact approved Studio color declarations in authored and emitted CSS', () => {
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
  const approvedStudioColors = `
    .custom-player{--review-comment-marker:#facc15}
    :root{
      --video-status-not-started-background:#e5e7eb;
      --video-status-not-started-foreground:#374151;
      --video-status-filming-background:#fef3c7;
      --video-status-filming-foreground:#92400e;
      --video-status-ready-to-edit-background:#dbeafe;
      --video-status-ready-to-edit-foreground:#1e40af;
      --video-status-ready-to-review-background:#ede9fe;
      --video-status-ready-to-review-foreground:#5b21b6;
      --video-status-published-background:#dcfce7;
      --video-status-published-foreground:#166534;
      --video-status-not-started-background:#374151;
      --video-status-not-started-foreground:#f3f4f6;
      --video-status-filming-background:#78350f;
      --video-status-filming-foreground:#fef3c7;
      --video-status-ready-to-edit-background:#1e3a8a;
      --video-status-ready-to-edit-foreground:#dbeafe;
      --video-status-ready-to-review-background:#4c1d95;
      --video-status-ready-to-review-foreground:#ede9fe;
      --video-status-published-background:#14532d;
      --video-status-published-foreground:#dcfce7;
    }
  `
  try {
    for (const file of files) write(file, ':root{color:#fff}')
    for (const file of files.filter((file) => file.startsWith('apps/studio/'))) write(file, approvedStudioColors)
    for (const script of scripts) {
      expect(spawnSync(process.execPath, [script.path], { cwd: script.cwd }).status).toBe(0)
      write('apps/studio/src/styles.css', '.video-status-chip{color:#e5e7eb}')
      expect(spawnSync(process.execPath, [script.path], { cwd: script.cwd }).status).toBe(1)
      write('apps/studio/src/styles.css', ':root{--video-status-not-started-background:#ff0000}')
      expect(spawnSync(process.execPath, [script.path], { cwd: script.cwd }).status).toBe(1)
      write('apps/studio/src/styles.css', approvedStudioColors)
    }
    write('apps/web/src/styles.css', ':root{--video-status-not-started-background:#e5e7eb}')
    expect(spawnSync(process.execPath, [scripts[1]!.path], { cwd: fixture }).status).toBe(1)
    write('apps/web/src/styles.css', ':root{color:#fff}')
    write('packages/ui/src/styles.css', ':root{--video-status-not-started-background:#e5e7eb}')
    expect(spawnSync(process.execPath, [scripts[1]!.path], { cwd: fixture }).status).toBe(1)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
