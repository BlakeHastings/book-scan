// What the stable launcher's checker must catch, and what the launcher itself
// must refuse.
//
//   node scripts/check-stable-launcher.test.mjs
//
// Two halves, and the second is the one #475 asked for by name: whatever landed
// had to be testable without the owner's machine. It is, and this is the proof.
// Every refusal driven below happens before the script decrypts anything, so
// none of it needs DPAPI, a connection file, a catalogue, or a single byte of
// somebody's collection. It runs on a Linux CI runner with PowerShell on the
// path and on a fresh clone on any machine.
//
// The first half drives `launcherProblems` over sources that are wrong in each
// way in turn. Its failure mode is silence: a text check that matched nothing
// would pass forever while the launcher acquired somebody's home directory, and
// a checker nobody has watched fail is the shape of defect this project keeps
// finding.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  assignedEnvNames,
  launcherProblems,
  livePathsIn,
  LAUNCHER,
  ENTRY,
} from './check-stable-launcher.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const contract = JSON.parse(readFileSync(join(root, 'deploy', 'contract.json'), 'utf8'))

let failed = 0
const check = (name, actual, expected) => {
  if (actual !== expected) {
    failed++
    console.error(`FAIL  ${name}: expected ${expected}, got ${actual}`)
  }
}
const has = (name, lines, fragment) => {
  if (!lines.some((line) => line.includes(fragment))) {
    failed++
    console.error(`FAIL  ${name}: nothing said "${fragment}" in:\n    ${lines.join('\n    ') || '(nothing)'}`)
  }
}

// A launcher that is correct, in miniature, so each case below breaks exactly
// one thing about it.
const GOOD_LAUNCHER = `
# A comment naming BOOKSCAN_NOT_A_REAL_VARIABLE, which is prose and not a set.
param([string] $DataDir)
$env:ConnectionStrings__bookscan = $connection
$env:BOOKSCAN_DATA = $DataDir
& node (Join-Path $Checkout 'deploy\\check-config.mjs') --allow-development
`
const GOOD_ENTRY = 'powershell -File "%~dp0run-stable.ps1" %*\n'
const good = { launcher: GOOD_LAUNCHER, entry: GOOD_ENTRY, contract }

// --- The variable scan, which is what makes the drift check possible at all.
{
  const names = assignedEnvNames(GOOD_LAUNCHER)
  check('finds a $env: assignment', names.has('BOOKSCAN_DATA'), true)
  check('finds the connection, double underscore and all', names.has('ConnectionStrings__bookscan'), true)
  check('a variable named in a comment is not a variable that is set', names.has('BOOKSCAN_NOT_A_REAL_VARIABLE'), false)
  check('a name only read is not a name set', assignedEnvNames('if ($env:BOOKSCAN_DATA) { }').size, 0)
}

// --- Live paths, which is the promise that let these files be committed.
{
  check('a drive-letter path is a live path', livePathsIn('$x = "C:\\somewhere"').length, 1)
  check('a forward-slashed drive letter is too', livePathsIn('$x = "D:/somewhere"').length, 1)
  check('a profile path is a live path', livePathsIn('$x = "\\Users\\somebody\\thing"').length, 1)
  check('the production data directory by name', livePathsIn('# book-scan-production-data').length, 1)
  check('the stable checkout by name', livePathsIn('$x = "book-scan-stable"').length, 1)
  check('an environment-expanded path is not', livePathsIn('$x = "$env:LOCALAPPDATA\\book-scan\\a.json"').length, 0)
  check('a relative path is not', livePathsIn("Join-Path $Checkout 'deploy\\check-config.mjs'").length, 0)
}

