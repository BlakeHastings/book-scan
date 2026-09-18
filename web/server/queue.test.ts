/**
 * Both catalogues and the photograph reader are stubbed: identify.test.ts
 * already covers the real OCR pipeline, and a queue test that reached Open
 * Library would fail whenever it was down.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import { ReadingTimedOut } from './deadline'
import type { Db } from './driver'
import { CaptureQueue, editsOn } from './queue'
import { identify } from './identify'
import { lookupIsbn } from './lookup'
import type { LookupResult } from './lookup'
import { Store } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
// A recorded location names an existing `area` row, so a test that sets one on
// a plank the seeded furniture lacks must create that plank first.
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { genreStatedBy } from '../domain/tagging/genre'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

vi.mock('./identify', () => ({ identify: vi.fn() }))
vi.mock('./lookup', () => ({ lookupIsbn: vi.fn(), searchTitle: vi.fn() }))

const DUNE = '9780441013593'
const RAMA = '9780553287899'

function nothingFound(isbn = ''): LookupResult {
  return {
    found: false, title: '', subtitle: '', authors: [], publisher: '', published: '',
    pages: '', isbn13: isbn, isbn10: '', seriesName: '', seriesIndex: null,
    coverUrl: '', source: '',
    classification: { genre: FICTION_SLUG, confidence: 'unknown', reason: 'stub' },
    notes: [],
  }
}

function found(isbn13: string, title: string, authors: string[]): LookupResult {
  return {
    ...nothingFound(isbn13),
    found: true, title, authors, isbn10: '', publisher: 'A Publisher',
    source: 'Open Library',
    classification: { genre: FICTION_SLUG, confidence: 'high', reason: 'stub' },
  }
}

/** A photograph the reader made nothing of. */
function readNothing() {
  return {
    isbn13: '', isbn10: '', source: '' as const, barcodes: [], titleGuess: '',
    coverLines: [], isbnCandidates: [], text: '', notes: [],
  }
}

/** A photograph carrying a decoded barcode. */
function readBarcode(isbn13: string) {
  return { ...readNothing(), isbn13, source: 'barcode' as const, barcodes: [isbn13] }
}

let queue: CaptureQueue
let store: Store
let db: Db

// openTestDatabase may return either backing database; nothing below knows which.
beforeEach(async () => {
  vi.mocked(identify).mockReset()
  vi.mocked(lookupIsbn).mockReset()
  vi.mocked(lookupIsbn).mockResolvedValue(nothingFound())

  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  // No image reader: most of these tests never run the worker. The ones that
  // do build their own queue with a reader below.
  queue = new CaptureQueue(db, () => null)
})

afterAll(closeTestDatabase)

async function add() {
  return await queue.add({ front: 'f.jpg', back: 'b.jpg', edge: 'e.jpg' })
}

/**
 * Goes through `Store.updateBook`, the same method the save route calls,
 * rather than a raw UPDATE, since these tests want to know the queue agrees
 * with what actually shelves books.
 */
async function shelve(id: number) {
  const draft = { title: 'A Book', authors: ['Ann Author'], genre: FICTION_SLUG }
  // The range is settled from the draft's own genre; see store.test.ts for why
  // that is the answer here.
  await store.updateBook(id, draft, genreStatedBy(draft).range)
  return id
}

describe('queueing', () => {
  it('accepts a capture as pending so the camera never waits', async () => {
    const capture = await add()
    expect(capture.status).toBe('pending')
    expect(capture.back_image).toBe('b.jpg')
  })

  it('counts by status', async () => {
    await add()
    await add()
    expect((await queue.counts()).pending).toBe(2)
    expect((await queue.counts()).ready).toBe(0)
  })

  it('counts as numbers, not as strings that look like numbers', async () => {
    // A COUNT is wider than an int, and a driver entitled to refuse to narrow
    // one hands back a string instead. "2" renders exactly like 2 in the queue
    // badge and behaves nothing like it in arithmetic, so the CAST that stops
    // this is asserted rather than assumed.
    await add()
    expect(typeof (await queue.counts()).pending).toBe('number')
  })

  it('keeps done captures out of the working list', async () => {
    const capture = await add()
    await shelve(capture.id)
    expect(await queue.list()).toHaveLength(0)
    // Its own id, because the capture and the book it became are one row.
    expect((await queue.get(capture.id))?.book_id).toBe(capture.id)
  })

  it('lists oldest first, the order the worker drains them in', async () => {
    // The web UI shows newest first, matching the physical stack, but that is
    // a display choice made on top of this list. What the worker claims next
    // must stay oldest first regardless of how anything displays the queue.
    const first = await add()
    const second = await add()
    const third = await add()
    expect((await queue.list()).map((c) => c.id)).toEqual([first.id, second.id, third.id])
  })
})

