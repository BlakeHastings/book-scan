/**
 * How often this process is willing to ask one catalogue, and what it does
 * instead of asking when it has asked too recently.
 *
 * Waiting for a slot is never allowed to outlast the caller's deadline; when
 * it would, the source is simply not asked. A rate limiter normally turns a
 * burst into a queue, but a queue in front of a person photographing books
 * would be work behind other work, so here the queue has a hard end. The
 * worst a limiter can do to a scan is cost it one supplementary source for
 * one book, the same shape as that source being down.
 *
 * State lives in this process and starts empty on every restart, the same
 * place and for the same reason as `source-watch.ts`. `BOOKSCAN_SRU_PACE_MS`
 * overrides every interval so a test run does not spend real seconds proving
 * a rule about seconds; nothing sets it in normal use, and setting it to 0
 * against the real catalogues would ask them faster than they have been
 * asked.
 */

/** An override for every interval, in milliseconds. Only a test run sets it. */
function paceOverride(): number | null {
  const raw = (process.env.BOOKSCAN_SRU_PACE_MS ?? '').trim()
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** When each source may next be asked, as a millisecond timestamp. */
const nextFreeAt = new Map<string, number>()

/**
 * Reserve the next slot for a source, or decline when it is too far off.
 *
 * The slot is reserved before the wait, not after it, so two callers racing
 * for the same source line up behind each other rather than both seeing the
 * same free slot. A caller that is declined reserves nothing.
 *
 * @param source the catalogue, spelled as `lookup_source` spells it
 * @param minIntervalMs the shortest gap this app will leave between two requests
 * @param budgetMs how long the caller is prepared to wait in total
 * @returns true when the caller may go ahead, false when it must not ask at all
 */
export async function reserveSlot(
  source: string,
  minIntervalMs: number,
  budgetMs: number,
): Promise<boolean> {
  const interval = paceOverride() ?? minIntervalMs
  if (interval <= 0) return true

  const now = Date.now()
  const at = Math.max(now, nextFreeAt.get(source) ?? 0)
  const wait = at - now

  // Strictly greater, so a budget exactly equal to the wait still goes: the
  // request then has no time left and its own deadline refuses it instead.
  if (wait >= budgetMs) return false

  nextFreeAt.set(source, at + interval)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  return true
}

/** Back to a process that has asked nothing. For tests. */
export function forgetPacing(): void {
  nextFreeAt.clear()
}
