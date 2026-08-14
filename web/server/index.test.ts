/**
 * Route-level coverage for index.ts, prioritised the way the routes carry
 * risk: writes to the catalogue first, then the one property the camera
 * recognition route is not allowed to break (a cover-hash match must never
 * write), then the failure paths a defect would turn into a 500 instead of a
 * clean 4xx.
 *
 * Deliberately not exhaustive over the read-only listing routes: those are
 * thin wrappers over Store and Shelves, both of which already have direct
 * coverage in store.test.ts and shelves.test.ts.
 *
 * The app is built with createApp() against a real in-memory SQLite database
 * and a scratch cover directory inside this file's own scratch root (see
 * ./scratchdir), started on an ephemeral port and driven with real HTTP
 * requests.
 * There is no supertest in this project's dependencies and this suite must
 * not add one (web/package.json is off limits), so a listening server and
 * the platform fetch stand in for it.
 *
 * Two things are stubbed rather than real: Open Library and Google Books.
 * Saving a book kicks off an un-awaited cover fetch, and a real network call
 * there would make this suite depend on the internet being up. `./identify`
 * is not stubbed: barcode decoding is real, and the fixtures below stay
 * clear of the multi-second OCR pipeline that identify.test.ts already pays
 * for. Most are read by the fast, non-OCR pass; one is deliberately shrunk
 * past what that pass can resolve, because the defect in #66 only shows on
 * the photos it misses.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeTestDatabase, openTestDatabase, testDatabaseUrl } from './testdb'
import type { Db } from './driver'
import { createApp, openCatalogue } from './index'
import { lookupIsbn } from './lookup'
import { Store } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import type { SeparatorKind } from '../shared/layout'
import { genreStatedBy } from '../domain/tagging/genre'
import { coverHash } from './imagehash'
import { CaptureQueue } from './queue'
import { backCover, frontCover, photographedBook } from './fixtures'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'

// Both routes that would otherwise reach the real catalogues. Saving a book
// starts an un-awaited `fetchCoverFor`, which calls both.
// The factory is async so it can import the slug rather than spell it a second
// time: `vi.mock` is hoisted above every import in this file, so the one at the
// top is not in scope inside it.
vi.mock('./lookup', async () => {
  const { FICTION_SLUG } = await import('../domain/tagging/catalogue-claims')
  const empty = {
    found: false, title: '', subtitle: '', authors: [] as string[], publisher: '',
    published: '', pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
    coverUrl: '', source: '',
    classification: { genre: FICTION_SLUG, confidence: 'unknown' as const, reason: 'stub' },
    notes: [] as string[],
  }
  return {
    lookupIsbn: vi.fn(async () => ({ ...empty })),
    searchTitle: vi.fn(async () => ({ ...empty })),
  }
})

vi.mock('./covers', () => ({
  downloadCover: vi.fn(async () => ''),
  openLibraryCover: (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
  upgradeGoogleCover: (url: string) => url,
}))

const DUNE = '9780441013593'

/**
 * A hash a stated number of bits away from another one.
 *
 * Seeding a decoy with a distance rather than with a second generated cover
 * is what makes the band under test the thing the test states: 12 bits is
 * inside the shortlist cutoff of 24 and well outside the close band of 8, so
 * it is precisely the weak guess the scan route used to answer with, and
 * precisely what a queue match has to refuse.
 */
function nudgeHash(hash: string, bits: number): string {
  let out = ''
  let left = bits
  for (const character of hash.slice(2)) {
    // Four bits per hex digit, flipped low bits first.
    const flip = (1 << Math.min(4, left)) - 1
    out += (parseInt(character, 16) ^ flip).toString(16)
    left -= Math.min(4, left)
  }
  return hash.slice(0, 2) + out
}

/**
 * This file's own, and no other file's.
 *
 * It used to be `web/data`, shared with four other test files, and the
 * `afterAll` below removed the whole of it rather than what this file had made
 * inside it. That is #297: the four still running lost the directory they were
 * writing in, mid-run.
 */
let scratch: string

beforeAll(() => {
  scratch = scratchRoot('index')
})

interface Running {
  db: Db
  store: Store
  coverDir: string
  baseUrl: string
  /**
   * Wait for the work a save started and nobody awaited, then close the port.
   *
   * Both halves matter and the order does. A cover fetch, a hash and a crop
   * outlive the request that started them, so closing the database or deleting
   * the cover directory while they run is a rejection nobody is waiting for.
   * See `BookScanApp.settled`, and #194, where exactly that reached CI.
   */
  close: () => Promise<void>
}