describe('claiming, with two people on the same queue', () => {
  it('lets the first person claim', async () => {
    const capture = await add()
    expect((await queue.claim(capture.id, 'alice')).ok).toBe(true)
  })

  it('refuses a second person and names who holds it', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')

    const second = await queue.claim(capture.id, 'bob')
    expect(second.ok).toBe(false)
    expect(second.heldBy).toBe('alice')
  })

  it('lets the same person reclaim after a refresh', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')
    expect((await queue.claim(capture.id, 'alice')).ok).toBe(true)
  })

  it('frees the capture when released', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')
    await queue.release(capture.id, 'alice')
    expect((await queue.claim(capture.id, 'bob')).ok).toBe(true)
  })

  it('ignores a release from someone who does not hold it', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')
    await queue.release(capture.id, 'bob')
    expect((await queue.claim(capture.id, 'bob')).ok).toBe(false)
  })

  it('expires a stale claim so a walked-away lease cannot block forever', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')

    // Backdate the claim past the lease window.
    await db.run('UPDATE books SET claimed_at = ? WHERE id = ?',
      [new Date(Date.now() - 60 * 60 * 1000).toISOString(), capture.id])

    expect((await queue.claim(capture.id, 'bob')).ok).toBe(true)
  })

  it('will not claim a capture that is already shelved', async () => {
    const capture = await add()
    await shelve(capture.id)
    expect((await queue.claim(capture.id, 'alice')).ok).toBe(false)
  })
})

describe('editing a capture while it is still in the queue', () => {
  it('persists what a person stated, so the next person opens their work', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')

    const result = await queue.edit(capture.id, 'alice', { title: 'Dune' })
    expect(result.ok).toBe(true)

    // Read back through a fresh handle: the work must survive the browser it
    // was typed into.
    const reopened = (await new CaptureQueue(db, () => null).get(capture.id))!
    expect(editsOn(reopened).title).toBe('Dune')
    expect(reopened.edited_by).toBe('alice')
    expect(reopened.edited_at).not.toBeNull()
  })

  /*
   * `title_guess` is the OCR reading; what a person states stays in
   * `edit_json`, which is where every reader looks for it. Mixing the two into
   * one column is how a guess ends up displayed as if confirmed.
   */
  it('does not write a stated title into the column that holds the guess', async () => {
    const capture = await add()
    await db.run("UPDATE books SET title_guess = ?, state = 'unidentified' WHERE id = ?",
      ['S0NG 0F SOLOMQN', capture.id])

    await queue.edit(capture.id, 'alice', { title: 'Song of Solomon' })

    const after = (await queue.get(capture.id))!
    expect(after.title_guess).toBe('S0NG 0F SOLOMQN')
    expect(editsOn(after).title).toBe('Song of Solomon')
    // The edit still settles the capture: a person who has named the book has
    // resolved it, whatever the photographs did or did not read.
    expect(after.status).toBe('ready')
  })

  it('accumulates edits across a handoff instead of the second wiping the first', async () => {
    const capture = await add()
    await queue.edit(capture.id, 'alice', { title: 'Dune' })
    await queue.release(capture.id, 'alice')

    const second = await queue.edit(capture.id, 'bob', { publisher: 'Ace Books' })
    expect(second.ok).toBe(true)

    const stated = editsOn((await queue.get(capture.id))!)
    expect(stated.title).toBe('Dune')
    expect(stated.publisher).toBe('Ace Books')
  })

  it('records a typed ISBN as manual, not as a barcode or an OCR guess', async () => {
    // A barcode reading is self-validating, an OCR reading is a guess, and a
    // person typing the number is a third thing; filing it under either of the
    // first two would claim a provenance it does not have.
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    const capture = await add()

    await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    const row = (await queue.get(capture.id))!
    expect(row.isbn_source).toBe('manual')
    expect(editsOn(row).isbnSource).toBe('manual')
  })

  it('re-runs the lookup for a corrected ISBN, which is what makes it worth anything', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    // The photographs failed, so somebody is typing the number off the back of the book.
    const capture = await add()
    await db.run("UPDATE books SET state = 'unidentified' WHERE id = ?", [capture.id])

    const result = await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    expect(vi.mocked(lookupIsbn)).toHaveBeenCalledWith(DUNE, expect.anything())
    expect(result.ok && result.lookup?.title).toBe('Dune')
    // The refetched record must land on the capture, not only in the response:
    // correcting the key without refetching leaves the right number beside the wrong book.
    const stated = editsOn((await queue.get(capture.id))!)
    expect(stated.title).toBe('Dune')
    expect(stated.authors).toEqual(['Frank Herbert'])
    expect((await queue.get(capture.id))!.status).toBe('ready')
  })

  it('keeps the digits even when no catalogue has them', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(nothingFound())
    const capture = await add()

    await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    expect((await queue.get(capture.id))!.isbn13).toBe(DUNE)
    expect(editsOn((await queue.get(capture.id))!).isbn13).toBe(DUNE)
  })

  it('leaves the notes and location a person gave alone when the ISBN changes', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    const capture = await add()

    await queue.edit(capture.id, 'alice', { notes: 'Spine is cracked', location: '2B' })
    await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    const stated = editsOn((await queue.get(capture.id))!)
    expect(stated.notes).toBe('Spine is cracked')
    expect(stated.location).toBe('2B')
    expect(stated.title).toBe('Dune')
  })

  it('refuses an edit from someone who does not hold the claim', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')

    const result = await queue.edit(capture.id, 'bob', { title: 'Not Dune' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('claimed')
    expect(result.ok === false && result.reason === 'claimed' && result.heldBy).toBe('alice')
    expect(editsOn((await queue.get(capture.id))!)).toEqual({})
  })

  it('lets an edit take a claim that has gone stale', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')
    await db.run('UPDATE books SET claimed_at = ? WHERE id = ?',
      [new Date(Date.now() - 60 * 60 * 1000).toISOString(), capture.id])

    const result = await queue.edit(capture.id, 'bob', { title: 'Dune' })

    expect(result.ok).toBe(true)
    expect((await queue.get(capture.id))!.claimed_by).toBe('bob')
  })

  it('renews the lease, so a long resolving session does not expire under it', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')
    const stale = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    await db.run('UPDATE books SET claimed_at = ? WHERE id = ?', [stale, capture.id])

    await queue.edit(capture.id, 'alice', { title: 'Dune' })

    expect((await queue.get(capture.id))!.claimed_at! > stale).toBe(true)
  })

  it('refuses to edit a capture that has already become a book', async () => {
    const capture = await add()
    await shelve(capture.id)

    const result = await queue.edit(capture.id, 'alice', { title: 'Dune' })
    expect(result.ok === false && result.reason).toBe('done')
  })

  it('404s rather than inventing a capture', async () => {
    const result = await queue.edit(9999, 'alice', { title: 'Dune' })
    expect(result.ok === false && result.reason).toBe('missing')
  })

  it('tells apart a book nobody has opened from one somebody left as it was', async () => {
    // A person who read a capture and decided it was fine has to leave a mark;
    // an edit that states nothing is exactly that mark.
    const untouched = await add()
    const checked = await add()

    await queue.edit(checked.id, 'alice', {})

    expect((await queue.get(untouched.id))!.edited_at).toBeNull()
    expect((await queue.get(checked.id))!.edited_at).not.toBeNull()
    expect((await queue.get(checked.id))!.edited_by).toBe('alice')
    expect(editsOn((await queue.get(checked.id))!)).toEqual({})
  })

  it('stops a resolved capture reading as failed', async () => {
    const capture = await add()
    await db.run("UPDATE books SET state = 'unidentified' WHERE id = ?", [capture.id])

    await queue.edit(capture.id, 'alice', { title: 'Dune' })

    expect((await queue.get(capture.id))!.status).toBe('ready')
  })
})

