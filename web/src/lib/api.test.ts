/**
 * The draft is the only thing that reaches the server, so a field the client
 * drops here is a field the catalogue never records. `isbnSource` went missing
 * exactly this way: every book catalogued at the camera was stored unable to
 * say whether its ISBN was decoded from a barcode or guessed at by OCR.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Refusal, api, captureName, draftFromBook, draftFromCapture, draftFromLookup,
  editFromDraft, emptyDraft, whenTheGateRefuses, withReadIsbn,
} from './api'
import type { BookRow, Capture, LookupResponse } from './api'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'

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
  classification: { genre: FICTION_SLUG, confidence: 'high', reason: 'fiction subject' },
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
    created_at: '', processed_at: null,
    front_crop: '', back_crop: '', edge_crop: '', cropped: '', ...fields,
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
      isbn13: '9780441013593',
    }))
    // Nothing readable, so nothing claimed: the row's own ISBN column comes
    // through and the rest is empty rather than the page being taken down.
    expect(draft.title).toBe('')
    expect(draft.isbn13).toBe('9780441013593')
  })

  /*
   * #156. The Title box is filled from this draft and Save writes the draft to
   * the catalogue, so a guess reaching it is a guess entering the catalogue
   * looking exactly like a title somebody read off the book.
   */
  it('leaves the title empty when the only one is what OCR read', () => {
    const draft = draftFromCapture(capture({ title_guess: 'S0NG 0F SOLOMQN' }))
    expect(draft.title).toBe('')
  })

  it('still fills the title in once a person has stated one', () => {
    const draft = draftFromCapture(capture({
      title_guess: 'S0NG 0F SOLOMQN',
      edit_json: JSON.stringify({ title: 'Song of Solomon' }),
    }))
    expect(draft.title).toBe('Song of Solomon')
  })

  /**
   * The number the row has is the number the screen says (#436).
   *
   * "ISBN - Not read yet" was drawn two inches under a note reading "Barcode on
   * the back reads 9780030000126", on a capture whose row carried that number
   * and whose database row still does. A person reading that retypes thirteen
   * digits the app already has, off a book they have to go and find.
   *
   * A catalogue's record is not obliged to carry the identifier it was found
   * by, which is the way this happens without anybody doing anything wrong: the
   * lookup answered, its own `isbn13` is empty, and the draft took the empty
   * one because the lookup is the base. The row's column is the fallback and it
   * is the fallback for the identifier only.
   */
  it('falls back to the row\'s own ISBN when the lookup carries none', () => {
    const draft = draftFromCapture(capture({
      isbn13: '9780030000126',
      isbn_source: 'barcode',
      draft_json: JSON.stringify({ ...found, isbn13: '', isbn10: '' }),
    }))

    expect(draft.isbn13).toBe('9780030000126')
    // And the rest of the record is still the catalogue's, not the row's.
    expect(draft.title).toBe('Dune')
  })

  it('keeps the ISBN of a barcode no catalogue has ever heard of', () => {
    const draft = draftFromCapture(capture({
      status: 'failed',
      isbn13: '9780030000126',
      isbn_source: 'barcode',
      note: 'Barcode on the back reads 9780030000126, but no catalogue has it.',
    }))

    expect(draft.isbn13).toBe('9780030000126')
    expect(draft.isbnSource).toBe('barcode')
  })

  /* The lookup wins where it has an answer: a corrected ISBN that refetched is
     the whole point of `Change ISBN`, and a stale column must not undo it. */
  it('does not let the row overrule an ISBN the lookup does carry', () => {
    const draft = draftFromCapture(capture({
      isbn13: '9780030000126',
      draft_json: JSON.stringify(found),
    }))
    expect(draft.isbn13).toBe('9780441013593')
  })
})

/**
 * Naming a row and filling in a field are two jobs, and #156 is what happened
 * while one value did both.
 */
