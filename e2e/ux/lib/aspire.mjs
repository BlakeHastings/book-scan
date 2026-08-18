/**
 * Asking the AppHost where the app is and what database it opened.
 *
 * A trimmed copy of the argument e2e/support/aspire.ts makes, in plain
 * JavaScript so this harness needs no build step: Aspire assigns the ports, so
 * nothing here may assume 5173 or 3001, and the connection is read out of the
 * api resource's own environment rather than rebuilt from a guess.
 *
 * It never reads ConnectionStrings__bookscan or BOOKSCAN_DATA from a shell.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const run = promisify(execFile)

const here = dirname(fileURLToPath(import.meta.url))
/** e2e/ux */
export const UX_ROOT = resolve(here, '..')
/** The repository root, which is where the AppHost lives. */
export const REPO_ROOT = resolve(UX_ROOT, '..', '..')

export async function aspire(args, { timeoutMs = 5 * 60 * 1000, env } = {}) {
  const { stdout } = await run('aspire', [...args, '--non-interactive'], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

/** The CLI prints human lines on the same stream as the JSON. See aspire#15843. */
function parseJson(output) {
  const lines = output.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith('{') || line.startsWith('['))
  if (start < 0) throw new Error(`No JSON in Aspire output:\n${output}`)
  return JSON.parse(lines.slice(start).join('\n'))
}

export async function describeResources() {
  return parseJson(await aspire(['describe', '--format', 'Json'])).resources ?? []
}

/**
 * Where the app under test is.
 *
 * Vite terminates TLS itself so a phone will hand it a camera, and Aspire
 * describes that endpoint as http, so the scheme is replaced rather than read.
 */
export function urlOf(resources, displayName, scheme) {
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

/** The web URL, the api URL and the connection the api was handed. */
export async function whereIsTheApp() {
  const resources = await describeResources()
  const api = resources.find((r) => r.displayName === 'api')
  const connection = api?.environment?.ConnectionStrings__bookscan
  if (!connection) {
    throw new Error(
      'The api resource has no ConnectionStrings__bookscan. Start the AppHost first: ' +
      'aspire start --non-interactive',
    )
  }
  return {
    web: urlOf(resources, 'web', 'https'),
    api: urlOf(resources, 'api', 'http'),
    connection,
  }
}