/**
 * A queue built without the fifth constructor argument (the default `queue`
 * from `beforeEach`) never checks for a duplicate ISBN at all, which is the
 * behaviour every other test in this file exercises unchanged. `withCatalogue`
 * below opts a queue into that check.
 */
describe('naming a duplicate already on the shelf (#233)', () => {
  function withCatalogue(reader: (name: string) => Buffer | null = () => null) {
    return new CaptureQueue(db, reader, {}, undefined, (isbn) => store.findByIsbn(isbn))
  }

  /**
   * A test database only seeds `1A` and `4A`, so `2B` must be created: a
   * `shelf` boundary opens `2A` and an `area` boundary after it opens `2B`, in
   * that anchor order. Neither anchor needs to name a real book.
   */
  async function giveFictionASecondBookcase(): Promise<void> {
    const boundaries = new DrizzleSeparatorRepository(db)
    const at = '2026-01-02T03:04:05.000Z'
    await boundaries.add({
      range: 'fiction', kind: 'shelf', startsAt: 'A', position: 0, note: '', createdAt: at,
    })
    await boundaries.add({
      range: 'fiction', kind: 'area', startsAt: 'B', position: 1, note: '', createdAt: at,
    })
  }

  it('names it when a person corrects the ISBN on a queued capture', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await giveFictionASecondBookcase()
    const { id: shelvedId } = await store.addBook({
      isbn13: DUNE, title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, location: '2B',
    })
    const running = withCatalogue()
    const capture = await running.add({ front: 'f.jpg', back: 'b.jpg', edge: 'e.jpg' })

    const result = await running.edit(capture.id, 'alice', { isbn13: DUNE })

    expect(result.ok && result.lookup?.duplicateOf).toEqual({
      id: shelvedId, title: 'Dune', location: '2B',
    })
  })

  it('says nothing is a duplicate when the shelves hold nothing under that ISBN', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    const running = withCatalogue()
    const capture = await running.add({ front: 'f.jpg', back: 'b.jpg', edge: 'e.jpg' })

    const result = await running.edit(capture.id, 'alice', { isbn13: DUNE })

    expect(result.ok && result.lookup?.duplicateOf).toBeNull()
  })

  it('names it on the automatic pass too, not only a manual correction', async () => {
    await giveFictionASecondBookcase()
    const { id: shelvedId } = await store.addBook({
      isbn13: DUNE, title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, location: '2B',
    })
    vi.mocked(identify).mockResolvedValue(readBarcode(DUNE))
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    const running = withCatalogue(() => Buffer.from('a photograph'))

    const capture = await running.attach(null, 'back', 'b.jpg')
    await running.drain()

    const after = (await running.get(capture.id))!
    expect(JSON.parse(after.draft_json).duplicateOf).toEqual({
      id: shelvedId, title: 'Dune', location: '2B',
    })
  })
})

