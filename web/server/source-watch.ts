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
 * **And two is still not enough of a distinction.** The first version of this
 * file drew that line and stopped, which left two pairs still folded together
 * and both pairs mattering. A catalogue that replied and held the book and one
 * that replied and had never heard of it were both `answered`, so a source that
 * has contributed nothing at all looked exactly like a source doing its job. A
 * catalogue that refused to serve and one that failed to reply were both
 * `silent`, distinguishable only by `lastSilence` and therefore only for the
 * most recent one. Those are the four states somebody needs told apart, and
 * `SourceStanding` below now reports them separately, with the fifth — a
 * catalogue that was never asked at all — as the nought it always was.
 *
 * The reason the last one matters most: the second catalogue in this
 * application has been refusing every request since before anybody was
 * counting, and "refused" is answered by configuration this afternoon, while
 * "failed" is answered by waiting. One number cannot mean both.
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
 * - **The read record is a screen**, and it had to become one. The two above
 *   are for somebody at a terminal, the log line is printed once per outage,
 *   and #521 put `/api/health` behind the sign-in gate, so the whole of this
 *   was legible only to a signed-in `curl`. The owner holds a phone.
 *   `src/lib/catalogueWords.ts` turns this into the card on the first screen
 *   and the standings in Settings, and carries the argument about which fact
 *   goes on which.
 *
 * A table in Postgres was the other option and it is not proportionate. This is
 * a fact about a running server rather than about the collection, and a
 * migration to hold a counter that resets on restart anyway buys nothing.
 */

/**
 * The two SRU catalogues #305 added, spelled once, and spelled here.
 *
 * `catalogue-sru.ts` owns everything else about them: the endpoint, the CQL
 * index, the rate, the terms. It cannot own the names as well, because this file
 * has to stand a tally up for them as it is imported, and a name imported from a
 * module that imports this one back is a cycle whose resolution order decides
 * whether `CATALOGUES` exists yet. One spelling, at the end the other end can
 * safely import from.
 */
export const LIBRARY_OF_CONGRESS_NAME = 'Library of Congress'
export const K10PLUS_NAME = 'K10plus'

/**
 * The catalogues `lookupIsbn` consults, named so a standing exists before the
 * first request is made.
 *
 * **The last two are asked about some books and not others** (#305), which the
 * report shows as a low `asked` rather than by leaving them out. They are a
 * top-up for a book the first two left without a page count or a genre, so a
 * server that has looked up forty books and asked Library of Congress about nine
 * of them is working exactly as intended, and `asked: 0` after a long session
 * means the first two have answered everything.
 *
 * That is the point of listing them rather than letting the map fill in as
 * requests happen. "Google Books was asked forty times and answered none" and
 * "Google Books is not in this report" read very differently, and the second is
 * indistinguishable from a server nobody has looked a book up on yet. That
 * ambiguity is the exact shape of the defect this file exists for.
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
 * A refusal is not a failure, and the difference is the whole of what a person
 * does next. An exhausted quota or a rejected credential is answered by
 * configuration, and answered today; a timeout or an unreachable host is
 * answered by waiting, and there is nothing to configure. Folded together, as
 * they were until this list existed, "Google Books has been silent forty times"
 * could not tell the owner which of those two afternoons he was having.
 *
 * Derived from `why` rather than passed in, so it can only ever be one of the
 * strings `REASON` already vets. Nothing here reads a response body, and
 * widening this list may not either.
 */
const DECLINED = new Set(['HTTP 401', 'HTTP 403', 'HTTP 429'])

/**
 * What one catalogue did with one request, said by the only code that knows.
 *
 * Three outcomes and not two, and the third has to come from the caller because
 * `bounded-fetch.ts` cannot see it: whether the reply had this book in it. A
 * reply is a reply either way, so both count as `answered`, but "Open Library
 * answered 238 times" and "Open Library answered 238 times and held 232 of the
 * books" are different claims, and only the second one can be checked against a
 * collection.
 *
 * **There is deliberately no default.** A caller that does not say which of the
 * three happened does not compile, because a silent default is the exact defect
 * this file exists to end: the unsaid case reads as the ordinary one.
 */
export type SourceOutcome =
  /** It replied and had a record of this book. */
  | 'record'
  /** It replied and has no record of this book. Ordinary, and not a failure. */
  | 'no record'
  /** It did not reply at all. `why` says whether it refused or simply failed. */
  | 'no reply'

