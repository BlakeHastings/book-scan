/**
 * Queue behaviour, with the two-person cases front and centre. The claim
 * logic is the part that stops both people filling in the same book, and the
 * precedence block at the bottom is the part that stops the background worker
 * quietly undoing somebody's correction.
 *
 * Both catalogues and the photograph reader are stubbed. Neither is what these
 * tests are about, identify.test.ts already pays for the real OCR pipeline,
 * and a queue test that reached Open Library would fail whenever it was down.
 */

import type { Database } from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db'
import { CaptureQueue, editsOn } from './queue'
import { identify } from './identify'
import { lookupIsbn } from './lookup'
import type { LookupResult } from './lookup'
import { Store } from './store'

vi.mock('./identify', () => ({ identify: vi.fn() }))
vi.mock('./lookup', () => ({ lookupIsbn: vi.fn(), searchTitle: vi.fn() }))

const DUNE = '9780441013593'
const RAMA = '9780553287899'

function nothingFound(isbn = ''): LookupResult {
  return {
    found: false, title: '', subtitle: '', authors: [], publisher: '', published: '',
    pages: '', isbn13: isbn, isbn10: '', seriesName: '', seriesIndex: null,
    coverUrl: '', source: '',
    classification: { isFiction: true, confidence: 'unknown', reason: 'stub' },
    notes: [],
  }
}

function found(isbn13: string, title: string, authors: string[]): LookupResult {
  return {
    ...nothingFound(isbn13),
    found: true, title, authors, isbn10: '', publisher: 'A Publisher',
    source: 'Open Library',
    classification: { isFiction: true, confidence: 'high', reason: 'stub' },
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
let db: Database

beforeEach(() => {
  vi.mocked(identify).mockReset()
  vi.mocked(lookupIsbn).mockReset()
  vi.mocked(lookupIsbn).mockResolvedValue(nothingFound())

  db = openDatabase(':memory:')
  store = new Store(db)
  // No image reader: most of these tests never run the worker. The ones that
  // do build their own queue with a reader below.
  queue = new CaptureQueue(db, () => null)
})

function add() {
  return queue.add({ front: 'f.jpg', back: 'b.jpg', edge: 'e.jpg' })
}

/** A real book, because captures.book_id is a foreign key. */
function addBook() {
  return store.addBook({ title: 'A Book', authors: ['Ann Author'], isFiction: true }).id
}

describe('queueing', () => {
  it('accepts a capture as pending so the camera never waits', () => {
    const capture = add()
    expect(capture.status).toBe('pending')
    expect(capture.back_image).toBe('b.jpg')
  })

  it('counts by status', () => {
    add()
    add()
    expect(queue.counts().pending).toBe(2)
    expect(queue.counts().ready).toBe(0)
  })

  it('keeps done captures out of the working list', () => {
    const capture = add()
    const bookId = addBook()
    queue.markDone(capture.id, bookId)
    expect(queue.list()).toHaveLength(0)
    expect(queue.get(capture.id)?.book_id).toBe(bookId)
  })

  it('lists oldest first, the order the worker drains them in', () => {
    // The web UI shows newest first, matching the physical stack, but that is
    // a display choice made on top of this list. What the worker claims next
    // must stay oldest first regardless of how anything displays the queue.
    const first = add()
    const second = add()
    const third = add()
    expect(queue.list().map((c) => c.id)).toEqual([first.id, second.id, third.id])
  })
})

describe('claiming, with two people on the same queue', () => {
  it('lets the first person claim', () => {
    const capture = add()
    expect(queue.claim(capture.id, 'alice').ok).toBe(true)
  })

  it('refuses a second person and names who holds it', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')

    const second = queue.claim(capture.id, 'bob')
    expect(second.ok).toBe(false)
    expect(second.heldBy).toBe('alice')
  })

  it('lets the same person reclaim after a refresh', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')
    expect(queue.claim(capture.id, 'alice').ok).toBe(true)
  })

  it('frees the capture when released', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')
    queue.release(capture.id, 'alice')
    expect(queue.claim(capture.id, 'bob').ok).toBe(true)
  })

  it('ignores a release from someone who does not hold it', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')
    queue.release(capture.id, 'bob')
    expect(queue.claim(capture.id, 'bob').ok).toBe(false)
  })

  it('expires a stale claim so a walked-away lease cannot block forever', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')

    // Backdate the claim past the lease window.
    db.prepare('UPDATE captures SET claimed_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), capture.id)

    expect(queue.claim(capture.id, 'bob').ok).toBe(true)
  })

  it('will not claim a capture that is already shelved', () => {
    const capture = add()
    queue.markDone(capture.id, addBook())
    expect(queue.claim(capture.id, 'alice').ok).toBe(false)
  })
})