/**
 * A person corrects an ISBN, another photograph arrives or the server
 * restarts, the worker re-reads the book: the correction must not be lost.
 */
describe('precedence between a person and the background worker', () => {
  /** A queue that will actually run, with one readable photograph. */
  function worker() {
    return new CaptureQueue(db, () => Buffer.from('a photograph'))
  }

  it('does not let a re-analysis overwrite a corrected ISBN', async () => {
    // The worker read the wrong book off the barcode.
    vi.mocked(identify).mockResolvedValue(readBarcode(RAMA))
    vi.mocked(lookupIsbn).mockResolvedValue(found(RAMA, 'Rendezvous with Rama', ['Arthur C. Clarke']))

    const running = worker()
    const capture = await running.attach(null, 'back', 'b.jpg')
    await running.drain()
    expect((await running.get(capture.id))!.isbn13).toBe(RAMA)

    // A person, holding the book, says it is something else.
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await running.edit(capture.id, 'alice', { isbn13: DUNE })

    // Another photograph arrives, so the whole capture is read again.
    vi.mocked(identify).mockResolvedValue(readBarcode(RAMA))
    vi.mocked(lookupIsbn).mockResolvedValue(found(RAMA, 'Rendezvous with Rama', ['Arthur C. Clarke']))
    await running.attach(capture.id, 'front', 'f.jpg')
    await running.drain()

    const after = (await running.get(capture.id))!
    expect(after.isbn13).toBe(DUNE)
    expect(after.isbn_source).toBe('manual')
    expect(editsOn(after).title).toBe('Dune')
    expect(after.status).toBe('ready')
  })

  it('still lets the worker fill in a field nobody has stated', async () => {
    // Precedence is per field, not per capture: somebody fixing a title must
    // not freeze the worker out of an ISBN nobody has an opinion about.
    const running = worker()
    const capture = await running.attach(null, 'back', 'b.jpg')
    await running.edit(capture.id, 'alice', { notes: 'Water damage to the spine' })

    vi.mocked(identify).mockResolvedValue(readBarcode(DUNE))
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await running.drain()

    const after = (await running.get(capture.id))!
    expect(after.isbn13).toBe(DUNE)
    expect(after.isbn_source).toBe('barcode')
    expect(editsOn(after).notes).toBe('Water damage to the spine')
  })

  it('keeps the worker and the person in separate columns', async () => {
    // Why the correction cannot be lost even in principle: the worker owns
    // draft_json and a person owns edit_json, so a better photograph improves
    // the base without ever reaching what was laid over it.
    const running = worker()
    const capture = await running.attach(null, 'back', 'b.jpg')

    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await running.edit(capture.id, 'alice', { isbn13: DUNE, title: 'Dune (Ace edition)' })

    vi.mocked(identify).mockResolvedValue(readBarcode(RAMA))
    vi.mocked(lookupIsbn).mockResolvedValue(found(RAMA, 'Rendezvous with Rama', ['Arthur C. Clarke']))
    await running.drain()

    const after = (await running.get(capture.id))!
    expect(JSON.parse(after.draft_json).title).toBe('Rendezvous with Rama')
    expect(editsOn(after).title).toBe('Dune (Ace edition)')
    // Read out of edit_json: title_guess is only the cover reading, kept
    // separate on the row.
    expect(after.title_guess).toBe('')
  })

  it('drops a "use Change ISBN" note once somebody has', async () => {
    const running = worker()
    const capture = await running.attach(null, 'back', 'b.jpg')
    vi.mocked(identify).mockResolvedValue(readNothing())
    await running.drain()
    expect((await running.get(capture.id))!.note).not.toBe('')

    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await running.edit(capture.id, 'alice', { isbn13: DUNE })
    await running.attach(capture.id, 'front', 'f.jpg')
    vi.mocked(identify).mockResolvedValue(readNothing())
    await running.drain()

    expect((await running.get(capture.id))!.note).toBe('')
    expect((await running.get(capture.id))!.status).toBe('ready')
  })
})