async function startApp(): Promise<Running> {
  const db = await openTestDatabase()
  const coverDir = mkdtempSync(join(scratch, 'index-test-'))
  const app = createApp({ db, coverDir, startBackgroundWork: false })

  const server: Server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  return {
    db,
    store: new Store(db, new DrizzleAuthorRepository(db)),
    coverDir,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await app.settled()
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

let running: Running

beforeEach(async () => {
  running = await startApp()
})

afterEach(async () => {
  await running.close()
  rmSync(running.coverDir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

/** A JSON request against the running app, method defaults to GET. */
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${running.baseUrl}${path}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const post = (path: string, body: unknown) =>
  call(path, { method: 'POST', body: JSON.stringify(body) })
const put = (path: string, body: unknown) =>
  call(path, { method: 'PUT', body: JSON.stringify(body) })
const patch = (path: string, body: unknown) =>
  call(path, { method: 'PATCH', body: JSON.stringify(body) })
const del = (path: string) => call(path, { method: 'DELETE' })

const dataUrl = (buffer: Buffer) => `data:image/png;base64,${buffer.toString('base64')}`

/**
 * Cut the fiction run into more planks, so a fixture has somewhere to put a book.
 *
 * A test database stands as migration `0013` leaves it: one area per run, so
 * `1A` and `4A` are the only planks the furniture has, and since #232 a label
 * naming any other one is refused rather than recorded. This is the boundary
 * `POST /api/shelves/overflow` writes, taken directly, because these fixtures
 * want the plank to exist rather than a book pushed off the end of one.
 *
 * Each `area` adds a plank to the bookcase the run is on and each `shelf` starts
 * the next bookcase. The anchors sort above every key these fixtures write, so
 * what this adds is furniture rather than a rearrangement of the books.
 */
async function splitFiction(...kinds: SeparatorKind[]): Promise<void> {
  const separators = new DrizzleSeparatorRepository(running.db)
  for (const [at, kind] of kinds.entries()) {
    await separators.add({
      range: 'fiction',
      kind,
      startsAt: `~${at}`,
      position: at,
      note: '',
      createdAt: new Date().toISOString(),
    })
  }
}

/**
 * Put a queued book on a shelf, which is how a book leaves the queue (#183).
 *
 * This used to be `CaptureQueue.markDone(captureId, bookId)`, pairing a capture
 * with a book added separately. The capture and the book are one row now, so
 * there is nothing to pair: shelving it is `Store.updateBook`, which is what
 * `POST /api/books` calls.
 */
const shelve = (id: number) => {
  const draft = { title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG }
  // The range comes in beside the draft since #223, because it is settled
  // against `book_tag` before the row is written. This shelves a book without
  // going through the route, so it states the genre the draft states.
  return running.store.updateBook(id, draft, genreStatedBy(draft).range)
}

/** The state a queued book is in, said in the queue's own vocabulary. */
const stateFor = (status: string) =>
  ({ pending: 'scanned', ready: 'identified', failed: 'unidentified' }[status] ?? status)

// ---------------------------------------------------------------------------
// 1. Routes that write to the catalogue
// ---------------------------------------------------------------------------

describe('saving a book', () => {
  it('persists it and answers with where it landed', async () => {
    const { status, body } = await post('/api/books', {
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, isbn13: DUNE,
    })

    expect(status).toBe(201)
    expect(body.id).toBeGreaterThan(0)
    expect(body.counts).toEqual({ total: 1, fiction: 1, nonfiction: 0, checkedOut: 0 })
    expect(body.placement.suggestedLocation).toBe('1A')

    const stored = await running.store.getBook(body.id)
    expect(stored?.title).toBe('Dune')
    expect(stored?.isbn13).toBe(DUNE)
    // Placed automatically, since the request carried no location of its own.
    expect(stored?.location).toBe('1A')
  })

  it('refuses a book with no title rather than saving a blank one', async () => {
    const { status, body } = await post('/api/books', { authors: ['Nobody'], genre: FICTION_SLUG })

    expect(status).toBe(400)
    expect(body.error).toContain('title')
    expect((await running.store.counts()).total).toBe(0)
  })

  it('records the location a person actually gave it, not the auto-placement', async () => {
    // The auto-placed label for the very first book is always 1A; asking for
    // 1C proves the client's answer wins rather than being silently
    // overwritten by the derived one.
    await splitFiction('area', 'area')
    const { body } = await post('/api/books', {
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, location: '1C',
    })

    expect((await running.store.getBook(body.id))?.location).toBe('1C')
  })
})

/**
 * A database that drops one statement, the way a connection going away under a
 * query does.
 *
 * Everything else is the real database, because the thing under test is what
 * the app does with one rejection and not how a store behaves against a fake.
 */
function hiccupsOn(db: Db, statement: string): Db {
  const check = async (sql: string) => {
    // The message pg-pool actually raises when the server goes away mid-query,
    // quoted so the log line this produces reads like the one in #203.
    if (sql.includes(statement)) throw new Error('Connection terminated unexpectedly')
  }
  return {
    all: async <Row>(sql: string, params?: Parameters<Db['all']>[1]) => {
      await check(sql)
      return db.all<Row>(sql, params)
    },
    get: async <Row>(sql: string, params?: Parameters<Db['get']>[1]) => {
      await check(sql)
      return db.get<Row>(sql, params)
    },
    run: async (sql: string, params?: Parameters<Db['run']>[1]) => {
      await check(sql)
      return db.run(sql, params)
    },
    tx: <T>(work: (inner: Db) => Promise<T>, options?: Parameters<Db['tx']>[1]) =>
      db.tx((inner) => work(hiccupsOn(inner, statement)), options),
    // Not this wrapper's to close: it does not own the database it borrowed.
    close: async () => {},
  }
}

/**
 * The defect in #203, reproduced against a running app by killing the Postgres
 * container in the second after a save and watching the api process end:
 *
 *   Error: Connection terminated unexpectedly
 *       at async PgDb.run (web/server/db.pg.ts:588:20)
 *       at async Store.setCoverImage (web/server/store.ts:721:5)
 *       at async fetchCoverFor (web/server/index.ts:1997:5)
 *   Node.js v22.14.0
 *
 * Nothing awaits the chain a save starts, so since Node 15 a rejection in it is
 * an uncaught exception and the process ends. What that costs is not a cover:
 * it is the app going away under somebody standing at a bookcase holding a
 * book, with nothing on screen saying why.
 */
describe('a database hiccup in the work a save started', () => {
  it('says what failed and keeps serving, instead of taking the process down', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const coverDir = mkdtempSync(join(scratch, 'index-hiccup-'))
    // `Store.setCoverImage`, the first write the un-awaited chain makes and one
    // of the four calls #203 names.
    const app = createApp({
      db: hiccupsOn(running.db, 'UPDATE books SET cover_checked_at'),
      coverDir,
      startBackgroundWork: false,
    })
    const server: Server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    try {
      const saved = await fetch(`${base}/api/books`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, isbn13: DUNE,
        }),
      })
      expect(saved.status).toBe(201)
      const { id } = (await saved.json()) as { id: number }

      await app.settled()

      // Loud, and it names the book and the work rather than only the driver.
      // A cover that failed in silence is indistinguishable from a cover
      // nobody ever went looking for, which is the distinction #192 exists to
      // keep.
      const said = reported.mock.calls.map((call) => String(call[0])).join('\n')
      expect(said).toContain(
        `background work failed, filling in the cover, hashes and crops of book ${id}`,
      )

      // Still answering, which is the whole point: the row is committed and the
      // person can carry on scanning.
      const health = await fetch(`${base}/api/health`)
      expect(health.status).toBe(200)

      // And the book is still on the "never looked for a cover" list rather
      // than stamped as looked at, so the backfill asks again.
      expect((await running.store.missingCovers(10)).map((row) => row.id)).toContain(id)
    } finally {
      reported.mockRestore()
      await app.settled()
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
      rmSync(coverDir, { recursive: true, force: true })
    }
  })
})

describe('updating a book', () => {
  it('edits an existing book in place', async () => {
    const { id } = await running.store.addBook({
      title: 'Old Title', authors: ['Ann Author'], genre: FICTION_SLUG,
    })

    const { status, body } = await put(`/api/books/${id}`, {
      title: 'New Title', authors: ['Ann Author'], genre: FICTION_SLUG,
    })

    expect(status).toBe(200)
    expect(body.id).toBe(id)
    expect((await running.store.getBook(id))?.title).toBe('New Title')
    expect((await running.store.counts()).total).toBe(1) // edited, not duplicated
  })

  it('404s on a book that does not exist, and writes nothing', async () => {
    const { status, body } = await put('/api/books/999', {
      title: 'X', authors: ['Y'], genre: FICTION_SLUG,
    })

    expect(status).toBe(404)
    expect(body.error).toContain('No such book')
    expect((await running.store.counts()).total).toBe(0)
  })

  it('400s when the edit drops the title, and leaves the row untouched', async () => {
    const { id } = await running.store.addBook({
      title: 'Keep Me', authors: ['Ann Author'], genre: FICTION_SLUG,
    })

    const { status } = await put(`/api/books/${id}`, { authors: ['Ann Author'], genre: FICTION_SLUG })

    expect(status).toBe(400)
    expect((await running.store.getBook(id))?.title).toBe('Keep Me')
  })
})

describe('cropping a saved book to the book', () => {
  /** The crop runs after the response, so the test has to wait for it. */
  async function untilCropped(id: number, within = 15_000): Promise<void> {
    const deadline = Date.now() + within
    for (;;) {
      if (((await running.store.getBook(id))?.cropped ?? '') !== '') return
      if (Date.now() > deadline) throw new Error('the crop never ran')
      await new Promise((done) => setTimeout(done, 50))
    }
  }

  it('writes a crop beside the photo and leaves the photo alone', async () => {
    const scene = await photographedBook(
      await frontCover('The Dispossessed', 'Ursula K. Le Guin'),
      { seed: 5, width: 800, height: 1100, fill: 0.5, background: 'carpet' },
    )

    const { body } = await post('/api/books', {
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG,
      images: { front: `data:image/jpeg;base64,${scene.image.toString('base64')}` },
    })

    await untilCropped(body.id)
    const book = (await running.store.getBook(body.id))!

    expect(book.front_image).toBeTruthy()
    expect(book.front_crop).toBe(`${book.front_image.replace(/\.jpg$/, '')}_crop.jpg`)

    // Both files are on disk, and the photograph is exactly the bytes that
    // were uploaded. Nothing in this path may ever rewrite that file.
    const photo = readFileSync(join(running.coverDir, book.front_image))
    const crop = readFileSync(join(running.coverDir, book.front_crop))
    expect(photo.equals(scene.image)).toBe(true)
    expect(crop.equals(photo)).toBe(false)

    // Served by the same route the photos are, with no extra wiring.
    const served = await fetch(`${running.baseUrl}/api/covers/${book.front_crop}`)
    expect(served.status).toBe(200)
  }, 30_000)

  it('keeps the whole photo, and says it looked, when there is no book in it', async () => {
    const flat = await sharp({
      create: { width: 500, height: 700, channels: 3, background: '#6b6b6b' },
    }).jpeg().toBuffer()

    const { body } = await post('/api/books', {
      title: 'Nothing There', authors: ['Ann Author'], genre: FICTION_SLUG,
      images: { front: `data:image/jpeg;base64,${flat.toString('base64')}` },
    })

    await untilCropped(body.id)
    const book = (await running.store.getBook(body.id))!

    expect(book.front_image).toBeTruthy()
    expect(book.front_crop).toBe('')
    expect(book.cropped).toBe('front')
  }, 30_000)

  it('takes the crop with the book when the book is deleted', async () => {
    const scene = await photographedBook(
      await frontCover('Short Lived', 'Ann Author'),
      { seed: 6, width: 800, height: 1100, fill: 0.5, background: 'carpet' },
    )

    const { body } = await post('/api/books', {
      title: 'Short Lived', authors: ['Ann Author'], genre: FICTION_SLUG,
      images: { front: `data:image/jpeg;base64,${scene.image.toString('base64')}` },
    })

    await untilCropped(body.id)
    const book = (await running.store.getBook(body.id))!
    expect(book.front_crop).toBeTruthy()

    await del(`/api/books/${body.id}`)

    expect(existsSync(join(running.coverDir, book.front_image))).toBe(false)
    // Derived, but still a file, and nothing else will ever name it.
    expect(existsSync(join(running.coverDir, book.front_crop))).toBe(false)
  }, 30_000)
})

describe('deleting a book', () => {
  it('removes it from the catalogue', async () => {
    const { id } = await running.store.addBook({
      title: 'Gone Soon', authors: ['Ann Author'], genre: FICTION_SLUG,
    })

    const { status, body } = await del(`/api/books/${id}`)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(await running.store.getBook(id)).toBeUndefined()
    expect((await running.store.counts()).total).toBe(0)
  })

  it('404s on an id that was never there', async () => {
    const { status, body } = await del('/api/books/999')
    expect(status).toBe(404)
    expect(body.error).toContain('No such book')
  })
})

describe('updating a location', () => {
  it('records where a person says the book actually is', async () => {
    await splitFiction('shelf', 'area', 'area')
    const { id } = await running.store.addBook({
      title: 'X', authors: ['Ann Author'], genre: FICTION_SLUG, location: '1A',
    })

    const { status, body } = await patch(`/api/books/${id}/location`, { location: '2C' })

    expect(status).toBe(200)
    expect(body.book.location).toBe('2C')
    expect((await running.store.getBook(id))?.location).toBe('2C')
  })

  /**
   * The route used to read an empty label as "take this book back to
   * never-placed", and that claim cannot be made any more (#232).
   *
   * The ledger is append only, so there is nothing to unsay; and neither state a
   * book off the shelves can be in says "nowhere", because `withdrawn` means
   * given away and `checked_out` means it is in somebody's bag. So the route
   * refuses and says which of the two the person probably meant.
   */
  it('refuses an empty label rather than taking the book back to never-placed', async () => {
    const { id } = await running.store.addBook({
      title: 'X', authors: ['Ann Author'], genre: FICTION_SLUG, location: '1A',
    })

    const { status, body } = await patch(`/api/books/${id}/location`, { location: '' })

    expect(status).toBe(400)
    expect(body.error).toContain('checked out or withdrawn')
    // The book is still on the plank the last person to carry it named.
    expect((await running.store.getBook(id))?.location).toBe('1A')
  })

  /**
   * A label that parses and names furniture nobody owns, which is the second
   * thing this route used to accept (#232).
   *
   * `9Z` is a location as far as `parseLocation` is concerned, so it went into
   * the column, no area row held it, and the app disagreed with itself about the
   * same book from then on. There is nothing behind the ledger to hold such a
   * label, so the write refuses and names the plank rather than half-happening.
   */
  it('refuses a plank the furniture does not have, and names it', async () => {
    const { id } = await running.store.addBook({
      title: 'X', authors: ['Ann Author'], genre: FICTION_SLUG, location: '1A',
    })

    const { status, body } = await patch(`/api/books/${id}/location`, { location: '9Z' })

    expect(status).toBe(400)
    expect(body.error).toContain('9Z')
    expect((await running.store.getBook(id))?.location).toBe('1A')
  })

  it('refuses a label that is not a real location, and does not touch the row', async () => {
    const { id } = await running.store.addBook({
      title: 'X', authors: ['Ann Author'], genre: FICTION_SLUG, location: '1A',
    })

    const { status, body } = await patch(`/api/books/${id}/location`, { location: 'the loft' })

    expect(status).toBe(400)
    expect(body.error).toContain('the loft')
    expect((await running.store.getBook(id))?.location).toBe('1A')
  })

  it('404s on a book that does not exist', async () => {
    const { status } = await patch('/api/books/999/location', { location: '1A' })
    expect(status).toBe(404)
  })
})

describe('checking a book out and back in by id', () => {
  it('takes it off the shelf the first time', async () => {
    const { id } = await running.store.addBook({ title: 'X', authors: ['Ann Author'], genre: FICTION_SLUG })

    const { status, body } = await post(`/api/books/${id}/checkout`, { out: true })

    expect(status).toBe(200)
    expect(body.outcome).toBe('checked-out')
    expect(body.book.checked_out_at).not.toBeNull()
    expect(body.counts.checkedOut).toBe(1)
  })

  it('reports already-out on a second checkout and keeps the original timestamp', async () => {
    const { id } = await running.store.addBook({ title: 'X', authors: ['Ann Author'], genre: FICTION_SLUG })
    const first = await post(`/api/books/${id}/checkout`, { out: true })

    const second = await post(`/api/books/${id}/checkout`, { out: true })

    expect(second.body.outcome).toBe('already-out')
    expect(second.body.book.checked_out_at).toBe(first.body.book.checked_out_at)
  })

  it('checks it back in, clearing the timestamp', async () => {
    const { id } = await running.store.addBook({ title: 'X', authors: ['Ann Author'], genre: FICTION_SLUG })
    await post(`/api/books/${id}/checkout`, { out: true })

    const { status, body } = await post(`/api/books/${id}/checkout`, { out: false })

    expect(status).toBe(200)
    expect(body.outcome).toBe('checked-in')
    expect(body.book.checked_out_at).toBeNull()
  })

  it('reports already-in for a book already on the shelf, as a no-op', async () => {
    const { id } = await running.store.addBook({ title: 'X', authors: ['Ann Author'], genre: FICTION_SLUG })

    const { body } = await post(`/api/books/${id}/checkout`, { out: false })

    expect(body.outcome).toBe('already-in')
    expect(body.book.checked_out_at).toBeNull()
  })

  it('404s on a book that does not exist', async () => {
    const { status, body } = await post('/api/books/999/checkout', { out: true })
    expect(status).toBe(404)
    expect(body.error).toContain('No such book')
  })
})

// ---------------------------------------------------------------------------
// 1b. Shelving: a placement a person confirmed has to survive the flow
// ---------------------------------------------------------------------------

/**
 * Putting a book on a shelf, driven the way the client drives it.
 *
 * Each of these ends by asking /api/misfiles, because that is the thing the
 * recorded location exists to be reconciled against. A location that is
 * written but still reported as wrong is no better than one that was never
 * written, and reporting the move somebody has just been walked through
 * making is exactly what #61 was.
 */
describe('shelving a book onto a bookcase', () => {
  const seed = async (title: string, author: string): Promise<number> => {
    const { status, body } = await post('/api/books', {
      title, authors: [author], genre: FICTION_SLUG,
    })
    expect(status, `seeding ${title}`).toBe(201)
    return body.id as number
  }

  const misfiles = async () => (await call('/api/misfiles?range=fiction')).body

  it('leaves a book put back where the app said out of the misfile list', async () => {
    // The second bookcase this test carries a book to. Anchored above both
    // books, so it is furniture standing empty rather than a boundary that has
    // already moved one of them.
    await splitFiction('shelf')
    const rama = await seed('Rendezvous with Rama', 'Arthur C. Clarke')
    const dispossessed = await seed('The Dispossessed', 'Ursula K. Le Guin')
    expect((await running.store.getBook(rama))?.location).toBe('1A')

    // Somebody moved it and it was never recorded, which is the state a book
    // is in when the library reports it. What it is told to do next is the
    // instruction the shelving step then renders.
    await patch(`/api/books/${dispossessed}/location`, { location: '2A' })
    const before = await misfiles()
    expect(before.misfiles).toHaveLength(1)
    expect(before.misfiles[0].book.id).toBe(dispossessed)
    expect(before.misfiles[0].to).toBe('1A')

    // Off the bookcase, then back on through the shelving step: the PUT
    // carries the draft the detail view holds, stale location and all, and
    // the confirmed shelf goes through the location route.
    await post(`/api/books/${dispossessed}/checkout`, { out: true })
    const { status } = await put(`/api/books/${dispossessed}`, {
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG,
      location: '2A',
    })
    expect(status).toBe(200)
    await patch(`/api/books/${dispossessed}/location`, { location: '1A' })
    await post(`/api/books/${dispossessed}/checkout`, { out: false })

    expect((await running.store.getBook(dispossessed))?.location).toBe('1A')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('names the book a shuffle displaces, so where it lands can be recorded', async () => {
    await seed('Rendezvous with Rama', 'Arthur C. Clarke')
    const dispossessed = await seed('The Dispossessed', 'Ursula K. Le Guin')

    const { status, body } = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area',
    })

    expect(status).toBe(200)
    expect(body.step.id).toBe(dispossessed)
    expect(body.step.title).toBe('The Dispossessed')
    expect(body.step.from).toBe('1A')
    expect(body.step.to).toBe('1B')
  })

  /**
   * The book being placed belongs at the END of a full shelf.
   *
   * Then it is the one that moves, and nothing on a shelf is touched. The
   * route needs the sort key of a book that does not exist yet to see this at
   * all, which is what /api/placement/preview hands the client.
   */
  const previewKey = async (title: string, author: string): Promise<string> => {
    const { status, body } = await post('/api/placement/preview', {
      title, authors: [author], genre: FICTION_SLUG,
    })
    expect(status, `previewing ${title}`).toBe(200)
    return body.sortKey as string
  }

  it('moves the book in hand, not a shelved one, when it belongs at the end', async () => {
    const rama = await seed('Rendezvous with Rama', 'Arthur C. Clarke')
    const gibson = await seed('Neuromancer', 'William Gibson')
    const dispossessed = await seed('The Dispossessed', 'Ursula K. Le Guin')

    // 1A holds Clarke and Gibson; Le Guin has been pushed on to 1B.
    const split = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area',
    })
    await patch(`/api/books/${split.body.step.id}/location`, { location: split.body.step.to })
    expect((await misfiles()).misfiles).toEqual([])

    // Dune files after Gibson and before Le Guin, so nothing on 1A follows it.
    const sortKey = await previewKey('Dune', 'Frank Herbert')
    const { status, body } = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area', sortKey,
    })

    expect(status).toBe(200)
    expect(body.carry).toEqual({ from: '1A', to: '1B' })
    expect(body.step).toBeNull()
    expect(body.moves).toEqual([])

    // Nobody was asked to pick up a book that was already on a shelf.
    expect((await running.store.getBook(rama))?.location).toBe('1A')
    expect((await running.store.getBook(gibson))?.location).toBe('1A')
    expect((await running.store.getBook(dispossessed))?.location).toBe('1B')
    expect((await misfiles()).misfiles).toEqual([])

    // And saving it puts it exactly where the answer said it would go.
    const saved = await post('/api/books', {
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG,
    })
    expect((await running.store.getBook(saved.body.id))?.location).toBe('1B')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('still displaces a book when the gap is in the middle of the shelf', async () => {
    // The cascade is not weakened: something really does have to move here.
    await seed('Rendezvous with Rama', 'Arthur C. Clarke')
    const gibson = await seed('Neuromancer', 'William Gibson')
    await seed('The Dispossessed', 'Ursula K. Le Guin')
    const split = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area',
    })
    await patch(`/api/books/${split.body.step.id}/location`, { location: split.body.step.to })

    // Card files before Clarke, so Clarke and Gibson are both still to the
    // right of the gap and a book has to come off the end to open it.
    const sortKey = await previewKey("Ender's Game", 'Orson Scott Card')
    const { body } = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area', sortKey,
    })

    expect(body.carry).toBeNull()
    expect(body.step.id).toBe(gibson)
    expect(body.step.from).toBe('1A')
    expect(body.step.to).toBe('1B')
  })

  it('makes a shelf for the book in hand at the end of the run', async () => {
    await seed('Rendezvous with Rama', 'Arthur C. Clarke')
    await seed('Neuromancer', 'William Gibson')

    const sortKey = await previewKey('The Dispossessed', 'Ursula K. Le Guin')
    const { body } = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area', sortKey,
    })

    expect(body.carry).toEqual({ from: '1A', to: '1B' })
    expect(body.moves).toEqual([])

    const saved = await post('/api/books', {
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG,
    })
    expect((await running.store.getBook(saved.body.id))?.location).toBe('1B')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('stops reporting a shuffled book once the shuffle is recorded', async () => {
    await seed('Rendezvous with Rama', 'Arthur C. Clarke')
    const dispossessed = await seed('The Dispossessed', 'Ursula K. Le Guin')

    const { body } = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area',
    })

    // The boundary has moved and the book has not, which is the false misfile
    // a shuffle used to manufacture every time.
    const during = await misfiles()
    expect(during.misfiles).toHaveLength(1)
    expect(during.misfiles[0].book.id).toBe(dispossessed)
    expect(during.misfiles[0].to).toBe('1B')

    // "Yes, it fit" against the step the person was just given.
    await patch(`/api/books/${body.step.id}/location`, { location: body.step.to })

    expect((await running.store.getBook(dispossessed))?.location).toBe('1B')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('leaves a recorded location alone when an edit carries no observation', async () => {
    await splitFiction('shelf', 'area', 'area')
    const id = await seed('The Dispossessed', 'Ursula K. Le Guin')
    await patch(`/api/books/${id}/location`, { location: '2C' })

    // The two shapes a metadata-only edit arrives in: no location key at all,
    // and the empty string. Neither one was made by somebody standing at a
    // shelf, so neither says where the book is, and neither may move it.
    await put(`/api/books/${id}`, {
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG,
    })
    expect((await running.store.getBook(id))?.location).toBe('2C')

    await put(`/api/books/${id}`, {
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG,
      location: '',
    })
    expect((await running.store.getBook(id))?.location).toBe('2C')
  })

  /**
   * The same rule, about the other thing a save could once quietly restate
   * (#87).
   *
   * A metadata edit is not a statement about where a book physically is, and
   * whether it is on the bookcase at all is that same kind of statement. The
   * take-down time is worth more than the location too: `setCheckedOut`
   * protects it against being rewritten (#15) precisely because there is no
   * second record of it, and an edit that quietly cleared it destroyed it
   * outright. Only POST /api/books/:id/checkout may move a book between those
   * two states.
   */
  it('leaves a book that is off the bookcase off it when an edit carries no observation', async () => {
    const id = await seed('The Dispossessed', 'Ursula K. Le Guin')
    const { body: out } = await post(`/api/books/${id}/checkout`, { out: true })
    const takenDown = out.book.checked_out_at as string

    await put(`/api/books/${id}`, {
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG,
      notes: 'signed by the author',
    })

    // Still off the bookcase, and off it since the moment somebody actually
    // took it down rather than the moment they corrected a note.
    expect((await running.store.getBook(id))?.checked_out_at).toBe(takenDown)
    expect((await running.store.getBook(id))?.notes).toBe('signed by the author')
  })

  /**
   * The exact shape of #90. An edit that re-files a book moves it in the
   * sequence without anybody having carried it to a shelf, so the Library's
   * misfile list is right to keep reporting it once the edit is saved. The
   * detail view previewing that same saved edit has to say the same thing:
   * a gap still to carry the book to, not a row it is already sitting in.
   * One answer checked against the other is worth more than either alone,
   * since it is the two disagreeing that was the actual defect.
   */
  it('previews a re-filed book as still needing to move, agreeing with the Library', async () => {
    await seed('Book', 'Ann Author')
    await seed('Book', 'Mary Mills')
    const zola = await seed('Book', 'Zoe Zola')

    // Zola alone gets pushed on to 1B, and the move is recorded, the way the
    // shelving step has somebody do it.
    const split = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area',
    })
    expect(split.body.step.id).toBe(zola)
    await patch(`/api/books/${zola}/location`, { location: split.body.step.to })
    expect((await running.store.getBook(zola))?.location).toBe('1B')
    expect((await misfiles()).misfiles).toEqual([])

    // Renaming the author to Adams sorts the book back to the front of the
    // range. Nobody has carried it there, so it is still, physically, on 1B.
    await put(`/api/books/${zola}`, { title: 'Book', authors: ['Al Adams'], genre: FICTION_SLUG })

    const library = await misfiles()
    expect(library.misfiles).toHaveLength(1)
    expect(library.misfiles[0].book.id).toBe(zola)
    expect(library.misfiles[0].from).toBe('1B')
    expect(library.misfiles[0].to).toBe('1A')

    const { status, body } = await post('/api/placement/preview', {
      title: 'Book', authors: ['Al Adams'], genre: FICTION_SLUG, excludeId: zola,
    })
    expect(status).toBe(200)
    expect(body.derivedLocation).toBe('1A')
    // Not settled: a gap at the front of 1A rather than the book drawn
    // already standing in the row.
    expect(body.strip.placedIndex).toBeNull()
    expect(body.strip.gapIndex).toBe(0)
  })
})

