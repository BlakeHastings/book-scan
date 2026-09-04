/**
 * Driving the Aspire AppHost from the test runner.
 *
 * The app under test is started the way the app is actually started, through
 * Aspire, rather than by running `npm run dev` behind Playwright's webServer.
 * That is not ceremony: Aspire assigns the ports, sets BOOKSCAN_DATA to a
 * directory inside this checkout, and is the only supported way to run two
 * checkouts at once. A harness that started Vite itself would be testing a
 * configuration nobody uses.
 *
 * Because Aspire assigns the ports, nothing here may assume 5173 or 3001. The
 * URLs are read back out of `aspire describe` at runtime.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { REPO_ROOT } from './paths.js'

const run = promisify(execFile)

// `aspire` is a native executable, so it can be spawned without a shell. That
// matters: a shell would need every path quoted, and these paths contain a
// checkout directory somebody else chose.
const ASPIRE = 'aspire'

/** Ten minutes. A cold start builds the AppHost and runs `npm install`. */
const START_TIMEOUT_MS = 10 * 60 * 1000

/**
 * What `aspire start` needs so that starting the app is not a network call.
 *
 * WHAT #535 ACTUALLY WAS
 * `browser journeys` went red on every branch on 2026-09-04, including a commit
 * that had passed hours earlier and was re-run unchanged. Every failing job
 * printed the same two lines, and they told two different stories:
 *
 *     NativeCertificateToolRunner: The certificate is not trusted by OpenSSL.
 *     Timed out waiting 120s for AppHost to start.
 *
 * Neither was the reason. The CLI's own log, which no job had ever printed,
 * says what happened (run 33833840718):
 *
 *     03:45:24.817 [GuestAppHostProject] Executing: .../npm install
 *     03:47:15.084 [Cli] Termination signal received, requesting cancellation.
 *
 * Starting a TypeScript AppHost runs `npm install` in the AppHost's directory
 * before a single resource starts, and **that install was the whole of the
 * start time**: 110 seconds against a 120 second budget, still running when the
 * CLI gave up. The certificate line is a warning logged a quarter of a second
 * *after* the timeout, during teardown, which the CLI then echoed back as
 * "recent AppHost startup output" — last written, not first cause.
 *
 * The Aspire CLI version was not it either. The same tree failed identically on
 * 13.4.2, 13.4.6 and 13.5.3, which is the experiment the issue asked for and it
 * came back the other way.
 *
 * WHY THIS IS THE FIX AND A LONGER TIMEOUT IS NOT
 * That `npm install` is redundant work on the critical path. The workflow runs
 * `npm ci` in the same directory, from the same lock file, immediately before,
 * so `node_modules` is already correct and there is nothing for the install to
 * do. What it still does is talk to the registry, which is why a registry
 * having a slow evening can stop this app starting at all. The same run proves
 * a longer budget does not save it: the job given 420 seconds instead of 120
 * failed too, with that one install running for 413 of them.
 *
 * So the network comes off the start path instead:
 *
 * - `prefer-offline` answers from the local npm cache and reaches the registry
 *   only for something genuinely missing. `npm ci` has just populated that
 *   cache from this exact lock file, so in CI there is nothing missing. On a
 *   developer's first run the cache is cold and npm simply fetches, which is
 *   why this is `prefer-offline` and not `offline`: it degrades to today's
 *   behaviour rather than failing.
 * - `audit` and `fund` are two registry round trips whose output nothing reads,
 *   on a path where the app is not yet up.
 *
 * Integrity is untouched. The lock file still pins every version and every
 * hash, and npm still checks them; all this changes is where the bytes are read
 * from.
 *
 * The budget is raised as well, but as margin rather than as the fix. A healthy
 * start is around 45 seconds and the last green run before this broke took 106,
 * so the CLI's 120 second default had spent its headroom without anybody
 * noticing. Eight minutes sits under this file's own ten minute process
 * timeout, so a start that really is wedged is still reported by the CLI, with
 * its reasons, rather than killed by execFile with none.
 */
export const START_BUDGET_SECONDS = 480

const START_ENV: NodeJS.ProcessEnv = {
  ASPIRE_CLI_START_TIMEOUT: String(START_BUDGET_SECONDS),
  npm_config_prefer_offline: 'true',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
}