// --- The judgement, one broken thing at a time.
{
  check('a correct pair is silent', launcherProblems(good).length, 0)

  has(
    'a live path in the launcher is a complaint',
    launcherProblems({ ...good, launcher: `${GOOD_LAUNCHER}\n$d = "C:\\Users\\somebody\\data"` }),
    'carries a drive-letter absolute path',
  )
  has(
    'a live path in the entry point is a complaint',
    launcherProblems({ ...good, entry: 'powershell -File "C:\\somewhere\\run-stable.ps1"' }),
    `${ENTRY} carries`,
  )
  has(
    'an entry point that does not hand off beside itself is a complaint',
    launcherProblems({ ...good, entry: 'powershell -File "run-stable.ps1"' }),
    '%~dp0',
  )
  has(
    'a variable the contract does not declare is a complaint',
    launcherProblems({ ...good, launcher: `${GOOD_LAUNCHER}\n$env:BOOKSCAN_INVENTED = 'x'` }),
    'BOOKSCAN_INVENTED',
  )
  has(
    'a required variable the launcher never sets is a complaint',
    launcherProblems({ ...good, launcher: GOOD_LAUNCHER.replace('$env:ConnectionStrings__bookscan =', '$notEnv =') }),
    'never sets ConnectionStrings__bookscan',
  )
  has(
    'dropping the contract check is a complaint',
    launcherProblems({ ...good, launcher: GOOD_LAUNCHER.replace('check-config.mjs', 'nothing.mjs') }),
    'does not run deploy/check-config.mjs',
  )
}

// --- The launcher itself, refusing. No DPAPI, no catalogue, no owner.

function powershell() {
  for (const exe of ['pwsh', 'powershell']) {
    const probe = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { encoding: 'utf8' })
    if (!probe.error && probe.status === 0) return exe
  }
  return null
}

function run(exe, args, env = {}) {
  return spawnSync(exe, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(root, LAUNCHER),
    ...args,
  ], { encoding: 'utf8', env: { ...process.env, ...env } })
}

const exe = powershell()
if (!exe) {
  // Loud rather than silent. A skip that reads like a pass is how a suite comes
  // to prove less than everybody believes it does.
  console.log('SKIPPED  no PowerShell on the path, so the launcher\'s own refusals were not driven here.')
} else {
  const nowhere = join(tmpdir(), 'book-scan-no-such-settings-file.json')
  const empty = mkdtempSync(join(tmpdir(), 'book-scan-launcher-'))

  try {
    // Refusing with no data directory. This is the one that would otherwise be a
    // server serving an empty shelf and reporting success.
    {
      const r = run(exe, ['-SettingsFile', nowhere])
      check('no data directory refuses', r.status, 2)
      has('and says which setting is missing', [r.stdout ?? ''], 'no data directory')
      has('and names the settings file', [r.stdout ?? ''], nowhere)
    }

    // The two variables #308 is about, gone from the process before anything is
    // resolved, and said out loud so an ordinary run is the evidence.
    {
      const r = run(exe, ['-SettingsFile', nowhere], { BOOKSCAN_BACKUP_SOURCE: 'postgres://not-a-real-catalogue' })
      has('an inherited backup variable is deleted and named', [r.stdout ?? ''], 'inherited BOOKSCAN_BACKUP_SOURCE')
      check(
        'and the value is never printed',
        (r.stdout ?? '').includes('not-a-real-catalogue'),
        false,
      )
    }

    {
      const r = run(exe, ['-SettingsFile', nowhere])
      has('and says so when there are none', [r.stdout ?? ''], 'no BOOKSCAN_BACKUP_* variables inherited')
    }

    // A directory that is not a checkout, refused before anything is decrypted.
    {
      const r = run(exe, ['-SettingsFile', nowhere, '-DataDir', empty, '-Checkout', empty])
      check('a checkout that is not one refuses', r.status, 2)
      has('and says what it looked for', [r.stdout ?? ''], "book-scan checkout's web/ directory")
    }

    // A real checkout, and no connection file. The refusal that must never
    // become a fall back to whatever is in the environment.
    {
      const r = run(exe, [
        '-SettingsFile', nowhere,
        '-DataDir', empty,
        '-Checkout', root,
        '-ConnectionFile', join(empty, 'not-here.json'),
      ])
      check('a missing connection file refuses', r.status, 2)
      has('and says where it looked', [r.stdout ?? ''], 'no connection file at')
    }
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
}

if (failed > 0) {
  console.error(`\n${failed} ${failed === 1 ? 'check' : 'checks'} failed.`)
  process.exitCode = 1
} else {
  console.log('The stable launcher checker catches what it must, and the launcher refuses what it must.')
}