describe('photos arriving one at a time', () => {
  it('creates the capture on the first photo', async () => {
    const capture = await queue.attach(null, 'back', 'b.jpg')
    expect(capture.back_image).toBe('b.jpg')
    expect(capture.status).toBe('pending')
  })

  it('attaches later photos to the same capture', async () => {
    const first = await queue.attach(null, 'back', 'b.jpg')
    const second = await queue.attach(first.id, 'front', 'f.jpg')
    const third = await queue.attach(first.id, 'edge', 'e.jpg')

    expect(second.id).toBe(first.id)
    expect(third.id).toBe(first.id)
    expect((await queue.counts()).pending).toBe(1)

    const row = (await queue.get(first.id))!
    expect(row.back_image).toBe('b.jpg')
    expect(row.front_image).toBe('f.jpg')
    expect(row.edge_image).toBe('e.jpg')
  })

  it('marks a re-taken slot as needing another read', async () => {
    const capture = await queue.attach(null, 'back', 'b.jpg')
    await db.run("UPDATE books SET analysed = 'back,front', state = 'unidentified' WHERE id = ?",
      [capture.id])

    const again = await queue.attach(capture.id, 'back', 'b2.jpg')
    expect(again.back_image).toBe('b2.jpg')
    // Back drops out of analysed; front, which did not change, stays.
    expect(again.analysed.split(',').filter(Boolean)).toEqual(['front'])
    // A list of one, not ",front,": `analysed` is a raw string a person reads
    // directly when working out what a photograph did to a book.
    expect(again.analysed).toBe('front')
    expect(again.status).toBe('pending')
  })

  it('leaves a shelved capture alone', async () => {
    const capture = await queue.attach(null, 'back', 'b.jpg')
    await shelve(capture.id)
    expect((await queue.attach(capture.id, 'front', 'f.jpg')).status).toBe('done')
  })
})

describe('two drains at once', () => {
  /**
   * Overlapping `drain` calls are the normal case, not exotic: every shutter
   * fires `void drain()` and the server fires one more at boot. Asserts on the
   * number of photographs read, not the final row state, since a duplicated
   * second pass would read a capture twice while still landing on the same
   * final answer.
   */
  it('reads each pending capture exactly once', async () => {
    // Suspended mid-photograph, so the later calls genuinely arrive while the
    // first pass is in flight rather than after it has finished.
    vi.mocked(identify).mockImplementation(async () => {
      await new Promise((done) => setTimeout(done, 5))
      return readBarcode(DUNE)
    })
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))

    const running = new CaptureQueue(db, () => Buffer.from('a photograph'))
    await running.attach(null, 'back', 'b1.jpg')
    await running.attach(null, 'back', 'b2.jpg')

    await Promise.all([running.drain(), running.drain(), running.drain()])

    expect(vi.mocked(identify)).toHaveBeenCalledTimes(2)
    expect(await running.counts()).toMatchObject({ pending: 0, ready: 2 })
  })
})

/**
 * `failed` is one status over three different situations. Driven through the
 * worker rather than by writing rows by hand, since a test that set the reason
 * itself would prove nothing about what the worker actually writes.
 */
describe('why the failed ones failed', () => {
  it('tells a barcode no catalogue has apart from a photo with no ISBN on it', async () => {
    const running = new CaptureQueue(db, () => Buffer.from('a photograph'))

    // Read cleanly off a barcode, so the number is right; nothing catalogues it.
    vi.mocked(identify).mockResolvedValue(readBarcode(DUNE))
    vi.mocked(lookupIsbn).mockResolvedValue(nothingFound())
    const uncatalogued = await running.attach(null, 'back', 'b1.jpg')
    await running.drain()

    // Nothing readable on the photographs at all: this one needs typing in.
    vi.mocked(identify).mockResolvedValue(readNothing())
    const blank = await running.attach(null, 'back', 'b2.jpg')
    await running.drain()

    const counts = await running.counts()
    expect(counts.failed).toBe(2)
    expect(counts.failures)
      .toEqual({ noIsbn: 1, uncatalogued: 1, errored: 0, timedOut: 0 })

    expect((await running.get(uncatalogued.id))!.isbn13).toBe(DUNE)
    expect((await running.get(blank.id))!.isbn13).toBe('')
  })

  it('counts a read that threw as broken, not as a book with no ISBN', async () => {
    const running = new CaptureQueue(db, () => Buffer.from('a photograph'))
    vi.mocked(identify).mockRejectedValue(new Error('decoder crashed'))
    await running.attach(null, 'back', 'b.jpg')
    await running.drain()

    const counts = await running.counts()
    expect(counts.failed).toBe(1)
    expect(counts.failures)
      .toEqual({ noIsbn: 0, uncatalogued: 0, errored: 1, timedOut: 0 })
  })

  it('reports nothing wrong when nothing has failed', async () => {
    await add()
    expect((await queue.counts()).failures)
      .toEqual({ noIsbn: 0, uncatalogued: 0, errored: 0, timedOut: 0 })
  })
})

/**
 * `ReadingTimedOut` comes from `server/deadline.ts` rather than from
 * `./identify`, which this file mocks wholesale: an `instanceof` check against
 * a stubbed module's missing export would throw inside the very catch meant to
 * handle a throw.
 */
