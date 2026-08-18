/**
 * Whether the catalogues a lookup consults actually answered (#348).
 *
 * `lookupIsbn` asks two catalogues and merges whatever comes back. Until this
 * existed, a catalogue that did not answer at all and a catalogue that answered
 * and had never heard of the book were the same thing: a `null`, absorbed, with
 * `lookup_source` quietly naming one source instead of two.
 * `docs/catalogue-sources.md` measured the consequence. Across all 238 books in
 * the real catalogue `lookup_source` reads `Open Library + Google Books` zero
 * times, because every Google Books request in the life of this catalogue has
 * gone out anonymously and come back 429, and nothing anywhere said so.
 *
 * ## The distinction this whole file exists to draw
 *
 * **A source that answers and has no record of the book is not a failure.** It
 * is the ordinary case and it is the reason #305 exists. Open Library has no
 * record of six of the 238, and that is a fact about the book rather than about
 * the request.
 *
 * **A source that does not answer is a different thing.** Nothing was asked of
 * the catalogue's contents at all: the request timed out, or the host was
 * unreachable, or what came back was an HTTP status rather than a record. That
 * is what went unrecorded, and that is what is counted here.
 *
 * ## What this is not
 *
 * It is not an error path. A catalogue being down must not stop somebody
 * cataloguing a book, so nothing here throws, nothing here is awaited by a
 * lookup, and a silent source still leaves the lookup returning whatever the
 * other one said. This is the record and nothing else.
 *
 * ## Where the record lives
 *
 * In this process, and it starts empty on every restart. Two things follow, and
 * both are deliberate:
 *
 * - The durable record is the log. `console.warn` runs at the moment a source
 *   first goes quiet, so the stable server's log file holds it after the
 *   process is gone.
 * - The findable record is `/api/health`, which is already the one command
 *   AGENTS.md tells anybody to run against a running server. It settled which
 *   database was opened; it now also settles which catalogues answered.
 *
 * A table in Postgres was the other option and it is not proportionate. This is
 * a fact about a running server rather than about the collection, and a
 * migration to hold a counter that resets on restart anyway buys nothing.
 */

/**
 * The catalogues `lookupIsbn` consults, named so a standing exists before the
 * first request is made.
 *
 * That is the point of listing them rather than letting the map fill in as
 * requests happen. "Google Books was asked forty times and answered none" and
 * "Google Books is not in this report" read very differently, and the second is
 * indistinguishable from a server nobody has looked a book up on yet. That
 * ambiguity is the exact shape of the defect this file exists for.
 */
export const CATALOGUES = ['Open Library', 'Google Books'] as const

/**
 * The reasons a source is allowed to give for not answering.
 *
 * A closed vocabulary, checked rather than trusted, because this string reaches
 * `/api/health` and the log, and the Google Books request carries the API key in
 * its query string. A reason built by stringifying an error, a request or a URL
 * would put the key in both. Nothing may widen this to free text.
 */
const REASON = /^(HTTP \d{3}|timed out|unreachable)$/

/** What one catalogue has done since this server started. */
export interface SourceStanding {
  /** The catalogue, spelled as `lookup_source` spells it. */
  source: string
  /** Requests made to it. */
  asked: number
  /** Requests it replied to, whether or not it had the book. */
  answered: number
  /** Requests it did not reply to at all. */
  silent: number
  /** When it last did not answer, ISO 8601, or empty if it always has. */
  lastSilentAt: string
  /** Why it last did not answer, or empty. Never the request. */
  lastSilence: string
}

interface Tally extends SourceStanding {
  /** True when the source has answered since the last time it did not. */
  answering: boolean
}

const standings = new Map<string, Tally>()

function tallyFor(source: string): Tally {
  const held = standings.get(source)
  if (held) return held

  const fresh: Tally = {
    source,
    asked: 0,
    answered: 0,
    silent: 0,
    lastSilentAt: '',
    lastSilence: '',
    answering: true,
  }
  standings.set(source, fresh)
  return fresh
}

for (const source of CATALOGUES) tallyFor(source)

/**
 * Record what one catalogue did with one request.
 *
 * Called by `lookup.ts` for each catalogue it consults, on the way past. It
 * returns nothing and cannot fail: a lookup must not care whether the record
 * was kept, and must not slow down or break because it was not.
 *
 * @param source the catalogue, spelled as `lookup_source` spells it
 * @param answered true when it replied at all, false when it did not reply
 * @param why one of the reasons `REASON` allows. Ignored when it answered
 */
export function noteSourceAnswer(source: string, answered: boolean, why = ''): void {
  const tally = tallyFor(source)
  tally.asked += 1

  if (answered) {
    tally.answered += 1
    tally.answering = true
    return
  }

  const reason = REASON.test(why) ? why : 'did not answer'
  const firstEver = tally.silent === 0
  const changed = reason !== tally.lastSilence
  const wentQuiet = tally.answering

  tally.silent += 1
  tally.lastSilentAt = new Date().toISOString()
  tally.lastSilence = reason
  tally.answering = false

  /*
   * Not once per request. A shelf is dozens of books and an exhausted quota
   * answers every one of them the same way, so a line per request is a line
   * nobody reads, and the tally would end up being the only thing anybody
   * looked at. A line on the first silence, on a change of reason, and whenever
   * a source that had been answering stops, is enough for the log to carry the
   * event and `/api/health` to carry the volume.
   *
   * The source name and the reason, and nothing else. Not the URL, not the
   * parameters, not the key, and not whether there is one.
   */
  if (firstEver || changed || wentQuiet) {
    console.warn(
      `[lookup] ${source} did not answer (${reason}). ` +
      'The lookup still returns whatever the other catalogue said. ' +
      'See /api/health for how often this has happened.',
    )
  }
}

/**
 * What every catalogue has done, for `/api/health`.
 *
 * A copy, in the order `CATALOGUES` names them, so a caller cannot reach in and
 * change a counter, and so the shape of the answer does not depend on which
 * source happened to be asked first.
 */
export function sourceStandings(): SourceStanding[] {
  const known = [...CATALOGUES] as string[]
  const rest = [...standings.keys()].filter((name) => !known.includes(name)).sort()

  return [...known, ...rest].map((name) => {
    const { source, asked, answered, silent, lastSilentAt, lastSilence } = tallyFor(name)
    return { source, asked, answered, silent, lastSilentAt, lastSilence }
  })
}

/** Back to a server that has looked nothing up. For tests. */
export function forgetSourceStandings(): void {
  standings.clear()
  for (const source of CATALOGUES) tallyFor(source)
}
