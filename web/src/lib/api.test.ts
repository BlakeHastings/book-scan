/**
 * The draft is the only thing that reaches the server, so a field the client
 * drops here is a field the catalogue never records. `isbnSource` went missing
 * exactly this way: every book catalogued at the camera was stored unable to
 * say whether its ISBN was decoded from a barcode or guessed at by OCR.
 */

import { describe, expect, it } from 'vitest'
import { draftFromBook, draftFromLookup } from './api'
import type { BookRow, LookupResponse } from './api'

const found: LookupResponse = {
  found: true,
  title: 'Dune',
  subtitle: '',
  authors: ['Frank Herbert'],
  publisher: 'Ace Books',
  published: '1965',
  pages: '412',
  isbn13: '9780441013593',
  isbn10: '0441013597',
  seriesName: '',
  seriesIndex: null,
  coverUrl: '',
  source: 'Open Library + Google Books',
  classification: { isFiction: true, confidence: 'high', reason: 'fiction subject' },
  notes: [],
  duplicateOf: null,
}

describe('draftFromLookup', () => {
  it('carries how the ISBN was read through to the draft', () => {
    expect(draftFromLookup(found, 'barcode').isbnSource).toBe('barcode')
    expect(draftFromLookup(found, 'ocr').isbnSource).toBe('ocr')
  })

  it('leaves the source empty when the caller does not know it', () => {
    expect(draftFromLookup(found).isbnSource).toBe('')
  })

  it('still fills everything the catalogue answered with', () => {
    const draft = draftFromLookup(found, 'barcode')
    expect(draft.isbn13).toBe('9780441013593')
    expect(draft.authors).toBe('Frank Herbert')
    expect(draft.lookupSource).toBe('Open Library + Google Books')
  })
})

describe('draftFromBook', () => {
  it('reads the stored source back, so editing does not erase it', () => {
    const book = { isbn_source: 'barcode', title: 'Dune' } as BookRow
    expect(draftFromBook(book).isbnSource).toBe('barcode')
  })
})
