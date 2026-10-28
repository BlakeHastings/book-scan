/**
 * Clearing away the client registrations nobody ever approved.
 *
 * `/register` is open, as dynamic client registration has to be, so every row
 * in `oauth_client` without a grant is a row a stranger could have written.
 * A real client registers and is approved within minutes; a day is long
 * enough that no sign-in in progress is cut short.
 */

import type { Db } from '../driver'
import { OAuthStore } from '../../infrastructure/auth/oauth-store'

/** How old a registration with no grant has to be before it goes. */
export const UNCLAIMED_AFTER_HOURS = 24

/** How often the sweep runs while the server is up. */
export const SWEEP_EVERY_MINUTES = 60

export const SWEEP_WORK = 'sweeping MCP client registrations nobody approved'

/** One sweep, saying what it removed when it removed anything. */
export async function sweepOnce(oauth: OAuthStore, now: Date): Promise<number> {
  const before = new Date(now.getTime() - UNCLAIMED_AFTER_HOURS * 3_600_000)
  const swept = await oauth.sweepUnclaimedClients(before, now)
  if (swept > 0) {
    console.log(`[mcp] swept ${swept} client ${swept === 1 ? 'registration' : 'registrations'} older than ${UNCLAIMED_AFTER_HOURS} hours that nobody approved`)
  }
  return swept
}

/**
 * Sweep now, then every `SWEEP_EVERY_MINUTES`, each run handed to `background`
 * so a failure is reported against this work rather than ending the process.
 *
 * The timer is unref'd so it never holds the process open on its own: stopping
 * the server is closing the listener and the pool, and nothing has to remember
 * this as well.
 */
export function keepSweeping(deps: {
  db: Db
  background: (work: Promise<unknown>, what: string) => void
  now?: () => Date
}): void {
  const oauth = new OAuthStore(deps.db)
  const now = deps.now ?? (() => new Date())
  const run = () => deps.background(sweepOnce(oauth, now()), SWEEP_WORK)
  run()
  setInterval(run, SWEEP_EVERY_MINUTES * 60_000).unref()
}
