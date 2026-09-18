/**
 * Whether the catalogues a lookup consults actually answered.
 *
 * A source that answers and has no record of the book is not a failure: that is
 * a fact about the book rather than about the request. A source that does not
 * answer is a different thing, and one that refused to serve is a third, because
 * a refusal is answered by configuration and a failure only by waiting.
 * `SourceStanding` below reports all of them separately.
 *
 * Nothing here throws and nothing here is awaited by a lookup: a catalogue being
 * down must not stop somebody cataloguing a book. The record lives in this
 * process and starts empty on every restart, so the durable record is the
 * `console.warn` line printed when a source first goes quiet, and the readable
 * one is `/api/health` and the screens `src/lib/catalogueWords.ts` builds from it.
 */

/**
 * The two SRU catalogue names, spelled here rather than in `catalogue-sru.ts`,
 * which owns everything else about them. This file stands a tally up for them as
 * it is imported, and a name imported from a module that imports this one back is
 * a cycle whose resolution order decides whether `CATALOGUES` exists yet.
 */
export const LIBRARY_OF_CONGRESS_NAME = 'Library of Congress'
export const K10PLUS_NAME = 'K10plus'

/**
 * The catalogues `lookupIsbn` consults, named so a standing exists before the
 * first request is made: "asked forty times and answered none" and "not in this
 * report" read very differently, and the second is indistinguishable from a
 * server nobody has looked a book up on yet.
 *
 * The last two are asked about some books and not others, as a top-up for a book
 * the first two left without a page count or a genre, so a low `asked` for them
 * is working as intended.
 */
export const CATALOGUES = [
  'Open Library', 'Google Books', LIBRARY_OF_CONGRESS_NAME, K10PLUS_NAME,
] as const

/**
 * The reasons a source is allowed to give for not answering.
 *
 * A closed vocabulary, checked rather than trusted, because this string reaches
 * `/api/health` and the log, and the Google Books request carries the API key in
 * its query string. A reason built by stringifying an error, a request or a URL
 * would put the key in both. Nothing may widen this to free text.
 */
const REASON = /^(HTTP \d{3}|timed out|unreachable)$/

/**
 * The statuses that mean the catalogue heard the request and would not serve it.
 *
 * Derived from `why` rather than passed in, so it can only ever be one of the
 * strings `REASON` already vets. Nothing here reads a response body, and
 * widening this list may not either.
 */
const DECLINED = new Set(['HTTP 401', 'HTTP 403', 'HTTP 429'])

/**
 * What one catalogue did with one request.
 *
 * Whether the reply had this book in it has to come from the caller, because
 * `bounded-fetch.ts` cannot see it. There is deliberately no default: a caller
 * that does not say which of the three happened does not compile.
 */
export type SourceOutcome =
  | 'record'
  /** It replied and has no record of this book. Ordinary, and not a failure. */
  | 'no record'
  /** It did not reply at all. `why` says whether it refused or simply failed. */
  | 'no reply'

/**
 * What one catalogue has done since this server started.
 *
 * `asked`, `answered` and `silent` are sums of the finer counters and nothing
 * else: `answered = held + noRecord`, `silent = declined + failed`, and
 * `asked = answered + silent`. Nothing recomputes them on the way out; they are
 * incremented beside the finer ones in the one place that increments anything.
 */
export interface SourceStanding {
  /** The catalogue, spelled as `lookup_source` spells it. */
  source: string
  asked: number
  /** Requests it replied to, whether or not it had the book. */
  answered: number
  silent: number
  /** Replies that had a record of the book asked about. */
  held: number
  /** Replies that had no record of the book asked about. Not a failure. */
  noRecord: number
  /** Requests the catalogue heard and refused to serve: 401, 403 or 429. */
  declined: number
  /**
   * Requests that did not reply for any other reason: a timeout, an unreachable
   * host, or a status that is not a refusal. Nothing anybody configures fixes
   * this one, which is why it must not be the same number as `declined`.
   */
  failed: number
  /**
   * Times this catalogue was wanted and not asked, to stay inside its rate.
   * Counted as neither `asked` nor `silent`, because nothing was sent and the
   * decision was this application's. It is the number that says the limiter in
   * `source-pace.ts` is costing answers.
   */
  skipped: number
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
  const standing = standings.get(source)
  if (standing) return standing