describe('editing a capture while it is still in the queue', () => {
  it('persists what a person stated, so the next person opens their work', async () => {
    const capture = add()
    queue.claim(capture.id, 'alice')

    const result = await queue.edit(capture.id, 'alice', { title: 'Dune' })
    expect(result.ok).toBe(true)

    // Read back through a fresh handle: the point of the feature is that the
    // work survives the browser it was typed into.
    const reopened = new CaptureQueue(db, () => null).get(capture.id)!
    expect(editsOn(reopened).title).toBe('Dune')
    expect(reopened.title_guess).toBe('Dune')
    expect(reopened.edited_by).toBe('alice')
    expect(reopened.edited_at).not.toBeNull()
  })

  it('accumulates edits across a handoff instead of the second wiping the first', async () => {
    // The three-person workflow in one test: alice gets partway, puts the
    // book down, bob picks it up and adds to what she did.
    const capture = add()
    await queue.edit(capture.id, 'alice', { title: 'Dune' })
    queue.release(capture.id, 'alice')

    const second = await queue.edit(capture.id, 'bob', { publisher: 'Ace Books' })
    expect(second.ok).toBe(true)

    const stated = editsOn(queue.get(capture.id)!)
    expect(stated.title).toBe('Dune')
    expect(stated.publisher).toBe('Ace Books')
  })

  it('records a typed ISBN as manual, not as a barcode or an OCR guess', async () => {
    // #29: a barcode reading is self-validating, an OCR reading is a guess,
    // and a person reading the number off the book is a third thing. Filing
    // the third under either of the first two claims a provenance it has not
    // got.
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    const capture = add()

    await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    const row = queue.get(capture.id)!
    expect(row.isbn_source).toBe('manual')
    expect(editsOn(row).isbnSource).toBe('manual')
  })

  it('re-runs the lookup for a corrected ISBN, which is what makes it worth anything', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    // The case this actually happens in: the photographs failed, so somebody
    // is typing the number off the back of the book.
    const capture = add()
    db.prepare("UPDATE captures SET status = 'failed' WHERE id = ?").run(capture.id)

    const result = await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    expect(vi.mocked(lookupIsbn)).toHaveBeenCalledWith(DUNE, expect.anything())
    expect(result.ok && result.lookup?.title).toBe('Dune')
    // And the refetched record is on the capture, not only in the response:
    // correcting the key without refetching leaves the right number beside
    // the wrong book.
    const stated = editsOn(queue.get(capture.id)!)
    expect(stated.title).toBe('Dune')
    expect(stated.authors).toEqual(['Frank Herbert'])
    expect(queue.get(capture.id)!.status).toBe('ready')
  })

  it('keeps the digits even when no catalogue has them', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(nothingFound())
    const capture = add()

    await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    expect(queue.get(capture.id)!.isbn13).toBe(DUNE)
    expect(editsOn(queue.get(capture.id)!).isbn13).toBe(DUNE)
  })

  it('leaves the notes and location a person gave alone when the ISBN changes', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    const capture = add()

    await queue.edit(capture.id, 'alice', { notes: 'Spine is cracked', location: '2B' })
    await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    const stated = editsOn(queue.get(capture.id)!)
    expect(stated.notes).toBe('Spine is cracked')
    expect(stated.location).toBe('2B')
    expect(stated.title).toBe('Dune')
  })

  it('refuses an edit from someone who does not hold the claim', async () => {
    const capture = add()
    queue.claim(capture.id, 'alice')

    const result = await queue.edit(capture.id, 'bob', { title: 'Not Dune' })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('claimed')
    expect(result.ok === false && result.reason === 'claimed' && result.heldBy).toBe('alice')
    expect(editsOn(queue.get(capture.id)!)).toEqual({})
  })

  it('lets an edit take a claim that has gone stale', async () => {
    const capture = add()
    queue.claim(capture.id, 'alice')
    db.prepare('UPDATE captures SET claimed_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), capture.id)

    const result = await queue.edit(capture.id, 'bob', { title: 'Dune' })

    expect(result.ok).toBe(true)
    expect(queue.get(capture.id)!.claimed_by).toBe('bob')
  })

  it('renews the lease, so a long resolving session does not expire under it', async () => {
    const capture = add()
    queue.claim(capture.id, 'alice')
    const stale = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    db.prepare('UPDATE captures SET claimed_at = ? WHERE id = ?').run(stale, capture.id)

    await queue.edit(capture.id, 'alice', { title: 'Dune' })

    expect(queue.get(capture.id)!.claimed_at! > stale).toBe(true)
  })

  it('refuses to edit a capture that has already become a book', async () => {
    const capture = add()
    queue.markDone(capture.id, addBook())

    const result = await queue.edit(capture.id, 'alice', { title: 'Dune' })
    expect(result.ok === false && result.reason).toBe('done')
  })

  it('404s rather than inventing a capture', async () => {
    const result = await queue.edit(9999, 'alice', { title: 'Dune' })
    expect(result.ok === false && result.reason).toBe('missing')
  })

  it('tells apart a book nobody has opened from one somebody left as it was', async () => {
    // The queue's whole value is knowing what still wants attention, so a
    // person who read a capture and decided it was fine has to leave a mark.
    // An edit that states nothing is exactly that mark.
    const untouched = add()
    const checked = add()

    await queue.edit(checked.id, 'alice', {})

    expect(queue.get(untouched.id)!.edited_at).toBeNull()
    expect(queue.get(checked.id)!.edited_at).not.toBeNull()
    expect(queue.get(checked.id)!.edited_by).toBe('alice')
    // Looked at and left alone: nothing is claimed as a human decision.
    expect(editsOn(queue.get(checked.id)!)).toEqual({})
  })

  it('stops a resolved capture reading as failed', async () => {
    const capture = add()
    db.prepare("UPDATE captures SET status = 'failed' WHERE id = ?").run(capture.id)

    await queue.edit(capture.id, 'alice', { title: 'Dune' })

    expect(queue.get(capture.id)!.status).toBe('ready')
  })
})

