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
  countFailures, couldBeReadAgain, failureLines, failureOf, FAILURE_LABEL,
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

describe('what Home says about them', () => {
  it('does not send anybody to type in an ISBN that is already there', () => {
    // The defect, stated as the sentence it produced: nine failures, five of
    // them with a good ISBN, and one line telling the person to type nine.
    const lines = failureLines({ noIsbn: 4, uncatalogued: 5, errored: 0, timedOut: 0 })
    expect(lines).toContain('4 need an ISBN by hand.')
    expect(lines.join(' ')).not.toContain('9 need an ISBN')
  })

  it('names the job for each kind rather than one job for all of them', () => {
    expect(failureLines({ noIsbn: 1, uncatalogued: 2, errored: 3, timedOut: 4 })).toEqual([
      '1 need an ISBN by hand.',
      '2 need details by hand. No catalogue has their ISBN.',
      '3 hit an error while being read.',
      '4 timed out while being read. Nothing is wrong with the photographs; '
      + 'read them again.',
    ])
  })

  it('leaves out a kind with nothing in it', () => {
    expect(failureLines({ noIsbn: 0, uncatalogued: 3, errored: 0, timedOut: 0 }))
      .toEqual(['3 need details by hand. No catalogue has their ISBN.'])
    expect(failureLines(noFailures)).toEqual([])
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
