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

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
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
let db: Db

// Both databases, since stage F. Nothing below knows which. See testdb.ts.
beforeEach(async () => {
  vi.mocked(identify).mockReset()
  vi.mocked(lookupIsbn).mockReset()
  vi.mocked(lookupIsbn).mockResolvedValue(nothingFound())

  db = await openTestDatabase()
  store = new Store(db)
  // No image reader: most of these tests never run the worker. The ones that
  // do build their own queue with a reader below.
  queue = new CaptureQueue(db, () => null)
})

afterAll(closeTestDatabase)

async function add() {
  return await queue.add({ front: 'f.jpg', back: 'b.jpg', edge: 'e.jpg' })
}

/** A real book, because captures.book_id is a foreign key. */
async function addBook() {
  return (await store.addBook({ title: 'A Book', authors: ['Ann Author'], isFiction: true })).id
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
    const bookId = await addBook()
    await queue.markDone(capture.id, bookId)
    expect(await queue.list()).toHaveLength(0)
    expect((await queue.get(capture.id))?.book_id).toBe(bookId)
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
    await db.run('UPDATE captures SET claimed_at = ? WHERE id = ?',
      [new Date(Date.now() - 60 * 60 * 1000).toISOString(), capture.id])

    expect((await queue.claim(capture.id, 'bob')).ok).toBe(true)
  })

  it('will not claim a capture that is already shelved', async () => {
    const capture = await add()
    await queue.markDone(capture.id, await addBook())
    expect((await queue.claim(capture.id, 'alice')).ok).toBe(false)
  })
})