  const fresh: Tally = {
    source,
    asked: 0,
    answered: 0,
    silent: 0,
    held: 0,
    noRecord: 0,
    declined: 0,
    failed: 0,
    skipped: 0,
    lastSilentAt: '',
    lastSilence: '',
    answering: true,
  }
  standings.set(source, fresh)
  return fresh
}

for (const source of CATALOGUES) tallyFor(source)

/**
 * Record what one catalogue did with one request. It returns nothing and cannot
 * fail: a lookup must not slow down or break because the record was not kept.
 *
 * Call it after the reply has been read, not before, because whether there was a
 * record of this book is the one thing `bounded-fetch.ts` cannot see.
 *
 * @param source the catalogue, spelled as `lookup_source` spells it
 * @param outcome which of the three things happened. There is no default
 * @param why one of the reasons `REASON` allows. Ignored unless it did not reply
 */
export function noteSourceAnswer(
  source: string,
  outcome: SourceOutcome,
  why = '',
): void {
  const tally = tallyFor(source)
  tally.asked += 1

  if (outcome !== 'no reply') {
    tally.answered += 1
    if (outcome === 'record') tally.held += 1
    else tally.noRecord += 1
    tally.answering = true
    return
  }

  const reason = REASON.test(why) ? why : 'did not answer'
  const firstEver = tally.silent === 0
  const changed = reason !== tally.lastSilence
  const wentQuiet = tally.answering

  tally.silent += 1
  if (DECLINED.has(reason)) tally.declined += 1
  else tally.failed += 1
  tally.lastSilentAt = new Date().toISOString()
  tally.lastSilence = reason
  tally.answering = false

  /*
   * Not once per request. An exhausted quota answers every book of a shelf the
   * same way, so a line per request is a line nobody reads. One on the first
   * silence, on a change of reason, and whenever a source that had been answering
   * stops, is enough for the log to carry the event and `/api/health` the volume.
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
 * The outcome, from the two booleans every caller already has. The joining is
 * written once here: a caller that wrote `answered ? 'record' : 'no reply'` by
 * hand would count every book a catalogue has never heard of as an outage.
 *
 * @param answered whether the catalogue replied at all
 * @param held whether the reply had a record of the book asked about
 */
export function outcomeOf(answered: boolean, held: boolean): SourceOutcome {
  if (!answered) return 'no reply'
  return held ? 'record' : 'no record'
}

/**
 * Record that a catalogue was wanted and not asked, to stay inside its rate.
 * Like `noteSourceAnswer` it returns nothing and cannot fail.
 *
 * @param source the catalogue, spelled as `lookup_source` spells it
 */
export function noteSourceSkipped(source: string): void {
  tallyFor(source).skipped += 1
}

/**
 * What every catalogue has done, for `/api/health`. A copy, in the order
 * `CATALOGUES` names them, so a caller cannot reach in and change a counter, and
 * so the shape of the answer does not depend on which source was asked first.
 */
export function sourceStandings(): SourceStanding[] {
  const known = [...CATALOGUES] as string[]
  const rest = [...standings.keys()].filter((name) => !known.includes(name)).sort()

  return [...known, ...rest].map((name) => {
    const {
      source, asked, answered, silent, held, noRecord, declined, failed, skipped,
      lastSilentAt, lastSilence,
    } = tallyFor(name)
    return {
      source, asked, answered, silent, held, noRecord, declined, failed, skipped,
      lastSilentAt, lastSilence,
    }
  })
}

/** Back to a server that has looked nothing up. For tests. */
export function forgetSourceStandings(): void {
  standings.clear()
  for (const source of CATALOGUES) tallyFor(source)
}
