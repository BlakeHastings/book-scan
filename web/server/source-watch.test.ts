/**
 * The record itself (#348).
 *
 * `lookup-sources.test.ts` beside this one drives it through a real lookup
 * against real HTTP servers, which is what proves the wiring. What is here is
 * the thing being wired: the distinction between a source with nothing to say
 * and a source that said nothing, the closed vocabulary that keeps an API key
 * out of a diagnostic, and the decision not to log a line per request.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CATALOGUES, forgetSourceStandings, noteSourceAnswer, noteSourceSkipped, outcomeOf,
  sourceStandings,
} from './source-watch'

const standingFor = (source: string) =>
  sourceStandings().find((one) => one.source === source)!

beforeEach(() => {
  forgetSourceStandings()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('what a server that has looked nothing up reports', () => {
  it('names every catalogue at nought rather than leaving them out', () => {
    /*
     * The whole point of the seeded list. "Google Books was asked and answered
     * nothing" and "Google Books is not in this report" are different facts,
     * and an absent entry reads as the second while meaning the first. That
     * ambiguity is the defect this file exists for, so it must not be possible
     * to reintroduce it by reporting only what happened to be asked.
     */
    const report = sourceStandings()
    expect(report.map((one) => one.source)).toEqual([...CATALOGUES])
    for (const one of report) {
      expect(one).toMatchObject({ asked: 0, answered: 0, silent: 0, lastSilence: '' })
    }
  })
})

