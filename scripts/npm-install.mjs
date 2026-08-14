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
// Usage: node scripts/npm-install.mjs
// Runs in process.cwd(), so a workflow step or an Aspire executable resource
// sets the working directory the normal way and this makes no assumption
// about where it lives in the tree.
import { spawn } from 'node:child_process'

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