describe('editing a capture while it is still in the queue', () => {
  it('persists what a person stated, so the next person opens their work', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')

    const result = await queue.edit(capture.id, 'alice', { title: 'Dune' })
    expect(result.ok).toBe(true)

    // Read back through a fresh handle: the point of the feature is that the
    // work survives the browser it was typed into.
    const reopened = (await new CaptureQueue(db, () => null).get(capture.id))!
    expect(editsOn(reopened).title).toBe('Dune')
    expect(reopened.edited_by).toBe('alice')
    expect(reopened.edited_at).not.toBeNull()
  })

  /*
   * #156. `title_guess` is the first line OCR read off a cover, and it used to
   * take a stated title on top of that reading. One column holding both means
   * nothing that reads the row can tell a title somebody confirmed from a
   * machine's reading of a photograph, which is how the guess got into the
   * Title box in the first place. What a person stated stays in `edit_json`,
   * which is where every reader already looks for it.
   */
  it('does not write a stated title into the column that holds the guess', async () => {
    // The capture this is about: read, no ISBN found, and the one thing it
    // has to show for itself is a line off the cover.
    const capture = await add()
    await db.run("UPDATE captures SET title_guess = ?, status = 'failed' WHERE id = ?",
      ['S0NG 0F SOLOMQN', capture.id])

    await queue.edit(capture.id, 'alice', { title: 'Song of Solomon' })

    const after = (await queue.get(capture.id))!
    expect(after.title_guess).toBe('S0NG 0F SOLOMQN')
    expect(editsOn(after).title).toBe('Song of Solomon')
    // And the edit still settles the capture: a person who has named the book
    // has resolved it, whatever the photographs did or did not read.
    expect(after.status).toBe('ready')
  })

  it('accumulates edits across a handoff instead of the second wiping the first', async () => {
    // The three-person workflow in one test: alice gets partway, puts the
    // book down, bob picks it up and adds to what she did.
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
    // #29: a barcode reading is self-validating, an OCR reading is a guess,
    // and a person reading the number off the book is a third thing. Filing
    // the third under either of the first two claims a provenance it has not
    // got.
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    const capture = await add()

    await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    const row = (await queue.get(capture.id))!
    expect(row.isbn_source).toBe('manual')
    expect(editsOn(row).isbnSource).toBe('manual')
  })

  it('re-runs the lookup for a corrected ISBN, which is what makes it worth anything', async () => {
    vi.mocked(lookupIsbn).mockResolvedValue(found(DUNE, 'Dune', ['Frank Herbert']))
    // The case this actually happens in: the photographs failed, so somebody
    // is typing the number off the back of the book.
    const capture = await add()
    await db.run("UPDATE captures SET status = 'failed' WHERE id = ?", [capture.id])

    const result = await queue.edit(capture.id, 'alice', { isbn13: DUNE })

    expect(vi.mocked(lookupIsbn)).toHaveBeenCalledWith(DUNE, expect.anything())
    expect(result.ok && result.lookup?.title).toBe('Dune')
    // And the refetched record is on the capture, not only in the response:
    // correcting the key without refetching leaves the right number beside
    // the wrong book.
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
    await db.run('UPDATE captures SET claimed_at = ? WHERE id = ?',
      [new Date(Date.now() - 60 * 60 * 1000).toISOString(), capture.id])

    const result = await queue.edit(capture.id, 'bob', { title: 'Dune' })

    expect(result.ok).toBe(true)
    expect((await queue.get(capture.id))!.claimed_by).toBe('bob')
  })

  it('renews the lease, so a long resolving session does not expire under it', async () => {
    const capture = await add()
    await queue.claim(capture.id, 'alice')
    const stale = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    await db.run('UPDATE captures SET claimed_at = ? WHERE id = ?', [stale, capture.id])

    await queue.edit(capture.id, 'alice', { title: 'Dune' })

    expect((await queue.get(capture.id))!.claimed_at! > stale).toBe(true)
  })

  it('refuses to edit a capture that has already become a book', async () => {
    const capture = await add()
    await queue.markDone(capture.id, await addBook())

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
    const untouched = await add()
    const checked = await add()

    await queue.edit(checked.id, 'alice', {})

    expect((await queue.get(untouched.id))!.edited_at).toBeNull()
    expect((await queue.get(checked.id))!.edited_at).not.toBeNull()
    expect((await queue.get(checked.id))!.edited_by).toBe('alice')
    // Looked at and left alone: nothing is claimed as a human decision.
    expect(editsOn((await queue.get(checked.id))!)).toEqual({})
  })

  it('stops a resolved capture reading as failed', async () => {
    const capture = await add()
    await db.run("UPDATE captures SET status = 'failed' WHERE id = ?", [capture.id])

    await queue.edit(capture.id, 'alice', { title: 'Dune' })

    expect((await queue.get(capture.id))!.status).toBe('ready')
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
    // And the person's note is still there underneath it.
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
    // And what anybody is shown is the person's, because it goes on top. Read
    // out of edit_json, not off a column the worker also writes: `title_guess`
    // is the cover reading and only that, so the two remain tellable apart on
    // the row itself (#156).
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
    await db.run("UPDATE captures SET analysed = 'back,front', status = 'failed' WHERE id = ?",
      [capture.id])

    const again = await queue.attach(capture.id, 'back', 'b2.jpg')
    expect(again.back_image).toBe('b2.jpg')
    // Back drops out of analysed; front, which did not change, stays.
    expect(again.analysed.split(',').filter(Boolean)).toEqual(['front'])
    expect(again.status).toBe('pending')
  })

  it('leaves a shelved capture alone', async () => {
    const capture = await queue.attach(null, 'back', 'b.jpg')
    await queue.markDone(capture.id, await addBook())
    expect((await queue.attach(capture.id, 'front', 'f.jpg')).status).toBe('done')
  })
})

