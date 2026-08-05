/**
 * The three things `failed` means, and the three different jobs they hand a
 * person (#148).
 *
 * The case that mattered was the middle one: a barcode read cleanly, the digits
 * are on the row and they are right, and no catalogue has them. Home counted
 * that as needing an ISBN typed in, which sends somebody to retype a number
 * that is already correct.
 */

import { describe, expect, it } from 'vitest'
import {
  countFailures, failureLines, failureOf, FAILURE_LABEL, noFailures,
  PROCESSING_ERROR_NOTE,
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
  ]

  it('splits a single failed total into the three', () => {
    expect(countFailures(failed)).toEqual({ noIsbn: 1, uncatalogued: 2, errored: 1 })
  })

  it('counts nothing when nothing failed', () => {
    expect(countFailures([])).toEqual(noFailures)
  })
})

describe('what Home says about them', () => {
  it('does not send anybody to type in an ISBN that is already there', () => {
    // The defect, stated as the sentence it produced: nine failures, five of
    // them with a good ISBN, and one line telling the person to type nine.
    const lines = failureLines({ noIsbn: 4, uncatalogued: 5, errored: 0 })
    expect(lines).toContain('4 need an ISBN by hand.')
    expect(lines.join(' ')).not.toContain('9 need an ISBN')
  })

  it('names the job for each kind rather than one job for all of them', () => {
    expect(failureLines({ noIsbn: 1, uncatalogued: 2, errored: 3 })).toEqual([
      '1 need an ISBN by hand.',
      '2 need details by hand. No catalogue has their ISBN.',
      '3 hit an error while being read.',
    ])
  })

  it('leaves out a kind with nothing in it', () => {
    expect(failureLines({ noIsbn: 0, uncatalogued: 3, errored: 0 }))
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
