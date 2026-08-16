/**
 * The four things `failed` means, and the four different jobs they hand a
 * person (#148, and #299 for the fourth).
 *
 * The case that mattered was the second one: a barcode read cleanly, the digits
 * are on the row and they are right, and no catalogue has them. Home counted
 * that as needing an ISBN typed in, which sends somebody to retype a number
 * that is already correct.
 *
 * The fourth is the same mistake waiting to be made again from the other end. A
 * reading that was given up on has looked at nothing, so telling somebody it
 * "could not be read" sends them to a book whose photographs may be perfect.
 */

import { describe, expect, it } from 'vitest'
import {
  countFailures, couldBeReadAgain, failureOf, FAILURE_LABEL,
  noFailures, PROCESSING_ERROR_NOTE, READING_TIMEOUT_NOTE,
} from './captureFailure'

describe('what is wrong with a failed capture', () => {
  it('says no ISBN when the photographs yielded none', () => {
    expect(failureOf({
      isbn13: '',
      note: 'No ISBN could be read from these photos.',
    })).toBe('noIsbn')
  })

  it('says no catalogue has it when a barcode read but nothing knew the number', () => {
    // The five books in the issue. The worker keeps a barcode reading even
    // with no catalogue behind it, because a barcode is self-validating.
    expect(failureOf({
      isbn13: '9781234567897',
      note: 'Barcode on the back reads 9781234567897, but no catalogue has it.',
    })).toBe('uncatalogued')
  })

  it('says the read broke when the pass threw rather than finished', () => {
    expect(failureOf({
      isbn13: '',
      note: `${PROCESSING_ERROR_NOTE} out of memory`,
    })).toBe('errored')
  })

  it('calls a pass that threw broken even when it had already read an ISBN', () => {
    // A slot can be read before a later one throws. "It broke" is the more
    // useful thing to tell somebody about that capture.
    expect(failureOf({
      isbn13: '9781234567897',
      note: `${PROCESSING_ERROR_NOTE} decoder crashed`,
    })).toBe('errored')
  })

  it('says it timed out when the reader was given up on', () => {
    expect(failureOf({
      isbn13: '',
      note: `${READING_TIMEOUT_NOTE} the back was given up on after 60 seconds.`,
    })).toBe('timedOut')
  })

  it('calls an abandoned reading abandoned even when a slot had already read', () => {
    // The same argument as the case above it, one step further. A reading that
    // stopped on the front may have read the back cleanly first, and "no
    // catalogue has its ISBN" would send somebody to fill in a book by hand
    // when what it wants is another go at the reader.
    expect(failureOf({
      isbn13: '9781234567897',
      note: `${READING_TIMEOUT_NOTE} the front was given up on after 60 seconds.`,
    })).toBe('timedOut')
  })

  it('does not mistake an ordinary note for a broken read', () => {
    expect(failureOf({
      isbn13: '',
      note: 'Could not confirm an ISBN from the front. OCR read 9780000000002, '
        + 'which no catalogue has. Use Change ISBN.',
    })).toBe('noIsbn')
  })
})

describe('counting them', () => {
  const failed = [
    { isbn13: '', note: 'No ISBN could be read from these photos.' },
    { isbn13: '9781234567897', note: 'Barcode on the back reads it, no catalogue has it.' },
    { isbn13: '9789999999999', note: 'Barcode on the back reads it, no catalogue has it.' },
    { isbn13: '', note: `${PROCESSING_ERROR_NOTE} disk full` },
    { isbn13: '', note: `${READING_TIMEOUT_NOTE} the back was given up on.` },
  ]

  it('splits a single failed total into the four', () => {
    expect(countFailures(failed))
      .toEqual({ noIsbn: 1, uncatalogued: 2, errored: 1, timedOut: 1 })
  })

  it('counts nothing when nothing failed', () => {
    expect(countFailures([])).toEqual(noFailures)
  })
})

/**
 * What the app says about them, which is now said on the book rather than over
 * a list of them.
 *
 * These three were `failureLines`, the counted sentences the queue drew above
 * its books. #349 took that summary off, so they moved down here onto the words
 * a single capture gets, which is where the same protection now belongs. The
 * incident is unchanged and so are the assertions in substance: a book carrying
 * a good ISBN that no catalogue has must never be told to have one typed in.
 */