/**
 * The sharp edge of #65.
 *
 * A person corrects an ISBN, another photograph arrives or the server
 * restarts, the worker re-reads the book, and the correction is gone. That is
 * the exact scenario this feature exists to enable, so it has to be shown not
 * to happen rather than reasoned about.
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
    const capture = running.attach(null, 'back', 'b.jpg')
    await running.drain()
    expect(running.get(capture.id)!.isbn13).toBe(RAMA)

    // A person, holding the book, says it is something else.
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await running.edit(capture.id, 'alice', { isbn13: DUNE })

    // Another photograph arrives, so the whole capture is read again.
    vi.mocked(identify).mockResolvedValue(readBarcode(RAMA))
    vi.mocked(lookupIsbn).mockResolvedValue(found(RAMA, 'Rendezvous with Rama', ['Arthur C. Clarke']))
    running.attach(capture.id, 'front', 'f.jpg')
    await running.drain()

    const after = running.get(capture.id)!
    expect(after.isbn13).toBe(DUNE)
    expect(after.isbn_source).toBe('manual')
    expect(editsOn(after).title).toBe('Dune')
    expect(after.status).toBe('ready')
  })

  it('still lets the worker fill in a field nobody has stated', async () => {
    // Precedence is per field, not per capture: somebody fixing a title must
    // not freeze the worker out of an ISBN nobody has an opinion about.
    const running = worker()
    const capture = running.attach(null, 'back', 'b.jpg')
    await running.edit(capture.id, 'alice', { notes: 'Water damage to the spine' })

    vi.mocked(identify).mockResolvedValue(readBarcode(DUNE))
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await running.drain()

    const after = running.get(capture.id)!
    expect(after.isbn13).toBe(DUNE)
    expect(after.isbn_source).toBe('barcode')
    // And the person's note is still there underneath it.
    expect(editsOn(after).notes).toBe('Water damage to the spine')
  })

  it('keeps the worker and the person in separate columns', async () => {
    // Why the correction cannot be lost even in principle: the worker owns
    // draft_json and a person owns edit_json, so a better photograph improves
    // the base without ever reaching what was laid over it.
    const running = worker()
    const capture = running.attach(null, 'back', 'b.jpg')

    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await running.edit(capture.id, 'alice', { isbn13: DUNE, title: 'Dune (Ace edition)' })

    vi.mocked(identify).mockResolvedValue(readBarcode(RAMA))
    vi.mocked(lookupIsbn).mockResolvedValue(found(RAMA, 'Rendezvous with Rama', ['Arthur C. Clarke']))
    await running.drain()

    const after = running.get(capture.id)!
    expect(JSON.parse(after.draft_json).title).toBe('Rendezvous with Rama')
    expect(editsOn(after).title).toBe('Dune (Ace edition)')
    // And what anybody is shown is the person's, because it goes on top.
    expect(after.title_guess).toBe('Dune (Ace edition)')
  })

  it('drops a "use Change ISBN" note once somebody has', async () => {
    const running = worker()
    const capture = running.attach(null, 'back', 'b.jpg')
    vi.mocked(identify).mockResolvedValue(readNothing())
    await running.drain()
    expect(running.get(capture.id)!.note).not.toBe('')

    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    await running.edit(capture.id, 'alice', { isbn13: DUNE })
    running.attach(capture.id, 'front', 'f.jpg')
    vi.mocked(identify).mockResolvedValue(readNothing())
    await running.drain()

    expect(running.get(capture.id)!.note).toBe('')
    expect(running.get(capture.id)!.status).toBe('ready')
  })
})

describe('photos arriving one at a time', () => {
  it('creates the capture on the first photo', () => {
    const capture = queue.attach(null, 'back', 'b.jpg')
    expect(capture.back_image).toBe('b.jpg')
    expect(capture.status).toBe('pending')
  })

  it('attaches later photos to the same capture', () => {
    const first = queue.attach(null, 'back', 'b.jpg')
    const second = queue.attach(first.id, 'front', 'f.jpg')
    const third = queue.attach(first.id, 'edge', 'e.jpg')

    expect(second.id).toBe(first.id)
    expect(third.id).toBe(first.id)
    expect(queue.counts().pending).toBe(1)

    const row = queue.get(first.id)!
    expect(row.back_image).toBe('b.jpg')
    expect(row.front_image).toBe('f.jpg')
    expect(row.edge_image).toBe('e.jpg')
  })

  it('marks a re-taken slot as needing another read', () => {
    const capture = queue.attach(null, 'back', 'b.jpg')
    db.prepare("UPDATE captures SET analysed = 'back,front', status = 'failed' WHERE id = ?")
      .run(capture.id)

    const again = queue.attach(capture.id, 'back', 'b2.jpg')
    expect(again.back_image).toBe('b2.jpg')
    // Back drops out of analysed; front, which did not change, stays.
    expect(again.analysed.split(',').filter(Boolean)).toEqual(['front'])
    expect(again.status).toBe('pending')
  })

  it('leaves a shelved capture alone', () => {
    const capture = queue.attach(null, 'back', 'b.jpg')
    queue.markDone(capture.id, addBook())
    expect(queue.attach(capture.id, 'front', 'f.jpg').status).toBe('done')
  })
})