describe('captureName', () => {
  const capture = (fields: Partial<Capture>): Capture => ({
    id: 41, status: 'ready', front_image: '', back_image: '', edge_image: '',
    isbn13: '', isbn10: '', isbn_source: '', title_guess: '', cover_text: '',
    analysed: '', draft_json: '', edit_json: '', edited_by: '', edited_at: null,
    note: '', claimed_by: '', claimed_at: null, book_id: null,
    created_at: '', processed_at: null,
    front_crop: '', back_crop: '', edge_crop: '', cropped: '', ...fields,
  })

  it('names a capture by what OCR read, and says that is what it is', () => {
    expect(captureName(capture({ title_guess: 'S0NG 0F SOLOMQN' })))
      .toEqual({ text: 'S0NG 0F SOLOMQN', guessed: true })
  })

  it('prefers a stated title, and does not call that a guess', () => {
    expect(captureName(capture({
      title_guess: 'S0NG 0F SOLOMQN',
      edit_json: JSON.stringify({ title: 'Song of Solomon' }),
    }))).toEqual({ text: 'Song of Solomon', guessed: false })
  })

  it('prefers what a catalogue confirmed over what the cover read', () => {
    expect(captureName(capture({
      title_guess: 'DUNE by FRANK HERBERT', draft_json: JSON.stringify(found),
    }))).toEqual({ text: 'Dune', guessed: false })
  })

  it('falls back to the number, which is a fact and not a guess', () => {
    expect(captureName(capture({}))).toEqual({ text: 'Book #41', guessed: false })
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
    await api.updateAndShelve(7, { ...emptyDraft, title: 'Dune', location: '1A' }, 42)

    expect(sent.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT /api/books/7',
      'PATCH /api/books/7/location',
      'POST /api/books/7/checkout',
    ])
    // The plank, not what it is called: a label is derived from where the piece
    // stands and what its owner named it, and only the id is the place (#359).
    expect((sent[1]?.body as { areaId: number }).areaId).toBe(42)
  })

  /**
   * The second half of the same observation. Somebody has walked to a plank
   * with the book in their hand and said it fits, so the book is on the
   * bookcase, and saying so on every confirmed placement costs nothing: asking
   * for the state a book is already in is a no-op rather than a write (#15).
   */
  it('says the book is on the bookcase, because somebody just put it there', async () => {
    const sent = captureFetch()

    await api.updateAndShelve(7, { ...emptyDraft, title: 'Dune' }, 42)

    expect(sent[2]?.body).toEqual({ out: false })
  })

  it('says nothing about the location when no one has been to a shelf', async () => {
    const sent = captureFetch()

    await api.updateAndShelve(7, { ...emptyDraft, title: 'Dune', location: '1A' }, null)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.method).toBe('PUT')
  })

  /**
   * The hole the test above left open, and it was a live defect (#409).
   *
   * "Says nothing about the location" was checked as "sends no location write",
   * and the edit itself was carrying one the whole time: the draft a catalogued
   * book is loaded into holds the label the app rendered for wherever the ledger
   * has the book, no field on the form changes it, and it went out in the body
   * of every save. The server reads a location in that body as somebody saying
   * where the book is now, and resolves the label back to a plank.
   *
   * **On a bookcase somebody has named, nothing resolves it.** The label is a
   * phrase like "Hall shelf · A", the save is refused with `UnknownPlank`, and
   * what reaches the person is "Something went wrong." So no book on a named
   * piece of furniture could be edited and saved at all. Found by pressing the
   * notice on a misfiled book, which now opens the shelving step and ends in
   * this save; the browser suite walks that on a named bookcase.
   *
   * Checked on the body rather than on the call list, because the call list is
   * what looked right while this was broken.
   */
  it('carries no location in the edit itself, whatever the draft holds', async () => {
    const sent = captureFetch()

    await api.updateAndShelve(
      7, { ...emptyDraft, title: 'Dune', location: 'Hall shelf · A' }, null,
    )

    expect((sent[0]?.body as { location: string }).location).toBe('')
  })

  /* And with a plank confirmed, the same: where the book is comes from the one
     call that says so, addressed by id. */
  it('leaves the location to the location route even when one was confirmed', async () => {
    const sent = captureFetch()

    await api.updateAndShelve(
      7, { ...emptyDraft, title: 'Dune', location: 'Hall shelf · A' }, 42,
    )

    expect((sent[0]?.body as { location: string }).location).toBe('')
    expect((sent[1]?.body as { areaId: number }).areaId).toBe(42)
  })

  /**
   * The seam #87 lived in, and the reason it cost something irreplaceable.
   *
   * Editing a note is not a statement about where a book physically is, and
   * checking a book in on the strength of it being out overwrote the moment it
   * was taken down. There is no history table, so that moment does not come
   * back. A metadata-only save must therefore say nothing about the bookcase
   * at all, exactly as it says nothing about the location.
   */
  it('says nothing about the bookcase when no one has been to a shelf', async () => {
    const sent = captureFetch()

    await api.updateAndShelve(
      7, { ...emptyDraft, title: 'Dune', notes: 'signed by the author' }, null,
    )

    expect(
      sent.filter((call) => call.url.endsWith('/checkout')),
      'a metadata edit asserted whether the book was on the bookcase',
    ).toEqual([])
  })
})

/**
 * What the camera keeps of a reading no catalogue answered (#436).
 *
 * The screen after the shutter was headed "Barcode on the back reads
 * 9780030000126", the queue row showed that number and the database had it, and
 * two inches under the banner the ISBN read "Not read yet". The camera had two
 * answers for a settled capture, a found lookup and an error banner, and a
 * barcode nothing has ever catalogued is neither.
 */