/**
 * The row a catalogued book stands in, as the detail view draws it (#81).
 *
 * The detail view shows the whole area end on and every spine in it is a way
 * through to that book, so every one of them needs its photo. This used to
 * send three: the book and the two either side, which is all the placing
 * strip needs and would leave a library row as two photographs among twenty
 * blank blocks.
 */
describe('the row a shelved book stands in', () => {
  const seedWith = async (title: string, author: string, images: {
    front?: string; back?: string; edge?: string
  }) => (await running.store.addBook({
    title,
    authors: [author],
    genre: FICTION_SLUG,
    frontImage: images.front ?? '',
    backImage: images.back ?? '',
    edgeImage: images.edge ?? '',
  })).id

  /** The row as the detail view receives it, for the book with this id. */
  const rowFor = async (id: number, title: string, author: string) => {
    const { status, body } = await post('/api/placement/preview', {
      title, authors: [author], genre: FICTION_SLUG, excludeId: id,
    })
    expect(status, `previewing ${title}`).toBe(200)
    return body.strip as {
      placedIndex: number | null
      books: { id: number; spine: string; spineSlot: string }[]
    }
  }

  it('gives every book in the row its photo, not just the neighbours', async () => {
    await seedWith('Foundation', 'Isaac Asimov', { edge: 'asimov.jpg' })
    await seedWith('Neuromancer', 'William Gibson', { edge: 'gibson.jpg' })
    const dune = await seedWith('Dune', 'Frank Herbert', { edge: 'herbert.jpg' })
    await seedWith('The Dispossessed', 'Ursula K. Le Guin', { edge: 'leguin.jpg' })
    await seedWith('Solaris', 'Stanislaw Lem', { edge: 'lem.jpg' })

    const strip = await rowFor(dune, 'Dune', 'Frank Herbert')

    // The book itself is in the row rather than a gap in it, and Asimov and
    // Lem are two books away from it, so the old rule would have sent them
    // blank.
    expect(strip.placedIndex).toBe(2)
    expect(strip.books).toHaveLength(5)
    expect(strip.books.map((b) => b.spine)).toEqual([
      'asimov.jpg', 'gibson.jpg', 'herbert.jpg', 'leguin.jpg', 'lem.jpg',
    ])
  })

  it('falls back to a cover for a book catalogued before spines, and says which face it is', async () => {
    const dune = await seedWith('Dune', 'Frank Herbert', { edge: 'herbert.jpg' })
    await seedWith('The Dispossessed', 'Ursula K. Le Guin', { front: 'leguin-front.jpg' })
    await seedWith('Solaris', 'Stanislaw Lem', { back: 'lem-back.jpg' })

    const strip = await rowFor(dune, 'Dune', 'Frank Herbert')

    expect(strip.books.map((b) => [b.spine, b.spineSlot])).toEqual([
      ['herbert.jpg', 'edge'],
      ['leguin-front.jpg', 'front'],
      ['lem-back.jpg', 'back'],
    ])
  })

  it('leaves a book with no photograph at all blank rather than inventing one', async () => {
    const dune = await seedWith('Dune', 'Frank Herbert', { edge: 'herbert.jpg' })
    await seedWith('Solaris', 'Stanislaw Lem', {})

    const strip = await rowFor(dune, 'Dune', 'Frank Herbert')

    expect(strip.books[1]?.spine).toBe('')
    expect(strip.books[1]?.spineSlot).toBe('')
  })

  it('photographs the whole row for a book that is off the bookcase too', async () => {
    // Off the bookcase, so the answer is the row with a gap in it rather than
    // the row it stands in. Same drawing, same page, same taps: two photos in
    // a run of blank blocks there would read as missing data.
    const dune = await seedWith('Dune', 'Frank Herbert', { edge: 'herbert.jpg' })
    await seedWith('Foundation', 'Isaac Asimov', { edge: 'asimov.jpg' })
    await seedWith('Neuromancer', 'William Gibson', { edge: 'gibson.jpg' })
    await seedWith('Solaris', 'Stanislaw Lem', { edge: 'lem.jpg' })
    await post(`/api/books/${dune}/checkout`, { out: true })

    const strip = await rowFor(dune, 'Dune', 'Frank Herbert')

    expect(strip.placedIndex).toBeNull()
    expect(strip.books.map((b) => b.spine)).toEqual(['asimov.jpg', 'gibson.jpg', 'lem.jpg'])
  })

  it('leaves a checked out book out of the row, because it is not on the shelf', async () => {
    const dune = await seedWith('Dune', 'Frank Herbert', { edge: 'herbert.jpg' })
    const lem = await seedWith('Solaris', 'Stanislaw Lem', { edge: 'lem.jpg' })
    await post(`/api/books/${lem}/checkout`, { out: true })

    const strip = await rowFor(dune, 'Dune', 'Frank Herbert')

    // The run has closed up behind it, exactly as the shelf has. Drawing it
    // would put every position after it out by one, and the positions are
    // what somebody counts along.
    expect(strip.books.map((b) => b.id)).toEqual([dune])
  })
})

