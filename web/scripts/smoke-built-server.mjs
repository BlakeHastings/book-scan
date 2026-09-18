/**
 * Does the thing the build produced actually load?
 *
 *     cd web && npm run build && node scripts/smoke-built-server.mjs
 *
 * What it proves: the bundle loads, every external package resolves against
 * the installed tree, the entry module runs, and execution reaches the one
 * refusal this app makes on purpose: no connection string, so it exits 1
 * naming the variable rather than coming up on an empty database. What it
 * does not prove is that the server serves: that needs a database, and is
 * proved by `server/client-serving.routes.test.ts` and by hand against a
 * real Aspire environment.
 *
 * Every variable that could point this process at somebody's catalogue is
 * set explicitly below rather than inherited, empty where empty is the
 * answer: an inherited value must not be able to decide what this process
 * opens or writes.
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
const ADMIT = join(WEB, 'dist-server', 'enable-user.js')

const failures = []
const check = (ok, said) => { if (!ok) failures.push(said) }

check(existsSync(BUNDLE), `No server bundle at ${BUNDLE}. Run \`npm run build:server\`.`)
check(existsSync(JOURNAL), `No migration journal at ${JOURNAL}.`)

// The sibling coupling, checked rather than trusted: `server/index.ts` finds
// the built client at `../dist/` relative to the entry module, and a build
// that moved the bundle a directory deeper would come up serving no client.
check(existsSync(CLIENT), `No built client at ${CLIENT}. Run \`npm run build:client\`.`)

// The way in for the first user: an image carries no TypeScript, so `npm run
// enable-user` cannot run inside one, and a deployment whose enable script
// did not get built is a login screen that admits nobody.
check(existsSync(ADMIT), `No enable-user bundle at ${ADMIT}. Run \`npm run build:server\`.`)

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
