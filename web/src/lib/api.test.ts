/**
 * The draft is the only thing that reaches the server, so a field the client
 * drops here is a field the catalogue never records. `isbnSource` went missing
 * exactly this way: every book catalogued at the camera was stored unable to
 * say whether its ISBN was decoded from a barcode or guessed at by OCR.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, draftFromBook, draftFromLookup, emptyDraft } from './api'
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

/**
 * The seam #61 lived in.
 *
 * The shelving step walks somebody to a shelf, names it, and is told the book
 * fits. That answer only reaches the catalogue if this call sends it: the PUT
 * cannot carry it, because the server deliberately refuses to let a metadata
 * edit move a book that a person placed by hand. Nothing else on the client
 * knows the label, so a regression here is silent until the library starts
 * reporting the move somebody has already made.
 */
describe('updateAndShelve', () => {
  interface Sent { url: string; method: string; body: unknown }

  /** Records what went out and answers every route with something plausible. */
  function captureFetch(): Sent[] {
    const sent: Sent[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      sent.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : null,
      })
      return new Response(JSON.stringify({ id: 7, book: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    return sent
  }

  afterEach(() => vi.unstubAllGlobals())

  it('records the shelf the person confirmed, through the location route', async () => {
    const sent = captureFetch()

    // The draft still carries the location the book was loaded with, which is
    // the stale one: it is where the book WAS, not where it has just been put.
    await api.updateAndShelve(7, { ...emptyDraft, title: 'Dune', location: '1A' }, '1B')

    expect(sent.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT /api/books/7',
      'PATCH /api/books/7/location',
    ])
    expect((sent[1]?.body as { location: string }).location).toBe('1B')
  })

  it('says nothing about the location when no one has been to a shelf', async () => {
    const sent = captureFetch()

    await api.updateAndShelve(7, { ...emptyDraft, title: 'Dune', location: '1A' }, '')

    expect(sent).toHaveLength(1)
    expect(sent[0]?.method).toBe('PUT')
  })
})
