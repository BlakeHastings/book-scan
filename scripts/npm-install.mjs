// `npm ci` in the current directory, retried a bounded number of times, and
// only when the failure looks like a connection that did not complete.
//
// A native dependency (onnxruntime-node) fetches its own binary during install,
// and that fetch can time out on a runner. Only that shape of failure is
// retried: a dependency that genuinely cannot be installed (a bad version, a
// missing package, a real 404, invalid JSON) must still fail the run, loudly,
// on the first attempt.
//
// `npm ci`'s documented first act is to delete `node_modules` entirely, which
// takes Vite's dependency pre-bundling cache with it, so this script runs it
// only when `preflight` below says the tree does not already match the lock
// file. The preflight can only ever decide to skip: anything it cannot account
// for, including a `package.json` that disagrees with the lock file, is a reason
// to install, and `npm ci` then fails exactly as it did before with npm's own
// message. There is no path where a doubt becomes a pass.
//
// The AppHost calls this too, as an executable resource before `api` and `web`
// start (see apphost.mts, the `npmInstall` resource), so a fix in the workflow
// step alone would have left that install as it was.
//
// Usage: node scripts/npm-install.mjs
// Runs in process.cwd(), so a workflow step or an Aspire executable resource
// sets the working directory the normal way.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_ATTEMPTS = 3

export const BACKOFF_MS = [5_000, 15_000]

// Deliberately narrow: not "any npm error", only a connection that did not
// complete.
const TRANSIENT = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up/i

export function isTransient(output) {
  return TRANSIENT.test(output)
}

export function backoffFor(attempt) {
  return BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)
}

/**
 * The dependency maps a `package.json` can declare. npm copies these into the
 * lock file's root entry (`packages[""]`), and `npm ci` refuses to run when its
 * copy no longer matches.
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
 * Deep equality that does not care what order the keys were written in. npm
 * writes `package.json`'s dependency maps sorted and a person editing one by
 * hand does not, so comparing serialised bytes would report a difference that
 * is not one.
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
 * lock file, and `node_modules/.package-lock.json`, which npm writes at the end
 * of every install as its own record of the tree it just reified.
 *
 * `isPresent` is asked for each installed package's directory, because that
 * hidden lock file says what npm put there and not what is there now.
 *
 * Every branch returns a reason rather than a verdict: this function cannot
 * fail a run, so an out-of-sync `package.json` comes back as a reason to
 * install and `npm ci` produces the refusal. Nothing here rehashes a tarball,
 * so a package whose files were edited in place still reads as installed.
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
    // fails immediately with ENOENT, before `npm` runs at all.
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
// spawning npm. Compared on the entry path because `import.meta.url` needs a
// file:// URL dance to match on Windows.
if (process.argv[1]?.endsWith('npm-install.mjs')) {
  await main()
}
