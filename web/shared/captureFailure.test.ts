/** The four things `failed` means, and the four different jobs they hand a person. */

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
    // The worker keeps a barcode reading even with no catalogue behind it: a barcode is self-validating.
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
    // "It broke" is more useful than "no catalogue has it" once any slot threw.
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
    // A reading that stopped may have read a slot cleanly first; "no catalogue has it" would send somebody to type it in by hand instead of rereading.
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

/** Per-book labels; there is no separate counted summary any more. */
describe('what the app says about them', () => {
  const failed = (over: { isbn13?: string; note?: string }) =>
    FAILURE_LABEL[failureOf({ isbn13: '', note: '', ...over })]

  it('does not send anybody to type in an ISBN that is already there', () => {
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

    // Four jobs, four distinct sentences: none shared.
    expect(new Set(Object.values(FAILURE_LABEL)).size).toBe(4)
  })

  it('leaves the counting to the screens that count', () => {
    // Each label is said per book, so none of them count anything; counting is the screen's job, not the label's.
    for (const label of Object.values(FAILURE_LABEL)) {
      expect(label, `"${label}" counts books`).not.toMatch(/\d/)
    }
  })

  it('has a short form of each for the queue row', () => {
    // A missing label would leave a book's queue row saying nothing at all.
    expect(Object.values(FAILURE_LABEL).every((label) => label.length > 0)).toBe(true)
    expect(FAILURE_LABEL.uncatalogued).toBe('no catalogue has its ISBN')
  })
})

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
    // Reading again produces the same answer; a button that does nothing is worse than no button.
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
