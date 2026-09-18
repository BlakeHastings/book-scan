/**
 * How much room the machine has left to hand out.
 *
 * On Windows, free physical memory can look comfortable while commit is
 * exhausted: `os.freemem()` will not show a browser about to be refused an
 * allocation, but the commit limit will.
 *
 * Linux only enforces a commit limit under strict overcommit, which is not
 * the default; see `commitIsEnforced`. Otherwise the reading used is
 * `MemAvailable` instead, since `Committed_AS` can exceed `CommitLimit` there
 * with nothing refused.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface Commitment {
  /** How much more the machine will promise, in GB. */
  freeGb: number
  /** How much it is willing to promise in total, in GB. */
  limitGb: number
  /** Which of the two numbers this is: a machine only ever has one of them to give. */
  kind: 'committed memory' | 'memory available'
}

/**
 * Below this much headroom, a run's several concurrent processes (an install,
 * a .NET AppHost, a Vite dev server, an API, and Chromium) can be refused
 * memory outright.
 */
export const TIGHT_GB = 2

function onWindows(): Commitment {
  // Win32_OperatingSystem calls the commit charge "virtual memory", which it is
  // not, but it is the only place Windows publishes it without a native call.
  const json = execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_OperatingSystem | ' +
    'Select-Object TotalVirtualMemorySize,FreeVirtualMemory | ConvertTo-Json -Compress',
  ], { encoding: 'utf8', timeout: 20_000 })
  const reading = JSON.parse(json) as { TotalVirtualMemorySize: number, FreeVirtualMemory: number }
  return {
    limitGb: reading.TotalVirtualMemorySize / 1024 / 1024,
    freeGb: reading.FreeVirtualMemory / 1024 / 1024,
    kind: 'committed memory',
  }
}

/**
 * `vm.overcommit_memory` is 0 (heuristic) on almost every Linux machine, and
 * under 0 or 1 nothing is ever refused for passing `CommitLimit`:
 * `Committed_AS` goes past it routinely. Only 2 (strict) makes it a limit.
 */
function commitIsEnforced(): boolean {
  try {
    return readFileSync('/proc/sys/vm/overcommit_memory', 'utf8').trim() === '2'
  } catch {
    return false
  }
}

function onLinux(): Commitment | null {
  const meminfo = readFileSync('/proc/meminfo', 'utf8')
  const kb = (key: string): number | null => {
    const found = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(meminfo)
    return found?.[1] === undefined ? null : Number(found[1])
  }

  if (commitIsEnforced()) {
    const limit = kb('CommitLimit')
    const charged = kb('Committed_AS')
    if (limit === null || charged === null || limit === 0) return null
    return {
      limitGb: limit / 1024 / 1024,
      freeGb: (limit - charged) / 1024 / 1024,
      kind: 'committed memory',
    }
  }

  // Not enforced: fall back to what the kernel reports as available.
  const total = kb('MemTotal')
  const available = kb('MemAvailable')
  if (total === null || available === null) return null
  return {
    limitGb: total / 1024 / 1024,
    freeGb: available / 1024 / 1024,
    kind: 'memory available',
  }
}

/**
 * What this machine has left to hand out, or null where it will not say.
 *
 * Never throws: this feeds a report, and a report that can fail the run it
 * describes is worse than one that stays quiet.
 */
export function committedMemory(): Commitment | null {
  try {
    if (process.platform === 'win32') return onWindows()
    if (process.platform === 'linux') return onLinux()
  } catch {
    // Swallowed: a machine that will not answer has nothing to add.
  }
  return null
}

/** The same reading as a sentence, or null where there is nothing to say. */
export function describeCommitment(): string | null {
  const now = committedMemory()
  if (!now) return null

  const reading = `${now.freeGb.toFixed(1)} GB of ${now.limitGb.toFixed(0)} GB ` +
    `${now.kind} on this machine`
  if (now.freeGb >= TIGHT_GB) return reading

  return `${reading}. Under ${TIGHT_GB} GB a browser or a node process here ` +
    'can be refused memory mid-scenario, which draws as a blank page, a crashed ' +
    'target or a worker exiting with code 134 rather than as anything about the ' +
    'app (#448).'
}
