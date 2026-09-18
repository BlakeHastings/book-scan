/**
 * Aspire assigns the ports and sets BOOKSCAN_DATA to a directory inside this
 * checkout, so nothing here may assume fixed ports: URLs are read back out of
 * `aspire describe` at runtime.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { REPO_ROOT } from './paths.js'

const run = promisify(execFile)

// A native executable, so it can be spawned without a shell: a shell would
// need every path quoted, and these paths contain a checkout directory
// somebody else chose.
const ASPIRE = 'aspire'

/** Ten minutes. A cold start builds the AppHost and runs `npm install`. */
const START_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Starting a TypeScript AppHost runs `npm install` in the AppHost's directory
 * before a single resource starts, and that still talks to the registry
 * unless `prefer-offline` is set. 480 seconds is margin, not the fix: a
 * healthy start is around 45 seconds.
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
 * The CLI prints human lines to the same stream as the JSON output, so the
 * document has to be found rather than parsed from the first byte. See
 * aspire#15843.
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
 * `--isolated` gives this run its own user secrets, for running beside other
 * checkouts, but it does not keep the ports apart: that only holds because
 * `aspire.config.json` declares no launch profile. See the note in AGENTS.md
 * before adding one back.
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
 * A resource's own console output. Never throws: the only caller is a
 * failure path, and this must not turn one failure into a different one.
 * `--tail`, not everything, since a full dump of a resource that did start
 * would bury the part that matters.
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
 * Say what the AppHost thinks of every resource, and print each one's own
 * output, before the error that triggered this is rethrown. Prints rather
 * than throws: a run already failing must not be turned into a different
 * failure by the thing meant to explain it.
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

  // Every resource, not just the one that failed: `web` waits on `api`, so the
  // resource reporting failure is often not the one that caused it.
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
 * Never `--all`: other Aspire apps for other projects commonly run on the
 * same machine. Without it, the CLI resolves the AppHost from the working
 * directory, this checkout.
 */
export async function stopAppHost(): Promise<void> {
  await aspire(['stop'])
}

/**
 * The `web` resource is declared with an http endpoint, but Vite terminates
 * TLS itself so it can hand a phone a camera stream. Aspire reports the right
 * host and port with the wrong scheme, so the caller must say which scheme to
 * use.
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
