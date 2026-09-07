/**
 * How much room the machine has left to hand out, and why this suite asks.
 *
 * ## The failure this exists for (#448)
 *
 * `leaving-books-where-they-are.feature` was reported as failing differently
 * every run. On the Windows desktop it was first worked on, every red measured
 * was the operating system refusing an allocation, wearing one of three
 * costumes:
 *
 *   - `net::ERR_INSUFFICIENT_RESOURCES` on two of the sixty module requests the
 *     Vite dev server answers for one page load, which draws as a blank white
 *     screen and reads as "the app is broken"
 *   - `browserContext.newPage: Target crashed`, a renderer that could not start
 *   - `worker process exited unexpectedly (code=134)`, which is a node process
 *     aborting on `FATAL ERROR: Committing semi space failed`
 *
 * None of those name memory in the message Playwright prints, which is why this
 * number is worth printing beside a red scenario.
 *
 * **It is not the cause of #448**, and that is the more important half of this
 * paragraph. Moved to a machine with memory to spare, the feature still failed,
 * with `net::ERR_NETWORK_CHANGED` on the page's entry module: the host changing
 * its network configuration, which is a container starting somewhere on the
 * machine. See `support/opening.ts`. Starvation and that are two different
 * failures that both draw a white page, which is exactly why this line has to
 * be a number a reader can check rather than a hint.
 *
 * ## Why free physical memory is the wrong number, where commit is a limit
 *
 * When the Windows measurement was taken the machine had 7.4 GB of physical
 * memory free and was still refusing allocations, because what had run out was
 * **commit**: a 90 GB commit limit with 1.6 GB left, most of it held by
 * orphaned processes. `os.freemem()` would have reported comfort at the moment
 * Chromium was being told no.
 *
 * ## And why it is the right number where commit is not a limit
 *
 * Linux only enforces `CommitLimit` under strict overcommit, which is not the
 * default and is not what this suite meets. Everywhere else `Committed_AS`
 * passes it with nothing refused, so the headroom goes negative while the
 * machine is fine. So the reading is chosen per machine and says which it is:
 * see `commitIsEnforced`.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface Commitment {
  /** How much more the machine will promise, in GB. */
  freeGb: number
  /** How much it is willing to promise in total, in GB. */
  limitGb: number
  /**
   * Which of two numbers this is, said out loud because they answer different
   * questions and a machine only has one of them to give.
   */
  kind: 'committed memory' | 'memory available'
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
    kind: 'committed memory',
  }
}

/**
 * Whether this kernel enforces its commit limit at all.
 *
 * `vm.overcommit_memory` is 0, heuristic, on almost every Linux machine, and
 * under 0 and 1 nothing is ever refused for passing `CommitLimit`:
 * `Committed_AS` goes past it routinely and the difference goes negative. Only
 * 2, strict, makes it a limit.
 *
 * The paragraph at the top of this file already knew that — "overcommit is
 * usually unlimited on a CI runner, where CommitLimit is a number nothing is
 * checked against" — and then guarded it with `limit === 0`, which is a value
 * `/proc/meminfo` never publishes. So the check never fired and the wrong
 * number was printed everywhere.
 *
 * It is not pedantry. Working #448 a scenario failed on a box with 25 GB of
 * memory available and this file printed "-1.9 GB of 18 GB committed memory
 * left" beside it, with the sentence about a browser being refused memory
 * mid-scenario. **A false alarm sitting next to a true failure is what sends
 * the next reader after memory when the answer is somewhere else entirely**,
 * and that is exactly the afternoon #448 cost.
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

  // Where the limit is not a limit, the honest number is the one the kernel
  // hands out when something asks how much it can still have.
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
    `${now.kind} on this machine`
  if (now.freeGb >= TIGHT_GB) return reading

  return `${reading}. Under ${TIGHT_GB} GB a browser or a node process here ` +
    'can be refused memory mid-scenario, which draws as a blank page, a crashed ' +
    'target or a worker exiting with code 134 rather than as anything about the ' +
    'app (#448).'
}
