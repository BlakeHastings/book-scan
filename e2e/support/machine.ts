/**
 * How much room the machine has left to hand out, and why this suite asks.
 *
 * ## The failure this exists for (#448)
 *
 * `leaving-books-where-they-are.feature` was reported as failing differently
 * every run, and a race inside a step was named as the likely site. It is not.
 * Every red measured while working that issue was the operating system refusing
 * an allocation, wearing one of three costumes:
 *
 *   - `net::ERR_INSUFFICIENT_RESOURCES` on two of the sixty module requests the
 *     Vite dev server answers for one page load, which draws as a blank white
 *     screen and reads as "the app is broken"
 *   - `browserContext.newPage: Target crashed`, a renderer that could not start
 *   - `worker process exited unexpectedly (code=134)`, which is a node process
 *     aborting on `FATAL ERROR: Committing semi space failed`
 *
 * None of those name memory in the message Playwright prints, and which
 * scenario collects one is a coin toss, which is exactly the shape somebody
 * reads as "a different scenario fails each time, so the scenarios interfere".
 *
 * ## Why free physical memory is the wrong number
 *
 * When this was measured the machine had 7.4 GB of physical memory free and was
 * still refusing allocations, because what had run out was **commit**: a 90 GB
 * commit limit with 1.6 GB left, most of it held by orphaned processes. So
 * `os.freemem()` would have reported comfort at the moment Chromium was being
 * told no. What follows reads the commit charge on both platforms this suite
 * runs on, and reports nothing at all rather than guess anywhere else.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface Commitment {
  /** How much more the machine will promise, in GB. */
  freeGb: number
  /** How much it is willing to promise in total, in GB. */
  limitGb: number
}

/**
 * Under this much headroom, a browser and two node processes are a gamble.
 *
 * A run of this suite costs a few GB while it is starting: an install, a .NET
 * AppHost, a Vite dev server, an API, and Chromium, all at once. Two is the
 * point at which that stops fitting.
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
  }
}

function onLinux(): Commitment | null {
  const meminfo = readFileSync('/proc/meminfo', 'utf8')
  const kb = (key: string): number | null => {
    const found = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(meminfo)
    return found?.[1] === undefined ? null : Number(found[1])
  }
  const limit = kb('CommitLimit')
  const charged = kb('Committed_AS')
  // Overcommit is usually unlimited on a CI runner, where CommitLimit is a
  // number nothing is checked against. Reporting it would be reporting noise.
  if (limit === null || charged === null || limit === 0) return null
  return { limitGb: limit / 1024 / 1024, freeGb: (limit - charged) / 1024 / 1024 }
}

/**
 * The commit charge, or null where it cannot be read.
 *
 * Never throws. This is a line in a report, and a report that can fail the run
 * it is describing is worse than one that stays quiet.
 */
export function committedMemory(): Commitment | null {
  try {
    if (process.platform === 'win32') return onWindows()
    if (process.platform === 'linux') return onLinux()
  } catch {
    // A machine that will not say is one this suite has nothing to add about.
  }
  return null
}

/** The same reading as a sentence, or null where there is nothing to say. */
export function describeCommitment(): string | null {
  const now = committedMemory()
  if (!now) return null

  const reading = `${now.freeGb.toFixed(1)} GB of ${now.limitGb.toFixed(0)} GB ` +
    'committed memory left on this machine'
  if (now.freeGb >= TIGHT_GB) return reading

  return `${reading}. Under ${TIGHT_GB} GB a browser or a node process here ` +
    'can be refused memory mid-scenario, which draws as a blank page, a crashed ' +
    'target or a worker exiting with code 134 rather than as anything about the ' +
    'app (#448).'
}