/**
 * Bouncing a book across an area boundary.
 *
 * Where a plank ends is the one arbitrary thing in the model, so it gets
 * adjusted by hand. These end at /api/misfiles for the same reason the ones
 * above do: a move made for a real reason, with the record updated to match,
 * must not come straight back as a book to go and move.
 */
describe('moving a book across an area boundary', () => {
  const seed = async (title: string, author: string): Promise<number> => {
    const { status, body } = await post('/api/books', {
      title, authors: [author], genre: FICTION_SLUG,
    })
    expect(status, `seeding ${title}`).toBe(201)
    return body.id as number
  }

  const misfiles = async () => (await call('/api/misfiles?range=fiction')).body

  /**
   * Rama and Dune on 1A, The Dispossessed bounced onto 1B, everything
   * recorded where it actually is. The misfile list starts empty, so anything
   * that turns up in it later was put there by the move under test.
   */
  const threeOverTwoAreas = async () => {
    const ids = {
      rama: await seed('Rendezvous with Rama', 'Arthur C. Clarke'),
      dune: await seed('Dune', 'Frank Herbert'),
      dispossessed: await seed('The Dispossessed', 'Ursula K. Le Guin'),
    }
    const { body } = await post('/api/shelves/overflow', {
      range: 'fiction', label: '1A', kind: 'area',
    })
    await patch(`/api/books/${body.step.id}/location`, { location: body.step.to })
    expect((await misfiles()).misfiles).toEqual([])
    return ids
  }

  it('names the book and where it went, so the move can be recorded', async () => {
    const { dune } = await threeOverTwoAreas()

    const { status, body } = await post('/api/shelves/move', {
      range: 'fiction', id: dune, direction: 'next',
    })

    expect(status).toBe(200)
    expect(body.move).toEqual({ id: dune, title: 'Dune', from: '1A', to: '1B' })
    // Nothing else was disturbed, which is the whole point of the restriction.
    expect(body.moves).toEqual([])
  })

  it('leaves the misfile list empty once the person says the book is there', async () => {
    const { dune } = await threeOverTwoAreas()

    const { body } = await post('/api/shelves/move', {
      range: 'fiction', id: dune, direction: 'next',
    })
    await patch(`/api/books/${body.move.id}/location`, { location: body.move.to })

    expect((await running.store.getBook(dune))?.location).toBe('1B')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('sends a book back the other way, and stays clean', async () => {
    const { dispossessed } = await threeOverTwoAreas()

    const { body } = await post('/api/shelves/move', {
      range: 'fiction', id: dispossessed, direction: 'previous',
    })
    expect(body.move.from).toBe('1B')
    expect(body.move.to).toBe('1A')

    await patch(`/api/books/${body.move.id}/location`, { location: body.move.to })
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('refuses a book that is not at a boundary, whatever asked', async () => {
    // The rule lives on this route, not in the screen that offers it. A
    // client that forgot the restriction cannot get past here.
    const { rama } = await threeOverTwoAreas()

    const { status, body } = await post('/api/shelves/move', {
      range: 'fiction', id: rama, direction: 'next',
    })

    expect(status).toBe(400)
    expect(body.error).toContain('first or last book of 1A')
    expect((await running.store.getBook(rama))?.location).toBe('1A')
    expect((await misfiles()).misfiles).toEqual([])
  })

  /**
   * The detail view offers the boundary move button off this field (#96),
   * read from the same placement preview the book's own page already fetches.
   * It has to agree with the route above: a book the preview says cannot move
   * must be the same one the route just refused.
   */
  it('previews which way a book can be carried, agreeing with the move route', async () => {
    const { rama, dune, dispossessed } = await threeOverTwoAreas()

    const boundaryFor = async (title: string, author: string, excludeId: number) => {
      const { status, body } = await post('/api/placement/preview', {
        title, authors: [author], genre: FICTION_SLUG, excludeId,
      })
      expect(status, `previewing ${title}`).toBe(200)
      return body.strip.boundary as { next: string | null; previous: string | null }
    }

    // Rama is in the middle of 1A: the same book the route above just
    // refused, and the preview offers it neither direction.
    expect(await boundaryFor('Rendezvous with Rama', 'Arthur C. Clarke', rama))
      .toEqual({ next: null, previous: null })

    // Dune is last on 1A, with 1B to carry it to.
    expect(await boundaryFor('Dune', 'Frank Herbert', dune))
      .toEqual({ next: '1B', previous: null })

    // The Dispossessed is alone on 1B: the front of it is her own to give
    // back, and there is nothing yet past the end of it.
    expect(await boundaryFor('The Dispossessed', 'Ursula K. Le Guin', dispossessed))
      .toEqual({ next: null, previous: '1A' })
  })

  it('refuses both ends of the run, and says why each way', async () => {
    const { rama, dispossessed } = await threeOverTwoAreas()

    const back = await post('/api/shelves/move', {
      range: 'fiction', id: rama, direction: 'previous',
    })
    expect(back.status).toBe(400)
    expect(back.body.error).toContain('no area before 1A')

    const on = await post('/api/shelves/move', {
      range: 'fiction', id: dispossessed, direction: 'next',
    })
    expect(on.status).toBe(400)
    expect(on.body.error).toContain('no area after 1B')
  })

  it('refuses a book id that names nothing', async () => {
    await threeOverTwoAreas()
    const { status, body } = await post('/api/shelves/move', {
      range: 'fiction', id: 9999, direction: 'next',
    })
    expect(status).toBe(400)
    expect(body.error).toContain('not on a bookcase')
  })

  /**
   * Two bookcases, the second holding the last two books.
   *
   * Reached the way the app reaches it, by somebody saying 1A is full and
   * asking for a new bookcase twice, with each displaced book recorded where
   * it was carried to. The misfile list starts empty.
   */
  const twoBookcases = async () => {
    const ids = {
      rama: await seed('Rendezvous with Rama', 'Arthur C. Clarke'),
      gibson: await seed('Neuromancer', 'William Gibson'),
      dune: await seed('Dune', 'Frank Herbert'),
      dispossessed: await seed('The Dispossessed', 'Ursula K. Le Guin'),
    }
    for (let i = 0; i < 2; i += 1) {
      const { body } = await post('/api/shelves/overflow', {
        range: 'fiction', label: '1A', kind: 'shelf',
      })
      await patch(`/api/books/${body.step.id}/location`, { location: body.step.to })
    }
    expect((await misfiles()).misfiles).toEqual([])
    return ids
  }

  it('sends the first book of 2A back to the last area of bookcase 1', async () => {
    const { rama, gibson, dune, dispossessed } = await twoBookcases()
    expect((await running.store.getBook(dune))?.location).toBe('2A')

    const { status, body } = await post('/api/shelves/move', {
      range: 'fiction', id: dune, direction: 'previous',
    })

    expect(status).toBe(200)
    expect(body.move).toEqual({ id: dune, title: 'Dune', from: '2A', to: '1A' })
    // The bookcase break moved, so the book past it stayed on bookcase 2.
    expect(body.moves).toEqual([])
    expect((await running.store.getBook(rama))?.location).toBe('1A')
    expect((await running.store.getBook(gibson))?.location).toBe('1A')
    expect((await running.store.getBook(dispossessed))?.location).toBe('2A')
  })

  it('reports the move until it is confirmed, then nothing', async () => {
    // The shape the cascade has always had, and now the move too: the app
    // changes the furniture, and only a person says where a book physically
    // is. Until they do, the book really is not where the catalogue has it.
    const { dune } = await twoBookcases()
    const { body } = await post('/api/shelves/move', {
      range: 'fiction', id: dune, direction: 'previous',
    })

    const during = await misfiles()
    expect(during.misfiles).toHaveLength(1)
    expect(during.misfiles[0].book.id).toBe(dune)
    expect(during.misfiles[0].from).toBe('2A')
    expect(during.misfiles[0].to).toBe('1A')

    // "It fits, save" at the end of the shelving step, which is a PUT of the
    // record followed by the one route that changes a location.
    await put(`/api/books/${dune}`, {
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG,
    })
    await patch(`/api/books/${dune}/location`, { location: body.move.to })

    expect((await running.store.getBook(dune))?.location).toBe('1A')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('sends the last book of bookcase 1 on to the next bookcase', async () => {
    const { rama, gibson, dune } = await twoBookcases()

    const { body } = await post('/api/shelves/move', {
      range: 'fiction', id: gibson, direction: 'next',
    })
    expect(body.move).toEqual({ id: gibson, title: 'Neuromancer', from: '1A', to: '2A' })
    expect(body.moves).toEqual([])

    await patch(`/api/books/${gibson}/location`, { location: body.move.to })
    expect((await running.store.getBook(rama))?.location).toBe('1A')
    expect((await running.store.getBook(dune))?.location).toBe('2A')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('keeps the refusals at the two ends of the range, not at a bookcase', async () => {
    const { rama, dispossessed } = await twoBookcases()

    const back = await post('/api/shelves/move', {
      range: 'fiction', id: rama, direction: 'previous',
    })
    expect(back.status).toBe(400)
    expect(back.body.error).toContain('no area before 1A')

    const on = await post('/api/shelves/move', {
      range: 'fiction', id: dispossessed, direction: 'next',
    })
    expect(on.status).toBe(400)
    expect(on.body.error).toContain('no area after 2A')
  })

  /**
   * The way back out of the shelving step (#196).
   *
   * The move is offered on a phone, one mistap from a book somebody was only
   * looking at, and until this existed the only exit was to tap "Moved it" and
   * then move the book again: two statements about the room, both false, to
   * undo one tap.
   */
  it('offers the move back on the same list, and takes it', async () => {
    const { dune } = await threeOverTwoAreas()
    await post('/api/shelves/move', { range: 'fiction', id: dune, direction: 'next' })

    // Backing out of the shelving step leaves exactly this, which is the truth.
    const during = await misfiles()
    expect(during.misfiles.map((m: { from: string; to: string }) => [m.from, m.to]))
      .toEqual([['1A', '1B']])
    expect(during.outstandingMoves).toEqual([dune])

    const { status, body } = await post('/api/shelves/retract', {
      range: 'fiction', id: dune,
    })

    expect(status).toBe(200)
    expect(body.move).toEqual({ from: '1B', to: '1A' })
    expect(body.moves).toEqual([])
    // No location was written, because nobody carried anything.
    expect((await running.store.getBook(dune))?.location).toBe('1A')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('does not offer it for a misfile nobody assigned', async () => {
    // A location somebody typed for the wrong plank is a real misfile and is
    // not an undo: there is no assignment to withdraw, and moving a boundary to
    // close it would be a decision about the furniture made on their behalf.
    const { rama } = await threeOverTwoAreas()
    await patch(`/api/books/${rama}/location`, { location: '1B' })

    const review = await misfiles()
    expect(review.misfiles.map((m: { book: { id: number } }) => m.book.id)).toEqual([rama])
    expect(review.outstandingMoves).toEqual([])

    const { status, body } = await post('/api/shelves/retract', {
      range: 'fiction', id: rama,
    })
    expect(status).toBe(400)
    expect(body.error).toContain('no move outstanding')
  })

  it('has nothing left to take back once the person says where the book is', async () => {
    const { dune } = await threeOverTwoAreas()
    const { body } = await post('/api/shelves/move', {
      range: 'fiction', id: dune, direction: 'next',
    })
    await patch(`/api/books/${dune}/location`, { location: body.move.to })

    const { status } = await post('/api/shelves/retract', { range: 'fiction', id: dune })
    expect(status).toBe(400)
    // And the shelves are where the person just said they are.
    expect((await running.store.getBook(dune))?.location).toBe('1B')
    expect((await misfiles()).misfiles).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. Camera recognition: scanning identifies, and never writes
// ---------------------------------------------------------------------------

describe('scanning a book at the shelf', () => {
  /**
   * Seed a book whose front hash is exactly the hash the fixture below will
   * produce, so the match is deterministic (distance 0) rather than relying
   * on two different generated covers happening to be photographically
   * alike. `frontCover` carries no barcode, so the fast barcode-only pass
   * this route starts with reads nothing, which is what has to happen before
   * the cover match is even consulted.
   */
  async function seedRecognisable(): Promise<{ id: number; buffer: Buffer }> {
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const hash = await coverHash(buffer)
    // With a front photograph, because a hash is a fact about a photograph and
    // lands on that photograph's row (#228). A book with no photographs has
    // nowhere to put one and is not something a camera can recognise.
    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG,
      frontImage: 'dune_front.jpg',
    })
    await running.store.setHashes(id, hash, '')
    return { id, buffer }
  }

  it('answers with candidates and writes nothing to the catalogue', async () => {
    const { id, buffer } = await seedRecognisable()
    const before = await running.store.getBook(id)

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('candidates')
    expect(body.candidates.map((c: { id: number }) => c.id)).toContain(id)

    // Load bearing: a shortlist is not a decision. Nothing about the row
    // this candidate names may have changed.
    expect(await running.store.getBook(id)).toEqual(before)
    expect((await running.store.counts()).checkedOut).toBe(0)
  }, 20_000)

  it('still writes nothing when the book it recognises is already off the shelf', async () => {
    // The case the automatic path would have acted on: a book that is out,
    // held up again. Scanning must still only look. Deferred until the wrong
    // first candidate rate is measurably better than one in ten (#49).
    const { id, buffer } = await seedRecognisable()
    await running.store.setCheckedOut(id, true)
    const before = await running.store.getBook(id)

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).toBe('candidates')
    expect(await running.store.getBook(id)).toEqual(before)
    expect((await running.store.counts()).checkedOut).toBe(1)
  }, 20_000)

  it('identifies a catalogued book by its barcode and leaves it exactly as it was', async () => {
    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, isbn13: DUNE,
    })
    const before = await running.store.getBook(id)
    const buffer = await backCover(DUNE)

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('identified')
    expect(body.book.id).toBe(id)

    // A barcode settles what the book is, and nothing more. Which of the two
    // directions the person wanted is theirs to say on the book's own page.
    expect(await running.store.getBook(id)).toEqual(before)
    expect((await running.store.counts()).checkedOut).toBe(0)
  }, 20_000)

  it('takes no direction, so a body asking for one changes nothing', async () => {
    // Belt and braces on the shape: the old route wrote when told to, and a
    // client left on the old contract must not be able to reach that again.
    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, isbn13: DUNE,
    })
    const buffer = await backCover(DUNE)

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer), out: true })

    expect(body.outcome).toBe('identified')
    expect((await running.store.getBook(id))?.checked_out_at).toBeNull()
  }, 20_000)

  /**
   * A barcode the first, fast look cannot read.
   *
   * The route opens with zxing alone, which is a fifth of a second and reads
   * most covers. Shrinking the fixture to 420px puts the bars below what that
   * single look resolves, exactly as standing back from a book does, while
   * the thorough zbar ladder underneath still reads it from its upscaled
   * rung. Nothing else in the photo carries the number: the printed ISBN is
   * left off, so an answer here can only have come from the barcode.
   */
  const distantBackCover = (isbn: string) =>
    backCover(isbn, { printedIsbn: false })
      .then((cover) => sharp(cover).resize({ width: 420 }).png().toBuffer())

  it('reads the barcode the fast pass missed instead of offering a lookalike', async () => {
    // The defect in #66: the owner photographs a visible barcode, the fast
    // pass misses it, and a weak cover match returns before the thorough read
    // ever runs. A barcode validates; a hash distance is a guess.
    const buffer = await distantBackCover(DUNE)
    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, isbn13: DUNE,
    })
    const decoy = await running.store.addBook({
      title: 'Children of Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG,
    })
    await running.store.setHashes(decoy.id, nudgeHash(await coverHash(buffer), 12), '')

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('identified')
    expect(body.book.id).toBe(id)
  }, 30_000)

  it('still offers the shortlist when the thorough read finds no barcode either', async () => {
    // The other half of the trade: waiting for the barcode must not cost the
    // person the shortlist when there was never a barcode to read.
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG,
      frontImage: 'dune_front.jpg',
    })
    await running.store.setHashes(id, nudgeHash(await coverHash(buffer), 12), '')

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).toBe('candidates')
    expect(body.candidates.map((c: { id: number }) => c.id)).toContain(id)
  }, 30_000)

  it('reports not-catalogued for a real ISBN nobody has saved, and writes nothing', async () => {
    const buffer = await backCover(DUNE)

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('not-catalogued')
    expect(body.isbn13).toBe(DUNE)
    expect((await running.store.counts()).total).toBe(0)
  }, 20_000)
})

