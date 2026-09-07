// `npm ci` in the current directory, retried a bounded number of times, and
// only when the failure looks like the one network hiccup this exists for.
//
// WHY THIS EXISTS (#342)
// Two runs on unrelated changes failed in a workflow's own Install step with
// the same shape: a native dependency (onnxruntime-node) fetching its own
// binary during install, from a host the runner could not reach.
//
//   npm error command sh -c node ./script/install
//   npm error AggregateError [ETIMEDOUT]
//   npm error Error: connect ETIMEDOUT 150.171.109.74:443
//
// Both times the response was to re-run the job and watch it pass, which is
// the habit #287 was written against: a flake and a real failure look
// identical from the outside, so re-running until green is how a real one
// gets waved through.
//
// TWO FACES, ONE SCRIPT
// The same `npm ci`, in the same directory, runs a second time and can fail
// the same way: the AppHost's own install, run as an executable resource
// before `api` and `web` start (see apphost.mts, the `npmInstall` resource).
// A fix only in the workflow step would leave that one exactly as it was, so
// both call this script rather than `npm ci` directly.
//
// WHAT COUNTS AS "TRY AGAIN"
// Only the shape of failure above: a connection that timed out, was reset,
// was refused, or could not be resolved. A dependency that genuinely cannot
// be installed (a bad version, a missing package, a real 404, invalid JSON)
// must still fail the run, loudly, on the first attempt. Retrying that would
// not make it succeed, and it would spend several minutes finding that out
// instead of one.
//
// AND IT ONLY RUNS WHEN THERE IS SOMETHING TO INSTALL (#561)
// `npm ci`'s documented first act is to delete `node_modules` entirely, and
// this script ran on every `aspire start`. So every start of a development
// environment deleted `web/node_modules` and wrote all 579 packages back,
// about fifteen seconds of a twenty-four second start, and took Vite's
// dependency pre-bundling cache away with the directory. It is the same act
// as the Windows `EPERM ... unlink ... skia.win32-x64-msvc.node` of #536, one
// directory over: a start that deletes a tree something else may be holding.
//
// What the AppHost needs is that the tree matches the lock file, not that the
// tree was just deleted and rebuilt. `preflight` below answers that question
// from three files and about nine milliseconds of stat calls, and this script
// runs `npm ci` only when the answer is no.
//
// The reproducibility `npm ci` is here for is preserved by construction rather
// than by re-implementation: the preflight can only ever decide to *skip*.
// Anything it cannot account for, including a `package.json` that disagrees
// with the lock file, is a reason to install, and `npm ci` then runs and
// fails exactly as it did before, with npm's own message. There is no path
// where a doubt becomes a pass.
//
// Usage: node scripts/npm-install.mjs
// Runs in process.cwd(), so a workflow step or an Aspire executable resource
// sets the working directory the normal way and this makes no assumption
// about where it lives in the tree.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_ATTEMPTS = 3

// Backoff between attempts, in milliseconds. Short enough that three attempts
// together are still faster than a person noticing a red run and pressing the
// button again, long enough that a genuinely brief network blip has cleared.
export const BACKOFF_MS = [5_000, 15_000]

// The exact errors observed (#342) plus the network failures shaped the same
// way. Deliberately narrow: this is not "any npm error", it is "a connection
// that did not complete".
const TRANSIENT = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up/i

export function isTransient(output) {
  return TRANSIENT.test(output)
}

export function backoffFor(attempt) {
  return BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)
}

/**
 * The dependency maps a `package.json` can declare.
 *
 * npm copies these into the lock file's root entry (`packages[""]`), and `npm
 * ci` refuses to run when its copy no longer matches. That refusal is the
 * whole reason `npm ci` is here rather than `npm install`, so it is the first
 * thing `installReason` looks at.
 */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bundleDependencies',
  'overrides',
]

/**
 * Deep equality that does not care what order the keys were written in.
 *
 * npm writes `package.json`'s dependency maps sorted and a person editing one
 * by hand does not, so comparing serialised bytes would report a difference
 * that is not one. Being wrong that way is only slow rather than unsafe, since
 * every disagreement here means "install", but a check that cries wolf on a
 * reordered file would be turned off within a week.
 */
function sameValue(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]))
  }
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => key in b && sameValue(a[key], b[key]))
}

/**
 * Why this directory needs `npm ci`, or `null` when it does not.
 *
 * The three inputs are the three files npm itself keeps: `package.json`, the
 * lock file, and `node_modules/.package-lock.json`, which npm writes at the
 * end of every install as its own record of the tree it just reified. So this
 * is not a second opinion about what is installed, it is npm's own, read back.
 *
 * `isPresent` is asked for each installed package's directory, because the
 * hidden lock file says what npm put there and not what is there now. Deleting
 * `node_modules/vite` by hand is the case that separates the two, and it is
 * exactly what #561 observed a start doing to itself.
 *
 * **Every branch returns a reason rather than a verdict.** This function
 * cannot fail a run and does not try to: an out-of-sync `package.json` comes
 * back as a reason to install, `npm ci` runs, and npm produces the refusal.
 * That keeps one authority on reproducibility rather than two.
 *
 * What it does not check, said out loud: the *contents* of an installed
 * package. Nothing here rehashes a tarball, so a package whose files were
 * edited in place still reads as installed. `npm ci` did not check that
 * either, it deleted the evidence instead, so this is not a property being
 * given up.
 */