/**
 * What one catalogue has done since this server started.
 *
 * **Five things can happen to a source and this reports all five**, because
 * four of them are the same `null` from the outside, and somebody looking at a
 * book with no cover and no page count needs to know which one happened:
 *
 * | What happened | How it reads here |
 * | --- | --- |
 * | It was never asked | `asked` and `skipped` both nought |
 * | It was wanted and not asked, to stay inside its rate | `skipped` above nought |
 * | It was asked and refused to serve | `declined` above nought |
 * | It was asked and failed | `failed` above nought |
 * | It was asked and genuinely has no record | `noRecord` above nought |
 *
 * `asked`, `answered` and `silent` are the coarse three, kept because things
 * read them. They are sums of the finer ones and nothing else:
 * `answered = held + noRecord`, `silent = declined + failed`, and
 * `asked = answered + silent`. Nothing recomputes them on the way out; they are
 * incremented beside the finer ones in the one place that increments anything,
 * and a test holds the sums.
 */
export interface SourceStanding {
  /** The catalogue, spelled as `lookup_source` spells it. */
  source: string
  /** Requests made to it. */
  asked: number
  /** Requests it replied to, whether or not it had the book. */
  answered: number
  /** Requests it did not reply to at all. */
  silent: number
  /**
   * Replies that had a record of the book asked about.
   *
   * The number that says a catalogue is earning its request. A source missing a
   * key, holding a different kind of collection, or not indexing the ISBN form
   * it was handed, sits at `held: 0` with a perfectly healthy `answered`, and
   * until this existed that was indistinguishable from a source doing its job.
   */
  held: number
  /**
   * Replies that had no record of the book asked about.
   *
   * **Not a failure and not counted as one.** Open Library has no record of six
   * of the 238 books in the real catalogue, and that is a fact about those
   * books rather than about the request. It is split out from `held` rather
   * than out of `answered` for exactly that reason.
   */
  noRecord: number
  /**
   * Requests the catalogue heard and refused to serve: 401, 403 or 429.
   *
   * The one this issue was about. Every Google Books request in the life of the
   * real catalogue has come back 429 from Google's shared anonymous pool, so
   * this is the counter a missing key moves, and it is the one to read beside
   * `googleBooksKeyConfigured`.
   */
  declined: number
  /**
   * Requests that did not reply for any other reason: a timeout, an unreachable
   * host, or a status that is not a refusal.
   *
   * Nothing anybody configures fixes this one, which is precisely why it must
   * not be the same number as `declined`.
   */
  failed: number
  /**
   * Times this catalogue was wanted and not asked, to stay inside its rate (#305).
   *
   * Deliberately not counted as `asked` and deliberately not counted as
   * `silent`. Nothing was sent, so the catalogue did nothing and owes no
   * explanation; the decision was this application's. It is a number worth
   * having separately because it is the one that says the limiter in
   * `source-pace.ts` is costing answers, which is the failure mode a rate limit
   * has, and it would be invisible folded into either of the other two.
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
 * Record what one catalogue did with one request.
 *
 * Called by `lookup.ts` for each catalogue it consults, on the way past. It
 * returns nothing and cannot fail: a lookup must not care whether the record
 * was kept, and must not slow down or break because it was not.
 *
 * **Called after the reply has been read, not before.** Whether there was a
 * record of this book is the one thing `bounded-fetch.ts` cannot see, so the
 * call moved down past the parse in every caller. Nothing else moved with it:
 * the reply is still not allowed to change what the lookup returns.
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
 * The outcome, from the two booleans every caller already has.
 *
 * `answered` comes from `bounded-fetch.ts` and `held` from whatever that caller
 * does with the body, and the two are always decided in different places. This
 * exists so the joining of them is written once: a caller that wrote
 * `answered ? 'record' : 'no reply'` by hand would count every book a catalogue
 * has never heard of as an outage, which is the mistake this whole file is
 * about, in miniature.
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
 *
 * Called by `catalogue-sru.ts` when `source-pace.ts` declines a slot inside the
 * caller's deadline. Like `noteSourceAnswer` it returns nothing and cannot fail.
 *
 * @param source the catalogue, spelled as `lookup_source` spells it
 */
export function noteSourceSkipped(source: string): void {
  tallyFor(source).skipped += 1
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
