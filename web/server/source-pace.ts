/**
 * How often this process is willing to ask one catalogue, and what it does
 * instead of asking when it has asked too recently (#305).
 *
 * ## Why a limiter and not just good manners
 *
 * The two catalogues #305 adds are free, keyless and somebody else's. Library of
 * Congress documents 20 requests a minute on its JSON API with an hour's block
 * past it, and documents no figure at all for the SRU endpoint this app uses;
 * K10plus documents none. `docs/catalogue-sources.md` swept all 238 books at one
 * request per 3.2 seconds and one per 1.1 seconds respectively, and those are the
 * rates the measurement was taken at and the rates honoured here. A limit that is
 * not documented is not a licence, and a shelf is dozens of books in a few
 * minutes.
 *
 * ## The thing that makes this safe to put in front of somebody holding a book
 *
 * **Waiting for a slot is never allowed to outlast the caller's deadline. When
 * it would, the source is simply not asked.** That inverts the usual hazard: a
 * rate limiter normally turns a burst into a queue, and a queue in front of a
 * person photographing books is exactly the "work behind other work" #294 is the
 * cautionary tale about. Here the queue has a hard end. The worst a limiter can
 * do to a scan is cost it one supplementary source for one book, and the answer
 * is then whatever the other source said, which is the same shape as a source
 * being down.
 *
 * In practice it almost never fires. The queue worker is serial and reads two or
 * three photographs per book through OCR, which is seconds each, so consecutive
 * lookups are already further apart than either interval. The limiter matters for
 * the case that is not the queue: somebody correcting ISBNs by hand, one after
 * another, through `GET /api/lookup/isbn/:isbn`.
 *
 * ## The state, and the one variable that changes it
 *
 * In this process, and it starts empty on every restart, the same place and for
 * the same reason as `source-watch.ts`. `BOOKSCAN_SRU_PACE_MS` overrides every
 * interval and exists so a test run does not spend real seconds proving a rule
 * about seconds. Nothing sets it in normal use, exactly like the origin
 * variables `lookup.ts` reads, and setting it to 0 in a shell pointed at the
 * real catalogues would be asking them faster than they have been asked, so do
 * not.
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
 * The slot is reserved before the wait, not after it, so two callers racing for
 * the same source line up behind each other rather than both seeing the same
 * free slot. A caller that is declined reserves nothing, so declining costs the
 * next caller nothing.
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
  // request then has no time left and its own deadline refuses it, which is a
  // "timed out" that is honestly this app's fault rather than the catalogue's.
  // Declining is the better answer and the boundary belongs on this side of it.
  if (wait >= budgetMs) return false

  nextFreeAt.set(source, at + interval)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  return true
}

/** Back to a process that has asked nothing. For tests. */
export function forgetPacing(): void {
  nextFreeAt.clear()
}