export function installReason({ pkg, lock, hidden, isPresent }) {
  if (!pkg) return 'there is no package.json here'
  if (!lock) return 'there is no package-lock.json to install from'
  if (!hidden) {
    return 'node_modules holds no .package-lock.json, so nothing says what is installed'
  }
  if (lock.lockfileVersion !== hidden.lockfileVersion) {
    return `the lock file is version ${lock.lockfileVersion} and node_modules was written by version ${hidden.lockfileVersion}`
  }

  const root = lock.packages?.[''] ?? {}
  for (const [field, value] of Object.entries(root)) {
    if (!sameValue(value, pkg[field])) {
      return `package.json and package-lock.json disagree about "${field}"`
    }
  }
  for (const field of DEPENDENCY_FIELDS) {
    if (field in pkg && !sameValue(pkg[field], root[field])) {
      return `package.json declares "${field}" and package-lock.json does not record the same one`
    }
  }

  const installed = hidden.packages ?? {}
  for (const [path, got] of Object.entries(installed)) {
    const want = lock.packages?.[path]
    if (!want) return `${path} is installed and the lock file does not list it`
    if (want.version !== got.version) {
      return `${path} is installed at ${got.version} and the lock file pins ${want.version}`
    }
    if (want.resolved !== got.resolved || want.integrity !== got.integrity) {
      return `${path} is installed from something other than what the lock file resolves`
    }
    if (!want.link && !isPresent(path)) {
      return `${path} is recorded as installed and its directory is not there`
    }
  }

  for (const [path, want] of Object.entries(lock.packages ?? {})) {
    // An optional dependency is legitimately absent: the lock file lists every
    // platform's build of esbuild and rollup, and this machine has one of them.
    if (path === '' || want.optional) continue
    if (!installed[path]) return `${path} is in the lock file and is not installed`
  }

  return null
}

/**
 * `installReason` for a real directory, with a missing or unreadable file
 * read as a reason to install rather than as a crash.
 */
export function preflight(dir) {
  const read = (name) => {
    try {
      return JSON.parse(readFileSync(join(dir, name), 'utf8'))
    } catch {
      return null
    }
  }
  return installReason({
    pkg: read('package.json'),
    lock: read('package-lock.json'),
    hidden: read(join('node_modules', '.package-lock.json')),
    isPresent: (path) => existsSync(join(dir, path, 'package.json')),
  })
}

function runNpmCi() {
  return new Promise((resolve, reject) => {
    // On Windows `npm` is a `.cmd` shim, not a directly-executable file, and
    // `spawn` cannot exec one without a shell in between: without this it
    // fails immediately with ENOENT, before `npm` runs at all, on every
    // platform this script has to work on locally (the AppHost that runs it
    // as an executable resource runs wherever a developer's checkout does).
    const child = spawn('npm', ['ci'], { stdio: ['ignore', 'pipe', 'pipe'], shell: true })
    let output = ''
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      output += chunk
    })
    child.on('error', reject) // npm itself could not be spawned; not a retry case.
    child.on('close', (code) => resolve({ code, output }))
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const reason = preflight(process.cwd())

  if (reason === null) {
    // Said out loud on every start, because a step that does nothing and says
    // nothing is a step nobody can tell from a step that was skipped by
    // mistake. This is also the line that answers "why did my dependency
    // change not take" without anybody having to read this file.
    console.log(
      'node_modules already matches package-lock.json, so there is nothing to install. Delete node_modules, or run `npm ci` by hand, to force one.',
    )
    return
  }

  console.log(`Installing, because ${reason}.`)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { code, output } = await runNpmCi()

    if (code === 0) {
      return
    }

    const attemptsLeft = attempt < MAX_ATTEMPTS

    if (!isTransient(output)) {
      // Not the failure this script is for. Fail now, loudly, on the first
      // attempt: retrying a real failure only delays reporting it.
      console.error(
        `\nnpm ci failed with exit code ${code} and it does not look like the transient network timeout #342 retries for. Failing without retrying.`,
      )
      process.exit(code ?? 1)
    }

    if (!attemptsLeft) {
      console.error(
        `\nnpm ci failed with exit code ${code} on attempt ${attempt}/${MAX_ATTEMPTS}, and it kept looking like a network timeout every time. That is no longer "one connection timed out"; failing for real.`,
      )
      process.exit(code ?? 1)
    }

    const wait = backoffFor(attempt)
    console.error(
      `\nnpm ci failed with exit code ${code} on attempt ${attempt}/${MAX_ATTEMPTS}, and it looks like the transient network timeout #342 is about. Retrying in ${wait / 1000}s.`,
    )
    await sleep(wait)
  }
}

// Only when run directly, so the test can import the pure functions without
// spawning npm. Compared on the entry path rather than on `import.meta.url`,
// which needs a file:// URL dance to match on Windows.
if (process.argv[1]?.endsWith('npm-install.mjs')) {
  await main()
}