describe('what the app says about them', () => {
  const failed = (over: { isbn13?: string; note?: string }) =>
    FAILURE_LABEL[failureOf({ isbn13: '', note: '', ...over })]

  it('does not send anybody to type in an ISBN that is already there', () => {
    // The defect, stated as the books it was reported for: nine failures, five
    // of them with a good ISBN, and one sentence telling the person to type
    // nine. Each of the five now says what is actually wrong with it.
    const said = failed({
      isbn13: '9781234567897',
      note: 'Barcode on the back reads 9781234567897, but no catalogue has it.',
    })
    expect(said).toBe('no catalogue has its ISBN')
    expect(said).not.toContain('needs an ISBN')
  })

  it('names the job for each kind rather than one job for all of them', () => {
    expect(failed({ note: 'No ISBN could be read from these photos.' }))
      .toBe('needs an ISBN')
    expect(failed({
      isbn13: '9781234567897',
      note: 'Barcode on the back reads 9781234567897, but no catalogue has it.',
    })).toBe('no catalogue has its ISBN')
    expect(failed({ note: `${PROCESSING_ERROR_NOTE} out of memory` }))
      .toBe('could not be read')
    expect(failed({ note: `${READING_TIMEOUT_NOTE} the back was given up on.` }))
      .toBe('reading it took too long')

    // Four jobs, four sentences, none of them shared: the whole of #148 is that
    // two of these used to be the same words.
    expect(new Set(Object.values(FAILURE_LABEL)).size).toBe(4)
  })

  it('leaves the counting to the screens that count', () => {
    // The sentences these replaced left a kind out when it held nothing, so
    // that no line of a phone screen said "0 need an ISBN by hand". These
    // cannot have that problem at all: each is said on one book, by that book,
    // and a kind with nothing in it simply has no row. So none of them counts
    // anything, which is also #148's split held in one line: the count is the
    // first screen's, the diagnosis is the book's.
    for (const label of Object.values(FAILURE_LABEL)) {
      expect(label, `"${label}" counts books`).not.toMatch(/\d/)
    }
  })

  it('has a short form of each for the queue row', () => {
    // Every kind must have one: the row prints it in place of "needs you",
    // and a missing entry would leave a book saying nothing at all.
    expect(Object.values(FAILURE_LABEL).every((label) => label.length > 0)).toBe(true)
    expect(FAILURE_LABEL.uncatalogued).toBe('no catalogue has its ISBN')
  })
})

/**
 * Which failures are worth another reading, which is what decides whether the
 * queue offers a way back at all (#299).
 */
describe('what a second reading could fix', () => {
  const failed = (over: { isbn13?: string; note?: string }) =>
    ({ status: 'failed', isbn13: '', note: '', ...over })

  it('offers one whose reader was given up on', () => {
    expect(couldBeReadAgain(failed({
      note: `${READING_TIMEOUT_NOTE} the back was given up on after 60 seconds.`,
    }))).toBe(true)
  })

  it('offers one whose read threw, which says nothing about the book either', () => {
    expect(couldBeReadAgain(failed({ note: `${PROCESSING_ERROR_NOTE} disk full` })))
      .toBe(true)
  })

  it('does not offer one that needs an ISBN typing in', () => {
    // Reading it again produces the same answer. A button that does nothing is
    // worse than no button, because somebody presses it and waits.
    expect(couldBeReadAgain(failed({
      note: 'No ISBN could be read from these photos.',
    }))).toBe(false)
  })

  it('does not offer one whose ISBN read fine and which no catalogue has', () => {
    expect(couldBeReadAgain(failed({
      isbn13: '9781234567897',
      note: 'Barcode on the back reads it, but no catalogue has it.',
    }))).toBe(false)
  })

  it('does not offer one that is still being read, or one that is fine', () => {
    expect(couldBeReadAgain({ status: 'pending', isbn13: '', note: '' })).toBe(false)
    expect(couldBeReadAgain({ status: 'ready', isbn13: '', note: '' })).toBe(false)
    expect(couldBeReadAgain({ status: 'done', isbn13: '', note: '' })).toBe(false)
  })
})