/**
 * The book somebody else already scanned (#122).
 *
 * Three people share this queue: one photographs, one resolves details, one
 * shelves. A book photographed an hour ago and not yet shelved used to match
 * nothing at all when the next person held it up, so it went round again.
 *
 * The bar here is `QUEUE_LIMIT`, and it is much tighter than the shortlist's,
 * for reasons measured on real photographs and written down against that
 * constant. These tests assert the two halves of that: it answers when the
 * photographs really are of one book, and it refuses at distances the
 * shortlist would happily have offered.
 */
describe('a book already waiting in the queue', () => {
  const queueOf = () => new CaptureQueue(running.db, () => null)

  /**
   * A capture of a known photograph, hashed exactly as the worker would hash
   * it, and marked read so it is a capture somebody could actually go and
   * finish. The image is `frontCover`, which carries no barcode, so the fast
   * pass this route opens with reads nothing and the comparison is reached.
   */
  async function waitingCapture(
    buffer: Buffer,
    options: { bits?: number } = {},
  ): Promise<number> {
    const queue = queueOf()
    const capture = await queue.add({ front: 'dune-front.jpg' })
    const hash = await coverHash(buffer)
    await queue.setFrontHash(capture.id, options.bits ? nudgeHash(hash, options.bits) : hash)
    await running.db.run("UPDATE books SET state = 'identified' WHERE id = ?", [capture.id])
    return capture.id
  }

  it('says the book is already in the queue instead of letting it be scanned twice', async () => {
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const id = await waitingCapture(buffer)

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('in-queue')
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].capture.id).toBe(id)
    expect(body.matches[0].distance).toBe(0)
    // The whole row, because a capture has no short form: the panel needs the
    // photograph and whatever anybody has worked out about it so far.
    expect(body.matches[0].capture.front_image).toBe('dune-front.jpg')
  }, 30_000)

  it('writes nothing, to the capture or to the catalogue', async () => {
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const id = await waitingCapture(buffer)
    const before = await queueOf().get(id)

    await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(await queueOf().get(id)).toEqual(before)
    expect((await running.store.counts()).total).toBe(0)
  }, 30_000)

  it('refuses a capture the shortlist cutoff would have offered', async () => {
    // The load-bearing one. 12 bits is comfortably inside MATCH_CUTOFF, which
    // is what the books shortlist offers on, and on real photographs a pair of
    // different books lands there often. A wrong answer here tells somebody
    // two different books are the same book, and the way that ends is a book
    // nobody ever catalogues. So it fails closed.
    const buffer = await frontCover('Dune', 'Frank Herbert')
    await waitingCapture(buffer, { bits: 12 })

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).not.toBe('in-queue')
  }, 30_000)

  it('leaves out a capture that has already become a book', async () => {
    // It is not waiting for anybody: it is on a shelf, and the books path
    // answers for it. Sending somebody to finish it is sending them nowhere.
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const id = await waitingCapture(buffer)
    await shelve(id)

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).not.toBe('in-queue')
  }, 30_000)

  it('leaves out a capture with no hash rather than scoring it as unalike', async () => {
    // An empty hash is the absence of a measurement, not a weak one. It is
    // already scored 64 by `distance`, and this asserts the row never reaches
    // the comparison at all.
    const buffer = await frontCover('Dune', 'Frank Herbert')
    await queueOf().add({ front: 'dune-front.jpg' })

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).not.toBe('in-queue')
  }, 30_000)

  it('answers with the catalogue when a shelved book looks the same too', async () => {
    // A catalogued row is a settled fact and a capture is work in progress.
    // When both look identical the person gets the shortlist they get today,
    // rather than being sent off to the queue for a book already on a shelf.
    const buffer = await frontCover('Dune', 'Frank Herbert')
    await waitingCapture(buffer)
    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG,
      frontImage: 'dune_front.jpg',
    })
    await running.store.setHashes(id, await coverHash(buffer), '')

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).toBe('candidates')
    expect(body.candidates.map((c: { id: number }) => c.id)).toContain(id)
  }, 30_000)

  it('still identifies by barcode, which is evidence rather than likeness', async () => {
    // A queue match must never get in front of a read barcode. This capture
    // is an exact match for the photograph, and the answer is still the row
    // the check digit named.
    const buffer = await backCover(DUNE)
    await waitingCapture(buffer)
    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, isbn13: DUNE,
    })

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).toBe('identified')
    expect(body.book.id).toBe(id)
  }, 30_000)
})

