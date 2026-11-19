#!/usr/bin/env node
import { ReviewError } from '../shared/domain.ts'
import { runCli } from '../server/cli.ts'
import { openStore } from '../server/store.ts'

// npm runs scripts from the repo root; INIT_CWD is where the user actually typed the command.
const cwd = process.env.INIT_CWD ?? process.cwd()
const baseUrl = process.env.YATB_REVIEW_URL ?? 'http://127.0.0.1:3002'

try {
  const store = openStore()
  console.log(runCli(process.argv.slice(2), { store, baseUrl, cwd }))
  store.close()
} catch (error) {
  console.error(`review: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = error instanceof ReviewError ? 1 : 2
}