describe('two drains at once', () => {
  /**
   * The guard `drain` puts on itself, watched rather than assumed.
   *
   * Every shutter fires `void drain()` and the server fires one more at boot,
   * so overlapping calls are the normal case rather than an exotic one. If a
   * second pass could start while the first is suspended, both would take the
   * same row off the top of the pending queue and read the same photographs
   * twice, which with two people scanning into one server is how a capture
   * gets claimed by two workers at once.
   *
   * Asserting on the number of photographs read is what makes that visible: a
   * second pass that duplicated the work would read three or four rather than
   * one per capture, whatever the rows ended up saying afterwards.
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
 * The breakdown Home counts from (#148).
 *
 * `failed` is one status over three situations, and Home used to read it as
 * one: "9 need an ISBN by hand" when five of the nine carried a valid ISBN off
 * a barcode. Driven through the worker rather than by writing rows by hand,
 * because the defect was reading a reason out of a status, so a test that set
 * the reason itself would prove nothing about what the worker actually writes.
 */
describe('why the failed ones failed', () => {
  it('tells a barcode no catalogue has apart from a photo with no ISBN on it', async () => {
    const running = new CaptureQueue(db, () => Buffer.from('a photograph'))

    // Read cleanly off a barcode, so the number on the row is right. Nothing
    // has it, which is a different job for a person entirely.
    vi.mocked(identify).mockResolvedValue(readBarcode(DUNE))
    vi.mocked(lookupIsbn).mockResolvedValue(nothingFound())
    const uncatalogued = await running.attach(null, 'back', 'b1.jpg')
    await running.drain()

    // Nothing readable on the photographs at all. This one does need typing in.
    vi.mocked(identify).mockResolvedValue(readNothing())
    const blank = await running.attach(null, 'back', 'b2.jpg')
    await running.drain()

    const counts = await running.counts()
    expect(counts.failed).toBe(2)
    expect(counts.failures).toEqual({ noIsbn: 1, uncatalogued: 1, errored: 0 })

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
    expect(counts.failures).toEqual({ noIsbn: 0, uncatalogued: 0, errored: 1 })
  })

  it('reports nothing wrong when nothing has failed', async () => {
    await add()
    expect((await queue.counts()).failures)
      .toEqual({ noIsbn: 0, uncatalogued: 0, errored: 0 })
  })
})

/**
 * What the scanner is allowed to compare a photograph against (#122).
 *
 * Each exclusion here is the difference between a useful answer and a wrong
 * one, so each is asserted on its own rather than through the route.
 */
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
    // Not waiting for anybody. It is on a shelf, and the books path answers
    // for it, so sending somebody to finish it sends them to a dead end.
    const id = await hashed()
    await queue.markDone(id, await addBook())
    expect(await queue.waiting()).toEqual([])
  })

  it('leaves out one nobody has hashed', async () => {
    // An empty hash is the absence of a measurement, not a weak one.
    await add()
    expect(await queue.waiting()).toEqual([])
  })

  it('leaves out one whose front photograph was refused as featureless', async () => {
    // `coverHash` declines a frame with no detail in it, and `deriveCapture`
    // leaves the column empty rather than storing something that would go on
    // to be compared. That refusal has to survive all the way to here.
    const capture = await add()
    await queue.setFrontHash(capture.id, '')
    expect(await queue.waiting()).toEqual([])
  })

  it('keeps a failed capture, which is the one most likely to still be sitting there', async () => {
    // The read failed. The photographs did not, and neither did the book.
    const id = await hashed()
    await db.run("UPDATE captures SET status = 'failed' WHERE id = ?", [id])
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
 * The same question asked of the identifier rather than of the pictures (#146).
 *
 * `waiting` above is what a photograph gets compared against, and it is a
 * measurement with a band and a measured error rate. This is the other kind of
 * evidence: an ISBN-13 either satisfies its check digit or is thrown away, so
 * two captures carrying the same one are two captures of the same title, and
 * the filters that make sense for a comparison do not apply to it.
 */
describe('captures waiting under the same ISBN', () => {
  const withIsbn = async (isbn13: string) => {
    const capture = await add()
    await db.run('UPDATE captures SET isbn13 = ? WHERE id = ?', [isbn13, capture.id])
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
    // The case that would be worst if it were wrong. Every capture nobody has
    // read yet carries an empty string in this column, so an unguarded query
    // would report each of them as a duplicate of all the others.
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
    await queue.markDone(shelved, await addBook())

    expect(await queue.sharingIsbn(DUNE, mine)).toEqual([])
  })

  it('offers one whose front has not been photographed yet', async () => {
    // The difference from `waiting`, and the case this exists for. The back
    // cover is the first shot the Add flow takes and it carries the barcode,
    // so the likeliest duplicate in the queue is a capture with an ISBN, no
    // front photograph and no hash. Filtering on either would lose it.
    const capture = await queue.attach(null, 'back', 'b.jpg')
    await db.run('UPDATE captures SET isbn13 = ? WHERE id = ?', [DUNE, capture.id])
    const mine = await withIsbn(DUNE)

    const found = await queue.sharingIsbn(DUNE, mine)
    expect(found.map((c) => c.id)).toEqual([capture.id])
    expect(found[0]!.front_image).toBe('')
    expect(found[0]!.front_hash).toBe('')
  })

  it('answers for a photograph that is not a capture at all', async () => {
    // The scan route asks this with no capture of its own, so there is nothing
    // to exclude and nothing may be excluded by accident.
    const id = await withIsbn(DUNE)
    expect((await queue.sharingIsbn(DUNE)).map((c) => c.id)).toEqual([id])
  })
})
