/**
 * Does the thing the build produced actually load? (#512)
 *
 *     cd web && npm run build && node scripts/smoke-built-server.mjs
 *
 * A build that compiles is not a build that runs. `esbuild` will happily emit a
 * bundle whose externals cannot be resolved, whose entry point never reaches
 * `bootstrap`, or which is missing the migrations it reads off disk, and none
 * of that is visible until somebody starts it. CI runs this so the first person
 * to find out is not a deployment.
 *
 * What it proves: the bundle loads, every external package resolves against the
 * installed tree, the entry module runs, and execution reaches the one refusal
 * this app makes on purpose: no connection string, so it exits 1 naming the
 * variable rather than coming up on an empty database.
 *
 * What it does not prove is that the server serves. That needs a database, and
 * it is proved by `server/client-serving.routes.test.ts` over real HTTP for the
 * routing, and by hand against a real Aspire environment for the whole journey.
 *
 * ## The environment is set, not inherited
 *
 * Every variable that could point this process at somebody's catalogue is set
 * explicitly below, empty where empty is the answer. That is the same rule the
 * AppHost follows and the same one `run-stable.ps1` follows: an inherited value
 * must not be able to decide what a process opens or writes. This machine still
 * carries connection variables at `User` scope; see AGENTS.md.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('../', import.meta.url))
const BUNDLE = join(WEB, 'dist-server', 'index.js')
const CLIENT = join(WEB, 'dist', 'index.html')
const JOURNAL = join(WEB, 'dist-server', 'migrations', 'meta', '_journal.json')

const failures = []
const check = (ok, said) => { if (!ok) failures.push(said) }

check(existsSync(BUNDLE), `No server bundle at ${BUNDLE}. Run \`npm run build:server\`.`)
check(existsSync(JOURNAL), `No migration journal at ${JOURNAL}.`)

/*
 * The sibling coupling, checked rather than trusted. `server/index.ts` finds
 * the built client at `../dist/` relative to the entry module, which is
 * `web/dist-server/index.js` once built. If the build ever moves the bundle a
 * directory deeper, the server comes up serving no client and says so in a log
 * line nobody is reading.
 */
check(existsSync(CLIENT), `No built client at ${CLIENT}. Run \`npm run build:client\`.`)

if (failures.length) {
  for (const said of failures) console.error(`[smoke] ${said}`)
  process.exit(1)
}

const data = mkdtempSync(join(tmpdir(), 'book-scan-smoke-'))

const child = spawn(process.execPath, ['--enable-source-maps', BUNDLE], {
  cwd: WEB,
  env: {
    ...process.env,
    // Empty on purpose: this is the refusal being tested, and it also means an
    // inherited connection cannot decide what this run opens.
    ConnectionStrings__bookscan: '',
    // A directory of this script's own making, so nothing writes near a real
    // one even though the process exits before it would.
    BOOKSCAN_DATA: data,
    BOOKSCAN_BACKUP_DIR: '',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let said = ''
child.stdout.on('data', (chunk) => { said += chunk })
child.stderr.on('data', (chunk) => { said += chunk })

// Bounded, and it fails rather than hanging: a build that loads but never
// finishes starting is a failure too, and a CI job that waits forever for one
// is worse than a red check.
const giveUp = setTimeout(() => {
  console.error('[smoke] the built server did not exit within 60s')
  child.kill('SIGKILL')
  process.exitCode = 1
}, 60_000)

child.on('exit', (code) => {
  clearTimeout(giveUp)
  rmSync(data, { recursive: true, force: true })

  const named = said.includes('ConnectionStrings__bookscan is empty')
  if (code === 1 && named) {
    console.log('[smoke] the built server loaded and refused to start with no connection string')
    return
  }

  console.error(`[smoke] expected exit 1 naming ConnectionStrings__bookscan, got exit ${code}`)
  console.error(said.trim() || '[smoke] it said nothing at all')
  process.exitCode = 1
})
