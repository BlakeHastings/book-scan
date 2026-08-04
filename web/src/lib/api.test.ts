/**
 * The draft is the only thing that reaches the server, so a field the client
 * drops here is a field the catalogue never records. `isbnSource` went missing
 * exactly this way: every book catalogued at the camera was stored unable to
 * say whether its ISBN was decoded from a barcode or guessed at by OCR.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  api, draftFromBook, draftFromCapture, draftFromLookup, editFromDraft, emptyDraft,
} from './api'
import type { BookRow, Capture, LookupResponse } from './api'

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
 * The reading half of the handoff in #65: what the worker read off the
 * photographs, with what a person worked out laid on top of it.
 */
describe('draftFromCapture', () => {
  const capture = (fields: Partial<Capture>): Capture => ({
    id: 1, status: 'ready', front_image: '', back_image: '', edge_image: '',
    isbn13: '', isbn10: '', isbn_source: '', title_guess: '', cover_text: '',
    analysed: '', draft_json: '', edit_json: '', edited_by: '', edited_at: null,
    note: '', claimed_by: '', claimed_at: null, book_id: null,
    created_at: '', processed_at: null, ...fields,
  })

  it('shows the worker\'s reading when nobody has said anything', () => {
    const draft = draftFromCapture(capture({
      draft_json: JSON.stringify(found), isbn_source: 'barcode',
    }))
    expect(draft.title).toBe('Dune')
    expect(draft.isbnSource).toBe('barcode')
  })

  it('lets a person\'s correction win over the worker, field by field', () => {
    const draft = draftFromCapture(capture({
      draft_json: JSON.stringify(found),
      isbn_source: 'barcode',
      edit_json: JSON.stringify({ title: 'Dune Messiah', isbnSource: 'manual' }),
    }))

    expect(draft.title).toBe('Dune Messiah')
    expect(draft.isbnSource).toBe('manual')
    // Untouched fields still come from the lookup underneath.
    expect(draft.authors).toBe('Frank Herbert')
    expect(draft.publisher).toBe('Ace Books')
  })

  it('survives a corrupt column rather than taking the page down with it', () => {
    const draft = draftFromCapture(capture({
      draft_json: '{not json', edit_json: '{not json either', title_guess: 'Dune',
    }))
    expect(draft.title).toBe('Dune')
  })
})

/**
 * Only what changed is claimed as a person's decision. Sending the whole draft
 * would tell the server that every field was decided by a human and shut the
 * background worker out of a capture because somebody fixed one word.
 */
describe('editFromDraft', () => {
  const shown = { ...emptyDraft, title: 'Dune', authors: 'Frank Herbert' }

  it('sends nothing when nothing changed', () => {
    expect(editFromDraft(shown, shown)).toEqual({})
  })

  it('sends only the field that changed', () => {
    const edit = editFromDraft({ ...shown, title: 'Dune Messiah' }, shown)
    expect(edit).toEqual({ title: 'Dune Messiah' })
  })

  it('splits authors back apart, the way the server stores them', () => {
    const edit = editFromDraft({ ...shown, authors: 'Frank Herbert, Brian Herbert' }, shown)
    expect(edit.authors).toEqual(['Frank Herbert', 'Brian Herbert'])
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