describe('a reading that was given up on', () => {
  const abandoned = () => new ReadingTimedOut('Reading this photograph', 60_000)

  const wedged = () => {
    const running = new CaptureQueue(db, () => Buffer.from('a photograph'))
    vi.mocked(identify).mockRejectedValue(abandoned())
    return running
  }

  it('leaves the capture stuck and visible rather than looking untouched', async () => {
    const running = wedged()
    const capture = await running.attach(null, 'back', 'b.jpg')
    await running.drain()

    const after = (await running.get(capture.id))!
    expect(after.status).toBe('failed')
    expect(after.note).toContain('the reader stopped')
    expect(after.note).toContain('Read it again')
  })

  it('is counted as its own kind of stuck, not as a photograph nobody could read', async () => {
    // The two send a person to different places. `errored` and `noIsbn` say go
    // and find the book; this says the book was never looked at.
    const running = wedged()
    await running.attach(null, 'back', 'b.jpg')
    await running.drain()

    expect((await running.counts()).failures)
      .toEqual({ noIsbn: 0, uncatalogued: 0, errored: 0, timedOut: 1 })
  })

  it('does not record the photograph it never read as read', async () => {
    // The slot is marked read before the reading starts, so a photograph whose
    // file has gone is not offered forever. A reading nobody finished has read
    // nothing, and leaving the mark on would make the retry below find nothing
    // to do and settle the capture as failed all over again.
    const running = wedged()
    const capture = await running.attach(null, 'back', 'b.jpg')
    await running.drain()

    expect((await running.get(capture.id))!.analysed).toBe('')
  })

  it('does not stop the queue: the next capture is read', async () => {
    const running = wedged()
    const stuck = await running.attach(null, 'back', 'stuck.jpg')
    const behind = await running.attach(null, 'back', 'behind.jpg')

    vi.mocked(identify)
      .mockRejectedValueOnce(abandoned())
      .mockResolvedValue(readBarcode(DUNE))
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))

    await running.drain()

    expect((await running.get(stuck.id))!.status).toBe('failed')
    expect((await running.get(behind.id))!.status).toBe('ready')
    expect((await running.get(behind.id))!.isbn13).toBe(DUNE)
  })

  it('goes back through the reader, and the second reading counts', async () => {
    const running = wedged()
    const capture = await running.attach(null, 'back', 'b.jpg')
    await running.drain()
    expect((await running.get(capture.id))!.status).toBe('failed')

    vi.mocked(identify).mockResolvedValue(readBarcode(DUNE))
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))

    const back = await running.readAgain(capture.id)
    expect(back!.status).toBe('pending')
    await running.drain()

    const after = (await running.get(capture.id))!
    expect(after.status).toBe('ready')
    expect(after.isbn13).toBe(DUNE)
    // "Read it again" stops being true the moment somebody has.
    expect(after.note).toBe('')
  })

  it('offers every photograph again, not only the one that stopped', async () => {
    // Clearing every slot's analysed mark, not just the one that stopped, is
    // the rule: a slot that read cleanly just costs a second to re-confirm.
    const running = new CaptureQueue(db, () => Buffer.from('a photograph'))
    vi.mocked(identify).mockResolvedValue(readNothing())
    const capture = await running.add({ front: 'f.jpg', back: 'b.jpg', edge: 'e.jpg' })
    await running.drain()
    expect((await running.get(capture.id))!.analysed).not.toBe('')

    await running.readAgain(capture.id)
    expect((await running.get(capture.id))!.analysed).toBe('')
  })

  it('will not re-read a book that has left the queue', async () => {
    const shelved = await add()
    await shelve(shelved.id)
    expect(await queue.readAgain(shelved.id)).toBeUndefined()

    const thrownAway = await add()
    await queue.discard(thrownAway.id)
    expect(await queue.readAgain(thrownAway.id)).toBeUndefined()
  })

  it('says nothing about a capture that never existed', async () => {
    expect(await queue.readAgain(999_999)).toBeUndefined()
  })
})