/**
 * The same book photographed twice through the Add flow (#146).
 *
 * #138 put the queue comparison in the scan route and only where no barcode
 * read, which left the door people actually use when working through a stack
 * of new books without a check at all: photographing a back cover whose ISBN
 * was already queued made a second capture and said nothing.
 *
 * Two things are asserted here that the scan route's tests do not cover. The
 * first is precedence: where a barcode read there is an exact identifier, and
 * it is used instead of, not alongside, a comparison of photographs. The
 * second is that the hash half still fails closed at `QUEUE_LIMIT` and has not
 * quietly been widened to `MATCH_CUTOFF` on the way through.
 */
describe('a capture of a book already in the queue', () => {
  const queueOf = () => new CaptureQueue(running.db, () => null)

  /** A capture carrying an ISBN, as a barcode read would leave it. */
  async function queuedWith(
    isbn13: string,
    options: { hash?: string; status?: string } = {},
  ): Promise<number> {
    const queue = queueOf()
    const capture = await queue.add({ front: 'front.jpg', back: 'back.jpg' })
    if (options.hash) await queue.setFrontHash(capture.id, options.hash)
    await running.db.run(
      'UPDATE books SET isbn13 = ?, state = ? WHERE id = ?',
      [isbn13, stateFor(options.status ?? 'ready'), capture.id],
    )
    return capture.id
  }

  const duplicatesFor = async (id: number) =>
    (await call(`/api/captures/${id}`)).body.duplicates as {
      capture: { id: number }
      distance: number | null
      basis: string
    }[]

  it('says a barcode already in the queue is already in the queue', async () => {
    // The reported defect, in one test: two captures of one back cover.
    const first = await queuedWith(DUNE)
    const second = await queuedWith(DUNE)

    const found = await duplicatesFor(second)

    expect(found).toHaveLength(1)
    expect(found[0]!.capture.id).toBe(first)
    expect(found[0]!.basis).toBe('isbn')
    // Null rather than 0. Nothing was compared, so there is no measurement,
    // and a fabricated zero would print as "looks the same, 100%".
    expect(found[0]!.distance).toBeNull()
  })

  it('uses the ISBN rather than the pictures when it has one', async () => {
    // Both kinds of evidence available at once. The identifier carries its own
    // check digit; the hash is a likeness with a measured error rate. The
    // answer is the identifier's, and the lookalike is not listed beside it as
    // though the two were the same kind of claim.
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const hash = await coverHash(buffer)
    const sameIsbn = await queuedWith(DUNE)
    const lookalike = await queuedWith('', { hash })
    const mine = await queuedWith(DUNE, { hash })

    const found = await duplicatesFor(mine)

    expect(found.map((match) => match.capture.id)).toEqual([sameIsbn])
    expect(found.map((match) => match.capture.id)).not.toContain(lookalike)
  }, 30_000)

  it('falls back to the cover when nothing could be read', async () => {
    // No barcode, no OCR, nothing typed: the photographs are all there is,
    // which is the case #138 measured and the bar it set.
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const hash = await coverHash(buffer)
    const other = await queuedWith('', { hash })
    const mine = await queuedWith('', { hash })

    const found = await duplicatesFor(mine)

    expect(found).toHaveLength(1)
    expect(found[0]!.capture.id).toBe(other)
    expect(found[0]!.basis).toBe('cover')
    expect(found[0]!.distance).toBe(0)
  }, 30_000)

  it('refuses a cover match the shortlist cutoff would have offered', async () => {
    // The load-bearing one, and the reason this could not simply reuse the
    // books comparison. 12 bits is comfortably inside MATCH_CUTOFF, and on the
    // owner's real photographs a pair of DIFFERENT books lands there often,
    // because the shared table and carpet pull them together (#122). Saying
    // two different books are one book ends with a book nobody catalogues, so
    // it fails closed and the threshold is untouched.
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const hash = await coverHash(buffer)
    await queuedWith('', { hash: nudgeHash(hash, 12) })
    const mine = await queuedWith('', { hash })

    expect(await duplicatesFor(mine)).toEqual([])
  }, 30_000)

  it('never reports a capture as its own duplicate', async () => {
    const buffer = await frontCover('Dune', 'Frank Herbert')
    const mine = await queuedWith(DUNE, { hash: await coverHash(buffer) })
    expect(await duplicatesFor(mine)).toEqual([])
  }, 30_000)

  it('leaves out a capture that has already become a book', async () => {
    const other = await queuedWith(DUNE)
    const mine = await queuedWith(DUNE)
    await shelve(other)

    expect(await duplicatesFor(mine)).toEqual([])
  })

  it('says nothing about two captures nobody has managed to read', async () => {
    // An empty ISBN is the absence of an identifier, not one they share, and
    // an unhashed front is the absence of a measurement.
    await queuedWith('', { status: 'failed' })
    const mine = await queuedWith('', { status: 'failed' })

    expect(await duplicatesFor(mine)).toEqual([])
  })

  it('does not block the second capture, or write anything at all', async () => {
    // Two copies of one book genuinely turn up, so this is a finding to put in
    // front of a person and never a refusal. The photograph is accepted, both
    // rows are still there afterwards, and asking the question changes
    // neither of them.
    const first = await queuedWith(DUNE)
    const second = await queuedWith(DUNE)
    const before = await Promise.all([queueOf().get(first), queueOf().get(second)])

    const { body } = await call(`/api/captures/${second}`)

    expect(body.duplicates).toHaveLength(1)
    expect(await Promise.all([queueOf().get(first), queueOf().get(second)])).toEqual(before)
    expect((await queueOf().list()).map((row) => row.id)).toEqual([first, second])
  })

  it('tells the scanner too, when the barcode names nothing on a shelf', async () => {
    // The other half of "whichever entry point was used". A barcode that no
    // catalogued book answers for used to be told "not in the library yet, add
    // it first", which is an instruction to photograph it a second time.
    const buffer = await backCover(DUNE)
    const waiting = await queuedWith(DUNE)

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('in-queue')
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].capture.id).toBe(waiting)
    expect(body.matches[0].basis).toBe('isbn')
    expect((await running.store.counts()).total).toBe(0)
  }, 30_000)

  it('still prefers a catalogued book to a queued capture of it', async () => {
    // A shelved row is a settled fact and a capture is work in progress, so
    // the queue answer is asked only after the catalogue has said no.
    const buffer = await backCover(DUNE)
    await queuedWith(DUNE)
    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, isbn13: DUNE,
    })

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).toBe('identified')
    expect(body.book.id).toBe(id)
  }, 30_000)
})