describe('withReadIsbn', () => {
  const read = {
    isbn13: '9780030000126', isbn10: '', isbn_source: 'barcode',
  }

  it('takes the digits the reading produced into an empty draft', () => {
    const draft = withReadIsbn(emptyDraft, read)
    expect(draft.isbn13).toBe('9780030000126')
    expect(draft.isbnSource).toBe('barcode')
  })

  /* No catalogue answered, so there is nothing else to carry and carrying
     anything else would be this app inventing a record (#147). */
  it('claims nothing else about the book', () => {
    const draft = withReadIsbn(emptyDraft, read)
    expect(draft.title).toBe('')
    expect(draft.authors).toBe('')
    expect(draft.publisher).toBe('')
  })

  /* A background pass landing behind somebody's typing must not overwrite it,
     which is the precedence the server keeps (#65) said on this side too. */
  it('leaves an ISBN a person has already answered exactly as it is', () => {
    const typed = { ...emptyDraft, isbn13: '9780441013593', isbnSource: 'manual' }
    expect(withReadIsbn(typed, read)).toBe(typed)
  })

  it('does nothing at all when the reading produced no identifier', () => {
    expect(withReadIsbn(emptyDraft, { isbn13: '', isbn10: '', isbn_source: '' }))
      .toBe(emptyDraft)
  })

  it('takes a ten-digit reading where that is all there is', () => {
    const draft = withReadIsbn(emptyDraft, {
      isbn13: '', isbn10: '0441013597', isbn_source: 'ocr',
    })
    expect(draft.isbn10).toBe('0441013597')
    expect(draft.isbnSource).toBe('ocr')
  })
})

/**
 * The two refusals are different, and this is where the client learns which.
 *
 * `docs/the-gate.md`: a `401` means this browser is not signed in and a `403`
 * means somebody is signed in and has not been let in. #521 named the cost of
 * collapsing them and #524 was opened to stop it happening on this side: "a
 * client that cannot tell them apart cannot choose between the login screen and
 * the waiting screen", and one that treats the second as a sign-out sends a
 * waiting person round the login loop for ever.
 *
 * Every request in this app goes through one function, so this is the one place
 * that reads the word, and the word travels out of it rather than back to
 * whichever screen happened to ask, because the thing that has to change is the
 * whole app rather than that screen.
 */
describe('what the client is told when the gate refuses', () => {
  /** Answer whatever is asked for with a status and a body. */
  function answerWith(status: number, body: unknown): void {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
  }

  afterEach(() => vi.unstubAllGlobals())

  it('carries "anonymous" out of a 401, to the throw and to whoever is listening', async () => {
    const heard: string[] = []
    const stop = whenTheGateRefuses((state) => heard.push(state))
    answerWith(401, { state: 'anonymous', error: 'Sign in to use this.' })

    const refusal = await api.health().catch((caught: unknown) => caught)

    expect(heard).toEqual(['anonymous'])
    expect(refusal).toBeInstanceOf(Refusal)
    expect((refusal as Refusal).authState).toBe('anonymous')
    stop()
  })

  /*
   * The one this issue exists for. A 403 is a live session belonging to
   * somebody who has not been let in, and the answer to it is the waiting
   * screen. Anything here saying "anonymous" is the login loop being built.
   */
  it('carries "waiting" out of a 403, and never says the caller is signed out', async () => {
    const heard: string[] = []
    const stop = whenTheGateRefuses((state) => heard.push(state))
    answerWith(403, {
      state: 'waiting',
      error: 'This account is signed in but has not been let in yet.',
    })

    const refusal = await api.health().catch((caught: unknown) => caught)

    expect(heard).toEqual(['waiting'])
    expect(heard).not.toContain('anonymous')
    expect((refusal as Refusal).authState).toBe('waiting')
    stop()
  })

  /*
   * A refusal about the request rather than about who made it. The furniture
   * routes answer 409 with an effect on it and no state, and a client reading a
   * status code instead of the server's own word would one day have to decide
   * for itself what a 403 from somewhere else meant.
   */
  it('says nothing about the gate for a refusal the gate did not make', async () => {
    const heard: string[] = []
    const stop = whenTheGateRefuses((state) => heard.push(state))
    answerWith(409, { error: 'That would take an area off.', effect: { moved: 3 } })

    const refusal = await api.health().catch((caught: unknown) => caught)

    expect(heard).toEqual([])
    expect((refusal as Refusal).authState).toBeUndefined()
    expect((refusal as Refusal).effect).toEqual({ moved: 3 })
    stop()
  })

  it('stops telling a listener that has stopped listening', async () => {
    const heard: string[] = []
    whenTheGateRefuses((state) => heard.push(state))()
    answerWith(401, { state: 'anonymous', error: 'Sign in to use this.' })

    await api.health().catch(() => {})

    expect(heard).toEqual([])
  })
})