/** Each exclusion here is asserted on its own, since each is the difference between a useful answer and a wrong one. */
describe('captures still waiting to be shelved', () => {
  const hashed = async (hash = 'p1abcdef0123456789'.slice(0, 18)) => {
    const capture = await add()
    await queue.setFrontHash(capture.id, hash)
    return capture.id
  }

  it('offers a capture that has a hash and a photograph', async () => {
    const id = await hashed()
    expect((await queue.waiting()).map((c) => c.id)).toEqual([id])
  })

  it('leaves out one that has become a book', async () => {
    // It is on a shelf and the books path answers for it now; sending somebody
    // to finish it would send them to a dead end.
    const id = await hashed()
    await shelve(id)
    expect(await queue.waiting()).toEqual([])
  })

  it('leaves out one nobody has hashed', async () => {
    // An empty hash is the absence of a measurement, not a weak one.
    await add()
    expect(await queue.waiting()).toEqual([])
  })

  it('leaves out one whose front photograph was refused as featureless', async () => {
    // `coverHash` declines a frame with no detail in it, and `deriveCapture`
    // leaves the column empty rather than storing something comparable.
    const capture = await add()
    await queue.setFrontHash(capture.id, '')
    expect(await queue.waiting()).toEqual([])
  })

  it('keeps a failed capture, which is the one most likely to still be sitting there', async () => {
    // The read failed. The photographs did not, and neither did the book.
    const id = await hashed()
    await db.run("UPDATE books SET state = 'unidentified' WHERE id = ?", [id])
    expect((await queue.waiting()).map((c) => c.id)).toEqual([id])
  })

  it('keeps one still being read, so the answer does not depend on timing', async () => {
    // A capture photographed thirty seconds ago is the likeliest duplicate
    // there is. What it cannot do yet is be opened, and the queue already
    // refuses that; it is not a reason to pretend the book is not there.
    const id = await hashed()
    expect((await queue.get(id))?.status).toBe('pending')
    expect((await queue.waiting()).map((c) => c.id)).toEqual([id])
  })
})

/**
 * `waiting` compares a fuzzy measurement with an error rate; an ISBN-13 either
 * satisfies its check digit or is thrown away, so two captures sharing one are
 * the same title, and the filters that make sense for a fuzzy comparison do
 * not all apply here.
 */
describe('captures waiting under the same ISBN', () => {
  const withIsbn = async (isbn13: string) => {
    const capture = await add()
    await db.run('UPDATE books SET isbn13 = ? WHERE id = ?', [isbn13, capture.id])
    return capture.id
  }

  it('finds the other capture of the same book', async () => {
    const first = await withIsbn(DUNE)
    const second = await withIsbn(DUNE)

    expect((await queue.sharingIsbn(DUNE, second)).map((c) => c.id)).toEqual([first])
  })

  it('never reports the capture doing the asking', async () => {
    // Otherwise every capture with an ISBN is its own duplicate, and the panel
    // opens over the book somebody is holding to tell them about itself.
    const only = await withIsbn(DUNE)
    expect(await queue.sharingIsbn(DUNE, only)).toEqual([])
  })

  it('ignores a capture of a different book', async () => {
    await withIsbn(RAMA)
    const mine = await withIsbn(DUNE)
    expect(await queue.sharingIsbn(DUNE, mine)).toEqual([])
  })

  it('answers nothing at all for a capture with no ISBN', async () => {
    // Every capture nobody has read yet carries an empty string in this
    // column, so an unguarded query would report each of them as a duplicate
    // of all the others.
    await add()
    await add()
    const mine = await add()

    expect(await queue.sharingIsbn('', mine.id)).toEqual([])
  })

  it('leaves out one that has already become a book', async () => {
    // Same reason `waiting` does: it is on a shelf, and the catalogue answers
    // for it. Sending somebody to go and finish it sends them nowhere.
    const shelved = await withIsbn(DUNE)
    const mine = await withIsbn(DUNE)
    await shelve(shelved)

    expect(await queue.sharingIsbn(DUNE, mine)).toEqual([])
  })

  it('offers one whose front has not been photographed yet', async () => {
    // The difference from `waiting`, and the case this exists for. The back
    // cover is the first shot the Add flow takes and it carries the barcode,
    // so the likeliest duplicate in the queue is a capture with an ISBN, no
    // front photograph and no hash. Filtering on either would lose it.
    const capture = await queue.attach(null, 'back', 'b.jpg')
    await db.run('UPDATE books SET isbn13 = ? WHERE id = ?', [DUNE, capture.id])
    const mine = await withIsbn(DUNE)

    const found = await queue.sharingIsbn(DUNE, mine)
    expect(found.map((c) => c.id)).toEqual([capture.id])
    expect(found[0]!.front_image).toBe('')
    expect(found[0]!.front_hash).toBe('')
  })

  it('answers for a photograph that is not a capture at all', async () => {
    // The scan route asks this with no capture of its own, so nothing may be
    // excluded by accident.
    const id = await withIsbn(DUNE)
    expect((await queue.sharingIsbn(DUNE)).map((c) => c.id)).toEqual([id])
  })
})

/**
 * `drain` is only ever called by the shutter, a retake, or at boot; nothing
 * else picks up work this process did not see arrive or hear about.
 */
