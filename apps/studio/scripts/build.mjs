import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const probe = 'yatb-studio-build-secret-probe-84b7c90e'
const vite = fileURLToPath(
  new URL('../../../node_modules/vite/bin/vite.js', import.meta.url),
)
const build = spawnSync(process.execPath, [vite, 'build'], {
  env: { ...process.env, BETTER_AUTH_SECRET: probe },
  stdio: 'inherit',
})

if (build.status !== 0) process.exit(build.status ?? 1)

const scan = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('./check-bundle-secrets.mjs', import.meta.url))],
  { env: { ...process.env, SECRET_SCAN_VALUE: probe }, stdio: 'inherit' },
)
if (scan.status !== 0) process.exit(scan.status ?? 1)

const monochrome = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('./check-monochrome.mjs', import.meta.url))],
  { stdio: 'inherit' },
)
process.exit(monochrome.status ?? 1)