/**
 * The route the queue was missing, and the workflow it exists for: one person
 * photographs, another resolves details, a third shelves. Asserted through
 * HTTP and read back out of SQLite, because "it stayed on screen" is exactly
 * the thing that was already true before this route existed.
 */
describe('editing a capture that is still in the queue', () => {
  /**
   * A capture without going through the camera route, which would run the real
   * OCR pipeline for no benefit here. The queue's own writer, against the same
   * database the running app is serving from.
   */
  const queued = async () =>
    new CaptureQueue(running.db, () => null).add({ back: 'b.jpg', front: 'f.jpg' })

  it('persists a correction so the next person picks it up', async () => {
    const capture = await queued()

    const { status, body } = await patch(`/api/captures/${capture.id}`, {
      who: 'alice', title: 'Dune', authors: ['Frank Herbert'],
    })
    expect(status).toBe(200)
    expect(body.capture.edited_by).toBe('alice')

    // The handoff itself: a second request, as somebody else, sees the work.
    const seen = await call(`/api/captures/${capture.id}`)
    const stated = JSON.parse(seen.body.capture.edit_json)
    expect(stated.title).toBe('Dune')
    expect(stated.authors).toEqual(['Frank Herbert'])
  })

  it('re-runs the lookup for a corrected ISBN and records it as manual', async () => {
    vi.mocked(lookupIsbn).mockResolvedValueOnce({
      found: true, title: 'Dune', subtitle: '', authors: ['Frank Herbert'],
      publisher: 'Ace Books', published: '1965', pages: '412', isbn13: DUNE,
      isbn10: '0441013597', seriesName: '', seriesIndex: null, coverUrl: '',
      source: 'Open Library',
      classification: { genre: FICTION_SLUG, confidence: 'high', reason: 'stub' },
      notes: [],
    })
    const capture = await queued()

    const { body } = await patch(`/api/captures/${capture.id}`, {
      who: 'alice', isbn13: DUNE,
    })

    expect(body.lookup.title).toBe('Dune')
    expect(body.capture.isbn13).toBe(DUNE)
    // Not 'barcode' and not 'ocr': a person reading digits off a book is a
    // third kind of fact and says so (#29).
    expect(body.capture.isbn_source).toBe('manual')
  })

  it('refuses an edit while somebody else holds the claim', async () => {
    const capture = await queued()
    await post(`/api/captures/${capture.id}/claim`, { who: 'alice' })

    const { status, body } = await patch(`/api/captures/${capture.id}`, {
      who: 'bob', title: 'Not Dune',
    })

    expect(status).toBe(409)
    expect(body.error).toContain('alice')
    expect(
      (await new CaptureQueue(running.db, () => null).get(capture.id))!.edit_json,
    ).toBe('')
  })

  it('records that somebody looked, even having stated nothing', async () => {
    const capture = await queued()

    const { status, body } = await patch(`/api/captures/${capture.id}`, { who: 'alice' })

    expect(status).toBe(200)
    expect(body.capture.edited_at).not.toBeNull()
    // Looked at and left alone: nothing is claimed as a human decision, so
    // the worker is still free to fill everything in.
    expect(JSON.parse(body.capture.edit_json)).toEqual({})
  })

  it('404s on a capture that does not exist', async () => {
    const { status } = await patch('/api/captures/999', { who: 'alice', title: 'Dune' })
    expect(status).toBe(404)
  })

  it('409s on a capture that has already become a book', async () => {
    const capture = await queued()
    await shelve(capture.id)

    const { status, body } = await patch(`/api/captures/${capture.id}`, {
      who: 'alice', title: 'Something Else',
    })
    expect(status).toBe(409)
    expect(body.error).toContain('shelved')
  })
})

/**
 * Sending a stuck capture back through the reader (#299).
 *
 * The half of that issue that is not the bound. A reading that is given up on
 * leaves a capture `failed` saying so, which is a state somebody can see, and
 * this route is what makes it a state somebody can do something about: without
 * it the only way back was to find the book and photograph it again, for a
 * fault that was never about the book.
 */
describe('reading a capture again', () => {
  const queued = async () =>
    new CaptureQueue(running.db, () => null).add({ back: 'b.jpg', front: 'f.jpg' })

  const rowOf = (id: number) => new CaptureQueue(running.db, () => null).get(id)

  it('puts the capture back in the queue', async () => {
    const capture = await queued()
    // Read once already, and stuck: what the route is for is the second look.
    await new CaptureQueue(running.db, () => null).drain()
    expect((await rowOf(capture.id))!.status).toBe('failed')

    const { status, body } = await post(`/api/captures/${capture.id}/read`, {})

    expect(status).toBe(200)
    expect(body.capture.status).toBe('pending')
    expect(body.capture.analysed).toBe('')
  })

  it('404s on an id nothing has, and on one that is not an id at all', async () => {
    expect((await post('/api/captures/999999/read', {})).status).toBe(404)
    // The `idIn` rule: a client typo is the same clean 404 as a missing row,
    // never a 500 with a Postgres stack trace behind it (#332).
    expect((await post('/api/captures/notanumber/read', {})).status).toBe(404)
  })

  it('409s on a book that has left the queue, and says which it is', async () => {
    const capture = await queued()
    await shelve(capture.id)

    const { status, body } = await post(`/api/captures/${capture.id}/read`, {})

    expect(status).toBe(409)
    expect(body.error).toContain('left the queue')
  })
})

/**
 * Walking away from a claimed capture (#150).
 *
 * The claim is a five minute lease, so a person who leaves without handing
 * the book back stalls whoever comes to it next: the queue tells them it is
 * "being worked on by alice" when nobody is. The browser's side of this is in
 * src/lib/leaveCapture.ts; asserted here is the contract it depends on, which
 * is that one request both writes what was typed and lets the book go.
 */
describe('putting a claimed capture down', () => {
  const queued = async () =>
    new CaptureQueue(running.db, () => null).add({ back: 'b.jpg', front: 'f.jpg' })

  const rowOf = (id: number) => new CaptureQueue(running.db, () => null).get(id)

  it('writes what was typed and frees the capture in one request', async () => {
    const capture = await queued()
    await post(`/api/captures/${capture.id}/claim`, { who: 'alice' })

    const { status, body } = await patch(`/api/captures/${capture.id}`, {
      who: 'alice', title: 'Song of Solomon', release: true,
    })

    expect(status).toBe(200)
    expect(body.released).toBe(true)
    expect(JSON.parse(body.capture.edit_json).title).toBe('Song of Solomon')
    expect((await rowOf(capture.id))!.claimed_by).toBe('')
  })

  /*
   * The next person can pick it up at once, which is the whole point: before
   * this they were told the book was with somebody who had gone, and had to
   * wait out the lease.
   */
  it('lets the next person claim it straight away', async () => {
    const capture = await queued()
    await post(`/api/captures/${capture.id}/claim`, { who: 'alice' })
    await patch(`/api/captures/${capture.id}`, { who: 'alice', release: true })

    const { status } = await post(`/api/captures/${capture.id}/claim`, { who: 'bob' })

    expect(status).toBe(200)
  })

  /*
   * The two halves are answerable separately, and only the edit can be
   * refused. A capture that became a book while somebody had it open rejects
   * the edit, and holding on to the claim over that refusal would leave the
   * book claimed by a person who has left the screen.
   */
  it('frees the capture even when the edit itself is refused', async () => {
    const capture = await queued()
    await post(`/api/captures/${capture.id}/claim`, { who: 'alice' })
    await shelve(capture.id)

    const { status, body } = await patch(`/api/captures/${capture.id}`, {
      who: 'alice', title: 'Too late', release: true,
    })

    expect(status).toBe(409)
    expect(body.released).toBe(true)
    expect((await rowOf(capture.id))!.claimed_by).toBe('')
  })

  /*
   * An ordinary autosave is not somebody leaving. The claim has to survive
   * it, or a person typing would hand their own book away mid-sentence.
   */
  it('keeps the claim for an edit that does not ask to leave', async () => {
    const capture = await queued()
    await post(`/api/captures/${capture.id}/claim`, { who: 'alice' })

    const { body } = await patch(`/api/captures/${capture.id}`, {
      who: 'alice', title: 'Song of Solomon',
    })

    expect(body.released).toBe(false)
    expect((await rowOf(capture.id))!.claimed_by).toBe('alice')
  })

  /*
   * Somebody else's claim is not takeable by leaving. The release already
   * only clears a claim held by the person making it, and the refused edit
   * must not have moved anything either.
   */
  it('does not free a capture somebody else is holding', async () => {
    const capture = await queued()
    await post(`/api/captures/${capture.id}/claim`, { who: 'alice' })

    const { status } = await patch(`/api/captures/${capture.id}`, {
      who: 'bob', title: 'Not Dune', release: true,
    })

    expect(status).toBe(409)
    expect((await rowOf(capture.id))!.claimed_by).toBe('alice')
  })
})

/**
 * What a queued capture tells the client about its crops.
 *
 * The queue draws the cropped front (#135), and it can only do that if the crop
 * columns reach the browser. They do because the capture routes hand the row
 * back whole, which is easy to narrow to a column list later without noticing
 * what was lost: the crops would go quietly and the queue would go back to
 * showing the room, with nothing failing.
 *
 * `cropped` travels with them for the reason the column exists. An empty crop
 * on a slot named there was looked at and declined, which is a different fact
 * from a photograph nothing has examined, and only the client holding both can
 * tell them apart.
 */