describe('picking the queue up again', () => {
  function worker(over: Db = db) {
    return new CaptureQueue(over, () => Buffer.from('a photograph'))
  }

  /** A readable barcode some catalogue has, so a pass always settles. */
  function readsCleanly() {
    vi.mocked(identify).mockResolvedValue(readBarcode(DUNE))
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
  }

  /**
   * A reading held open, so a test can stand inside the seconds a pass takes.
   *
   * `started` resolves once the worker is genuinely inside `identify`, which is
   * the only moment "a drain is in flight" is true rather than merely likely.
   */
  function heldReading() {
    let entered!: () => void
    let open!: () => void
    const started = new Promise<void>((done) => { entered = done })
    const gate = new Promise<void>((done) => { open = done })
    vi.mocked(identify).mockImplementation(async () => {
      entered()
      await gate
      return readBarcode(DUNE)
    })
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    return { started, release: () => { open() } }
  }

  /**
   * Hooks the query the drain loop ends on. The window is real but only
   * microseconds wide: a capture inserted after `nextPending` is issued and
   * before it answers is one the loop has already decided is not there. Racing
   * two real requests for it would pass most of the time, which is worse than
   * no test, so the arrival is placed deterministically: after the empty
   * answer, before the loop acts on it.
   */
  function afterTheLastLook(inner: Db, arrive: () => Promise<void>): Db {
    let fired = false
    return {
      all: (sql, params) => inner.all(sql, params),
      run: (sql, params) => inner.run(sql, params),
      tx: (work, options) => inner.tx(work, options),
      close: () => inner.close(),
      async get<Row>(sql: string, params?: unknown) {
        const answer = await inner.get<Row>(sql, params as never)
        const looking = sql.includes('FROM queued_books') && sql.includes('LIMIT 1')
        if (!fired && looking && answer === undefined) {
          fired = true
          await arrive()
        }
        return answer
      },
    } as Db
  }

  it('reads a capture that arrived while the last look for work was in flight', async () => {
    readsCleanly()

    let running: CaptureQueue
    let arrival = 0
    const watched = afterTheLastLook(db, async () => {
      // Exactly what `POST /api/captures` does: the row lands, and the drain
      // it fires is refused because the pass that is about to give up still
      // holds the guard.
      arrival = (await running.attach(null, 'back', 'b2.jpg')).id
      await running.drain()
    })
    running = worker(watched)

    const first = await running.attach(null, 'back', 'b1.jpg')
    await running.drain()

    // The one already there is read either way; the one that arrived in the
    // window is the point of this test.
    expect((await running.get(first.id))!.status).toBe('ready')
    expect((await running.get(arrival))!.status).toBe('ready')
    expect(await running.counts()).toMatchObject({ pending: 0, ready: 2 })
  })

  it('picks up work this process never heard about', async () => {
    readsCleanly()
    const running = worker()

    // A capture with nothing following it, the shape of a second server or an
    // external writer inserting into this database: nothing here has any
    // reason to call `drain`.
    const stranded = await running.attach(null, 'back', 'b.jpg')
    expect(await running.counts()).toMatchObject({ pending: 1, ready: 0 })

    await new Promise((done) => setTimeout(done, 20))
    expect((await running.get(stranded.id))!.status).toBe('pending')
    expect(vi.mocked(identify)).not.toHaveBeenCalled()

    // Looking at a queue with unread books in it is what arms the sweep;
    // `sweepPass` is called directly rather than waiting on a real timer,
    // which would make this suite slow.
    await running.sweepPass()

    expect((await running.get(stranded.id))!.status).toBe('ready')
    expect(await running.counts()).toMatchObject({ pending: 0, ready: 1 })
  })

  it('stops sweeping once the queue is empty', async () => {
    readsCleanly()
    const running = worker()
    await running.attach(null, 'back', 'b.jpg')

    expect(await running.sweepPass(), 'a sweep that emptied the queue asked for another')
      .toBe(false)
    // And a sweep over an empty queue does not come back either.
    expect(await running.sweepPass()).toBe(false)
  })

  /**
   * A pass that changes nothing is the last pass: pending count is a
   * non-negative integer that must fall each time or the sweep stops, so a
   * wedged reader is looked at once and then left alone.
   */
  it('stops sweeping when a pass moved nothing', async () => {
    const held = heldReading()
    const running = worker()
    await running.attach(null, 'back', 'b1.jpg')
    await running.attach(null, 'back', 'b2.jpg')

    const reading = running.drain()
    await held.started

    // The drain this asks for is refused since one is already running, which
    // is what that guard exists to stop; the queue is exactly as long after
    // this sweep as before it.
    expect(await running.sweepPass()).toBe(false)

    held.release()
    await reading
    expect(await running.counts()).toMatchObject({ pending: 0 })
  })

  /**
   * `reading` is not a column and is never written down: it is which capture
   * the worker currently has in its hands, and it is what lets the queue draw
   * "Reading photos" on that one and "Waiting to be read" on the rest.
   */
  it('says which capture it is reading, and says so only while it is', async () => {
    const held = heldReading()
    const running = worker()
    const first = await running.attach(null, 'back', 'b1.jpg')

    expect(running.reading, 'a queue that has not started claims a book').toBeNull()

    const reading = running.drain()
    await held.started
    expect(running.reading).toBe(first.id)

    held.release()
    await reading
    expect(running.reading, 'a queue that has finished still claims a book').toBeNull()
  })
})