describe('a source with nothing to say is not a source that said nothing', () => {
  it('counts a catalogue that answered and had no record as having answered', () => {
    // Open Library has no record of six of the 238 books in the real
    // catalogue. That is a fact about those books, not about the request, and
    // recording it as a failure would make the report useless for finding the
    // real one.
    noteSourceAnswer('Open Library', 'no record')
    noteSourceAnswer('Open Library', 'no record')

    expect(standingFor('Open Library')).toMatchObject({
      asked: 2, answered: 2, silent: 0, lastSilentAt: '', lastSilence: '',
    })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('counts a catalogue that did not reply, and says when and why', () => {
    noteSourceAnswer('Google Books', 'no reply', 'HTTP 429')

    const standing = standingFor('Google Books')
    expect(standing).toMatchObject({ asked: 1, answered: 0, silent: 1, lastSilence: 'HTTP 429' })
    expect(Date.parse(standing.lastSilentAt)).not.toBeNaN()
  })
})

describe('the reason a source gives', () => {
  it('accepts the three shapes lookup.ts produces', () => {
    noteSourceAnswer('Google Books', 'no reply', 'HTTP 503')
    expect(standingFor('Google Books').lastSilence).toBe('HTTP 503')

    noteSourceAnswer('Google Books', 'no reply', 'timed out')
    expect(standingFor('Google Books').lastSilence).toBe('timed out')

    noteSourceAnswer('Google Books', 'no reply', 'unreachable')
    expect(standingFor('Google Books').lastSilence).toBe('unreachable')
  })

  it('refuses anything else, because this reaches a log and /api/health', () => {
    /*
     * The Google Books request carries the API key in its query string. A
     * reason built by stringifying an error, a response or a URL would carry
     * the key into the log and into the health endpoint, which is precisely the
     * diagnostic #348 says must never hold one. So the vocabulary is closed and
     * checked here rather than trusted from the caller, and a caller that
     * widens it gets "did not answer" instead of a leak.
     */
    noteSourceAnswer('Google Books', 'no reply', 'https://www.googleapis.com/books/v1/volumes?key=SEKRIT')

    const standing = standingFor('Google Books')
    expect(standing.lastSilence).toBe('did not answer')
    expect(JSON.stringify(sourceStandings())).not.toContain('SEKRIT')
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).not.toContain('SEKRIT')
  })
})

describe('what reaches the log', () => {
  it('says it once, not once per book', () => {
    // A shelf is dozens of books and an exhausted quota answers every one of
    // them the same way. A line per request is a line nobody reads.
    for (let i = 0; i < 40; i += 1) noteSourceAnswer('Google Books', 'no reply', 'HTTP 429')

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(standingFor('Google Books').silent).toBe(40)
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain('Google Books did not answer (HTTP 429)')
  })

  it('says it again when the reason changes', () => {
    noteSourceAnswer('Google Books', 'no reply', 'HTTP 429')
    noteSourceAnswer('Google Books', 'no reply', 'timed out')

    expect(console.warn).toHaveBeenCalledTimes(2)
  })

  it('says it again when a source that had been answering stops', () => {
    noteSourceAnswer('Open Library', 'no reply', 'HTTP 503')
    noteSourceAnswer('Open Library', 'record')
    noteSourceAnswer('Open Library', 'no reply', 'HTTP 503')

    // Same reason both times, so only the recovery in between earns the second
    // line. An outage that ends and starts again is two outages.
    expect(console.warn).toHaveBeenCalledTimes(2)
    expect(standingFor('Open Library')).toMatchObject({ asked: 3, answered: 1, silent: 2 })
  })

  it('never says whether there is a key, let alone what it is', () => {
    noteSourceAnswer('Google Books', 'no reply', 'HTTP 429')

    const said = vi.mocked(console.warn).mock.calls.flat().join(' ')
    expect(said).not.toMatch(/key/i)
    expect(said).toContain('the other catalogue')
  })
})

describe('a catalogue that was wanted and not asked (#305)', () => {
  it('is neither an answer nor a silence, and says nothing in the log', () => {
    /*
     * The third thing that can happen to a source, added when two of them came
     * with a rate limit. Nothing was sent, so the catalogue did nothing: folded
     * into `silent` this would read as a library being down, and folded into
     * `asked` it would read as a request that was made. It is also not worth a
     * line in the log, because unlike a source going quiet it is a decision this
     * process made on purpose and can explain from the counter alone.
     */
    noteSourceSkipped('Library of Congress')
    noteSourceSkipped('Library of Congress')

    expect(standingFor('Library of Congress')).toMatchObject({
      asked: 0, answered: 0, silent: 0, skipped: 2, lastSilentAt: '', lastSilence: '',
    })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('does not disturb what the same catalogue has answered', () => {
    noteSourceAnswer('K10plus', 'record')
    noteSourceSkipped('K10plus')
    noteSourceAnswer('K10plus', 'record')

    expect(standingFor('K10plus')).toMatchObject({ asked: 2, answered: 2, skipped: 1 })
  })
})

describe('a refusal is not a failure', () => {
  /*
   * The pair that was folded together until this existed. Both are "the
   * catalogue did not reply", and `lastSilence` told them apart only for the
   * most recent one, so a source that had refused thirty-nine times and timed
   * out once reported a timeout. What a person does next differs completely:
   * a refusal is answered by configuration this afternoon, and a failure is
   * answered by waiting.
   */
  it('counts the three statuses that mean "I heard you and I will not"', () => {
    for (const status of ['HTTP 401', 'HTTP 403', 'HTTP 429']) {
      noteSourceAnswer('Google Books', 'no reply', status)
    }

    expect(standingFor('Google Books')).toMatchObject({
      asked: 3, silent: 3, declined: 3, failed: 0,
    })
  })

  it('counts everything else that did not reply as a failure', () => {
    noteSourceAnswer('Open Library', 'no reply', 'HTTP 500')
    noteSourceAnswer('Open Library', 'no reply', 'HTTP 502')
    noteSourceAnswer('Open Library', 'no reply', 'timed out')
    noteSourceAnswer('Open Library', 'no reply', 'unreachable')

    expect(standingFor('Open Library')).toMatchObject({
      asked: 4, silent: 4, declined: 0, failed: 4,
    })
  })

  it('keeps them apart even when the older one is not the last one', () => {
    // The case `lastSilence` alone cannot report, and the reason a counter had
    // to exist rather than a wider vocabulary on the string.
    for (let i = 0; i < 39; i += 1) noteSourceAnswer('Google Books', 'no reply', 'HTTP 429')
    noteSourceAnswer('Google Books', 'no reply', 'timed out')

    expect(standingFor('Google Books')).toMatchObject({
      silent: 40, declined: 39, failed: 1, lastSilence: 'timed out',
    })
  })

  it('files an unrecognised reason as a failure rather than as a refusal', () => {
    // It became "did not answer" on the way in, which is not in `DECLINED`, so
    // it cannot become a claim that somebody's key would fix it.
    noteSourceAnswer('Google Books', 'no reply', 'the server said something odd')

    expect(standingFor('Google Books')).toMatchObject({
      silent: 1, declined: 0, failed: 1, lastSilence: 'did not answer',
    })
  })
})

describe('a reply that held the book is not a reply that did not', () => {
  it('splits what a catalogue answered into what it actually had', () => {
    noteSourceAnswer('Google Books', 'record')
    noteSourceAnswer('Google Books', 'no record')
    noteSourceAnswer('Google Books', 'no record')

    // Same `answered` a keyed catalogue holding every book would report, which
    // is why `answered` alone could never say whether one was earning its
    // request.
    expect(standingFor('Google Books')).toMatchObject({
      asked: 3, answered: 3, held: 1, noRecord: 2, silent: 0,
    })
  })

  it('says which of the three happened, from the two booleans a caller holds', () => {
    expect(outcomeOf(true, true)).toBe('record')
    expect(outcomeOf(true, false)).toBe('no record')
    expect(outcomeOf(false, false)).toBe('no reply')

    // A caller cannot report a book it took from a catalogue that never
    // replied, so this pairing is the one that must not quietly mean "record".
    expect(outcomeOf(false, true)).toBe('no reply')
  })
})

describe('the coarse three stay the sums of the finer ones', () => {
  it('holds after every kind of thing that can happen to a source', () => {
    /*
     * `asked`, `answered` and `silent` are read by things written before the
     * finer counters existed, including the sentence in AGENTS.md. They are
     * incremented beside the finer ones rather than derived on the way out, so
     * this is the test that stops the two halves drifting.
     */
    for (const outcome of ['record', 'record', 'no record'] as const) {
      noteSourceAnswer('K10plus', outcome)
    }
    noteSourceAnswer('K10plus', 'no reply', 'HTTP 429')
    noteSourceAnswer('K10plus', 'no reply', 'timed out')
    noteSourceSkipped('K10plus')

    const standing = standingFor('K10plus')

    expect(standing.answered).toBe(standing.held + standing.noRecord)
    expect(standing.silent).toBe(standing.declined + standing.failed)
    expect(standing.asked).toBe(standing.answered + standing.silent)

    // And `skipped` is in none of them, because nothing was sent.
    expect(standing).toMatchObject({ asked: 5, answered: 3, silent: 2, skipped: 1 })
  })
})

describe('the report handed to /api/health', () => {
  it('is a copy, so a reader cannot change a counter through it', () => {
    noteSourceAnswer('Open Library', 'record')
    sourceStandings()[0]!.asked = 999

    expect(standingFor('Open Library').asked).toBe(1)
  })

  it('keeps the catalogues in a fixed order whichever was asked first', () => {
    noteSourceAnswer('Google Books', 'record')
    noteSourceAnswer('Open Library', 'record')

    expect(sourceStandings().map((one) => one.source)).toEqual([...CATALOGUES])
  })
})