describe('the crops a queued capture carries to the client', () => {
  it('sends the crop columns and the record of what was examined', async () => {
    const queue = new CaptureQueue(running.db, () => null)
    const capture = await queue.add({ front: 's_front.jpg', edge: 's_edge.jpg' })
    await queue.setCrop(capture.id, 'front', 's_front_crop.jpg')
    // Looked at and declined. Empty crop, but examined all the same.
    await queue.setCrop(capture.id, 'edge', '')

    const one = await call(`/api/captures/${capture.id}`)
    expect(one.body.capture.front_crop).toBe('s_front_crop.jpg')
    expect(one.body.capture.edge_crop).toBe('')
    expect(one.body.capture.back_crop).toBe('')
    expect(one.body.capture.cropped.split(',').sort()).toEqual(['edge', 'front'])

    // The listing is what the queue itself reads, so it carries them too.
    const listed = await call('/api/captures')
    const row = listed.body.captures.find((c: { id: number }) => c.id === capture.id)
    expect(row.front_crop).toBe('s_front_crop.jpg')
    expect(row.edge_crop).toBe('')
    expect(row.cropped.split(',').sort()).toEqual(['edge', 'front'])
  })
})

/**
 * Discarding a capture, which deletes files.
 *
 * A capture now causes derived files to exist as well as photographs, and a
 * derivative left behind by a discard is a picture in the data directory that
 * nothing in either table can be traced back to. The check that keeps a
 * shelved book's files safe is the same one, extended, rather than a second
 * mechanism beside it.
 */
describe('discarding a capture', () => {
  /** A capture whose files really exist in this run's cover directory. */
  async function queuedWithFiles(names: string[]) {
    const queue = new CaptureQueue(running.db, () => null)
    for (const name of names) {
      writeFileSync(join(running.coverDir, name), Buffer.from('not really a jpeg'))
    }
    return { queue, capture: await queue.add({ front: names[0]!, back: names[1]! }) }
  }

  it('takes the crops with the photographs', async () => {
    const { queue, capture } = await queuedWithFiles(['q_front.jpg', 'q_back.jpg'])
    writeFileSync(join(running.coverDir, 'q_front_crop.jpg'), Buffer.from('a crop'))
    await queue.setCrop(capture.id, 'front', 'q_front_crop.jpg')
    // Looked at and declined, so there is no file and nothing to delete.
    await queue.setCrop(capture.id, 'back', '')

    const { status, body } = await del(`/api/captures/${capture.id}`)

    expect(status).toBe(200)
    expect(body.photosRemoved).toBe(3)
    for (const name of ['q_front.jpg', 'q_back.jpg', 'q_front_crop.jpg']) {
      expect(existsSync(join(running.coverDir, name))).toBe(false)
    }
  })

  it('leaves a crop alone while a book still names it', async () => {
    // The case the orphan check exists for. A capture hands its filenames to
    // the book it becomes, and a crop is named after the photograph it came
    // from, so the book's crop and the capture's are one file.
    const { queue, capture } = await queuedWithFiles(['r_front.jpg', 'r_back.jpg'])
    writeFileSync(join(running.coverDir, 'r_front_crop.jpg'), Buffer.from('a crop'))
    await queue.setCrop(capture.id, 'front', 'r_front_crop.jpg')

    const { id } = await running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG,
      frontImage: 'r_front.jpg',
    })
    await running.store.setCrop(id, 'front', 'r_front_crop.jpg')

    const { body } = await del(`/api/captures/${capture.id}`)

    // Only the back photo, which nothing else names.
    expect(body.photosRemoved).toBe(1)
    expect(existsSync(join(running.coverDir, 'r_front.jpg'))).toBe(true)
    expect(existsSync(join(running.coverDir, 'r_front_crop.jpg'))).toBe(true)
    expect(existsSync(join(running.coverDir, 'r_back.jpg'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Failure paths
// ---------------------------------------------------------------------------

describe('failure paths', () => {
  it('scan: 400s on a body with no image', async () => {
    const { status, body } = await post('/api/books/scan', {})
    expect(status).toBe(400)
    expect(body.error).toContain('image')
  })

  it('scan: 400s on an image that is not a data URL', async () => {
    const { status } = await post('/api/books/scan', { image: 'not-a-data-url' })
    expect(status).toBe(400)
  })

  it('identify/isbn: 400s on a missing image, without ever touching identify', async () => {
    const { status, body } = await post('/api/identify/isbn', {})
    expect(status).toBe(400)
    expect(body.error).toContain('image')
  })

  it('captures: 400s on a slot that is not front, back or edge', async () => {
    const { status, body } = await post('/api/captures', {
      slot: 'sideways', image: dataUrl(await frontCover('X', 'Y')),
    })
    expect(status).toBe(400)
    expect(body.error).toContain('sideways')
  })

  it('captures: 400s on a missing image even with a valid slot', async () => {
    const { status, body } = await post('/api/captures', { slot: 'front' })
    expect(status).toBe(400)
    expect(body.error).toContain('image')
  })

  it('GET a book that does not exist: 404, not 500', async () => {
    const { status, body } = await call('/api/books/999')
    expect(status).toBe(404)
    expect(body.error).toContain('No such book')
  })

  it('GET a capture that does not exist: 404, not 500', async () => {
    const { status } = await call('/api/captures/999')
    expect(status).toBe(404)
  })

  it('lookup/isbn: 400s on something that is not a valid ISBN of either length', async () => {
    const { status, body } = await call('/api/lookup/isbn/12345678901')
    expect(status).toBe(400)
    expect(body.error).toContain('not a valid ISBN')
  })

  it('a missing cover: 404, not 500, and the body carries no filesystem path', async () => {
    // The `/api/covers` mount runs with `fallthrough: false`, so a miss here
    // is Express's own 404, not something an app route threw. A missing
    // cover is routine (a book catalogued before a slot existed, or a
    // publisher cover that is simply absent), so it must not be answered as
    // a server fault.
    const { status, body } = await call('/api/covers/does-not-exist.jpg')

    expect(status).toBe(404)
    expect(body.error).not.toContain(running.coverDir) // no filesystem path leaks
    expect(body.error).not.toMatch(/[A-Za-z]:[\\/]|\/(home|Users)\//) // no absolute path at all
  })

  /**
   * The gallery draws a hundred covers at once at about 120 pixels each, and
   * every file on disk is up to 1000 wide. Sending the originals is tens of
   * megabytes over a phone's data to draw thumbnails, so the width is asked
   * for in the URL and the resize happens in the server.
   */
  describe('a cover asked for smaller than it is stored', () => {
    /** A real JPEG on disk, since the resize is real sharp and not a stub. */
    const storeCover = async (name: string, width = 1000, height = 1500) => {
      const jpeg = await sharp({
        create: { width, height, channels: 3, background: '#3a6ea5' },
      }).jpeg().toBuffer()
      writeFileSync(join(running.coverDir, name), jpeg)
      return jpeg
    }

    const fetchCover = (path: string) => fetch(`${running.baseUrl}${path}`)

    it('sends the width the gallery asked for, and a fraction of the bytes', async () => {
      const full = await storeCover('big.jpg')

      const res = await fetchCover('/api/covers/big.jpg?w=320')
      const body = Buffer.from(await res.arrayBuffer())

      expect(res.status).toBe(200)
      expect((await sharp(body).metadata()).width).toBe(320)
      expect(body.length).toBeLessThan(full.length)
      // Cached as hard as the original, so a cover is resized at most once
      // per phone rather than once per scroll past it.
      expect(res.headers.get('cache-control')).toContain('immutable')
    })

    it('never enlarges a cover that is already smaller than the tile', async () => {
      await storeCover('small.jpg', 120, 180)

      const res = await fetchCover('/api/covers/small.jpg?w=320')

      expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(120)
    })

    it('ignores a width it does not offer, and sends the file as stored', async () => {
      // The width is in a URL, so anybody can ask for one. An open set would
      // let a caller make the server re-encode the whole catalogue at a
      // hundred sizes nothing will ever draw.
      const full = await storeCover('big.jpg')

      const res = await fetchCover('/api/covers/big.jpg?w=317')

      expect(res.status).toBe(200)
      expect(Buffer.from(await res.arrayBuffer()).length).toBe(full.length)
    })

    it('answers a missing cover with the same 404 as the full size one', async () => {
      const res = await fetchCover('/api/covers/not-here.jpg?w=320')
      expect(res.status).toBe(404)
    })

    it('refuses to read anything that is not a file in the cover directory', async () => {
      // %2F is a separator once Express has decoded the parameter, so a name
      // carrying one is handed straight past this route rather than trusted
      // to be a bare filename. The static mount below then refuses it, which
      // is where the 403 comes from.
      const res = await fetchCover('/api/covers/..%2F..%2Fpackage.json?w=320')

      expect(res.status).toBe(403)
      expect(await res.text()).not.toContain('book-scan-web')
    })
  })

  it('a rejected async handler answers 500 instead of taking the server down', async () => {
    // lookupIsbn had no try/catch of its own before asyncRoute existed: a
    // rejection here would have been an unhandled promise rejection and
    // crashed the process rather than answered the request.
    vi.mocked(lookupIsbn).mockRejectedValueOnce(new Error('lookup service exploded'))

    const { status, body } = await call('/api/lookup/isbn/9780000000002')

    expect(status).toBe(500)
    expect(body.error).toBe('Something went wrong.')
    expect(body.error).not.toContain('exploded') // no internals in the response

    // The process, and the app inside it, are still alive.
    const health = await call('/api/health')
    expect(health.status).toBe(200)
  })
})

/**
 * Which database a process opens.
 *
 * There were four tests here through stages G and H, and three of them were
 * about a choice: `BOOKSCAN_DB`, the SQLite file it selected, and the refusal
 * to start on an empty Postgres beside a `books.db` full of somebody's
 * afternoons. Stage I removed the choice, so what is left is the connection
 * being read from one name and from no other, and the refusal that is still
 * worth making: none at all.
 *
 * Nothing below reads a connection out of the ambient environment. The one
 * that opens a database opens the one this file already has.
 */
describe('choosing the database', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('opens the connection it is given, and reports it without the credentials', async () => {
    const url = testDatabaseUrl()
    vi.stubEnv('ConnectionStrings__bookscan', url)

    const { db, label } = await openCatalogue()
    try {
      // A real database, with the schema on it, not a stub.
      await expect(db.all('SELECT * FROM books')).resolves.toEqual([])
      // Host, port and database. The `user:password@` the URL carries is what
      // must not be here: this label is served by /api/health, and a password
      // on a health endpoint is a password in every log that scrapes one.
      expect(label).toMatch(/^postgres [^@\s]+:\d+\/\w+$/)
      expect(label).not.toContain('@')
      expect(label).toContain(new URL(url).pathname)
    } finally {
      await db.close()
    }
  })

  it('refuses to start with no connection, and names the variable', async () => {
    // A process that exits saying which variable is empty is recoverable in
    // one command. One that comes up on an empty database is not obviously
    // anything, which is why this is a refusal rather than a default.
    vi.stubEnv('ConnectionStrings__bookscan', '')

    await expect(openCatalogue()).rejects.toThrow(/ConnectionStrings__bookscan is empty/)
  })
})