interface ExecOptions {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

async function aspire(args: string[], options: ExecOptions = {}): Promise<string> {
  const { stdout } = await run(ASPIRE, [...args, '--non-interactive'], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...options.env },
    timeout: options.timeoutMs ?? 5 * 60 * 1000,
    // `aspire describe --format Json` is a couple of hundred kilobytes once it
    // has printed every resource's environment.
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

/**
 * Pull the JSON document out of Aspire's output.
 *
 * The CLI prints human lines such as "Scanning for running AppHosts..." to the
 * same stream as the JSON, so the document has to be found rather than parsed
 * from the first byte. See aspire#15843.
 */
function parseJson<T>(output: string): T {
  const lines = output.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith('{') || line.startsWith('['))
  if (start < 0) {
    throw new Error(`No JSON in Aspire output:\n${output}`)
  }
  return JSON.parse(lines.slice(start).join('\n')) as T
}

export interface AspireResource {
  name: string
  displayName: string
  state: string
  healthStatus?: string
  urls: { name: string; url: string }[]
  environment: Record<string, string>
}

/**
 * Start the AppHost in the background.
 *
 * `--isolated` because the suite may be running from a git worktree beside
 * other checkouts, and it gives this run its own user secrets. It is not what
 * keeps the ports apart: `--isolated` cannot override a launch profile, so the
 * ports stay apart only because `aspire.config.json` declares no profile. See
 * the note in AGENTS.md before adding one back.
 *
 * `START_ENV` first, so a caller can still override any of it; see the note on
 * that constant for what it is doing and which failure it is for.
 */
export async function startAppHost(env: NodeJS.ProcessEnv): Promise<void> {
  await aspire(['start', '--isolated', '--format', 'Json'], {
    env: { ...START_ENV, ...env },
    timeoutMs: START_TIMEOUT_MS,
  })
}

/** Block until a resource reports healthy. Never poll by hand. */
export async function waitForResource(name: string, seconds = 300): Promise<void> {
  await aspire(['wait', name, '--timeout', String(seconds)], {
    timeoutMs: (seconds + 30) * 1000,
  })
}

/**
 * A resource's own console output.
 *
 * Bounded and forgiving on purpose, because the only caller is a failure path:
 * a run that is already going to fail must not be turned into a different
 * failure by the thing that was supposed to explain the first one. A resource
 * with no logs, or a name the CLI does not know, comes back as a line saying so.
 *
 * `--tail` rather than everything, because the interesting part of a process
 * that would not start is the end of it, and an unbounded dump of a Vite
 * server that did start would bury it.
 */
export async function resourceLogs(name: string, lines = 200): Promise<string> {
  try {
    const output = await aspire(['logs', name, '--tail', String(lines), '--timestamps'], {
      timeoutMs: 60 * 1000,
    })
    return output.trim() || '(no output)'
  } catch (error) {
    return `(aspire logs ${name} failed: ${(error as Error).message})`
  }
}

/**
 * Say what the AppHost thinks of every resource, and print what each one said.
 *
 * `aspire wait` reports that a resource "failed to start" and nothing about why,
 * so before #277 a `browser journeys` failure at this point could only be
 * re-run: the job logged the wait failing and never the resource's own output.
 * Two flakes in two days were answered by re-running until green, which is the
 * habit that makes a real failure indistinguishable from a flake.
 *
 * So this runs before the error is rethrown, prints rather than collects, and
 * never throws. The output goes to the job log, which is kept whatever the run
 * did. CI minutes are free on a public repository, so a dozen seconds spent
 * here on the way to a failure costs nothing worth weighing against being able
 * to read what happened.
 */
export async function reportResourceState(failed: string): Promise<void> {
  const say = (message: string) => console.error(`[e2e] ${message}`)
  say(`${failed} never became healthy. What the AppHost has:`)

  let resources: AspireResource[] = []
  try {
    resources = await describeResources()
    for (const resource of resources) {
      say(`  ${resource.name} state=${resource.state} health=${resource.healthStatus ?? 'unknown'}`)
    }
  } catch (error) {
    say(`  aspire describe failed: ${(error as Error).message}`)
  }

  // Every resource, not just the one that failed. `web` waits for `api` which
  // waits for the database, so the resource that reports the failure is
  // routinely not the one that caused it.
  const names = resources.length ? resources.map((r) => r.name) : [failed, 'api', 'web']
  for (const name of [...new Set(names)]) {
    console.error(`[e2e] ----- aspire logs ${name} -----`)
    console.error(await resourceLogs(name))
  }
}

export async function describeResources(): Promise<AspireResource[]> {
  const parsed = parseJson<{ resources: AspireResource[] }>(
    await aspire(['describe', '--format', 'Json']),
  )
  return parsed.resources ?? []
}

/**
 * Stop the AppHost this run started, and only that one.
 *
 * Never `--all`. Other Aspire apps, belonging to other projects, are commonly
 * running on the same machine, and taking them down would be a rude way to
 * finish a test run. Without `--all` the CLI resolves the AppHost from the
 * working directory, which is this checkout.
 */
export async function stopAppHost(): Promise<void> {
  await aspire(['stop'])
}

/**
 * Where the app under test actually is.
 *
 * The `web` resource is declared with `withHttpEndpoint`, but Vite terminates
 * TLS itself so that it can hand a phone a camera stream, and Aspire's proxy
 * passes the bytes through untouched. The endpoint Aspire reports is therefore
 * the right host and port with the wrong scheme, and the browser has to be
 * sent to https or the connection is dropped before a single byte of HTML.
 */
export function urlOf(resources: AspireResource[], displayName: string, scheme: 'http' | 'https'): string {
  const resource = resources.find((r) => r.displayName === displayName)
  const url = resource?.urls?.[0]?.url
  if (!url) {
    const seen = resources.map((r) => `${r.displayName} (${r.state})`).join(', ')
    throw new Error(`Aspire reported no URL for "${displayName}". Resources: ${seen}`)
  }

  const parsed = new URL(url)
  parsed.protocol = `${scheme}:`
  return parsed.origin
}
