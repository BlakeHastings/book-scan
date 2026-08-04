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
 * and a scratch cover directory under web/data (gitignored, inside the
 * checkout), started on an ephemeral port and driven with real HTTP requests.
 * There is no supertest in this project's dependencies and this suite must
 * not add one (web/package.json is off limits), so a listening server and
 * the platform fetch stand in for it.
 *
 * Two things are stubbed rather than real: Open Library and Google Books.
 * Saving a book kicks off an un-awaited cover fetch, and a real network call
 * there would make this suite depend on the internet being up. `./identify`
 * is not stubbed: barcode decoding is real, and every fixture below is built
 * so the fast, non-OCR path answers it, keeping this file out of the
 * multi-second OCR pipeline that identify.test.ts already pays for.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from './db'
import { createApp } from './index'
import { lookupIsbn } from './lookup'
import { Store } from './store'
import { coverHash } from './imagehash'
import { backCover, frontCover } from './fixtures'

// Both routes that would otherwise reach the real catalogues. Saving a book
// starts an un-awaited `fetchCoverFor`, which calls both.
vi.mock('./lookup', () => {
  const empty = {
    found: false, title: '', subtitle: '', authors: [] as string[], publisher: '',
    published: '', pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
    coverUrl: '', source: '',
    classification: { isFiction: true, confidence: 'unknown' as const, reason: 'stub' },
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

let dataRoot: string

beforeAll(() => {
  // Same scratch location covers.test.ts uses: under web/data, which
  // .gitignore already excludes, inside the checkout.
  dataRoot = fileURLToPath(new URL('../data/', import.meta.url))
  mkdirSync(dataRoot, { recursive: true })
})

interface Running {
  db: Database
  store: Store
  coverDir: string
  baseUrl: string
  close: () => Promise<void>
}

async function startApp(): Promise<Running> {
  const db = openDatabase(':memory:')
  const coverDir = mkdtempSync(join(dataRoot, 'index-test-'))
  const app = createApp({ db, coverDir, startBackgroundWork: false })

  const server: Server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  return {
    db,
    store: new Store(db),
    coverDir,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    }),
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

afterAll(() => {
  rmSync(dataRoot, { recursive: true, force: true })
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

// ---------------------------------------------------------------------------
// 1. Routes that write to the catalogue
// ---------------------------------------------------------------------------

describe('saving a book', () => {
  it('persists it and answers with where it landed', async () => {
    const { status, body } = await post('/api/books', {
      title: 'Dune', authors: ['Frank Herbert'], isFiction: true, isbn13: DUNE,
    })

    expect(status).toBe(201)
    expect(body.id).toBeGreaterThan(0)
    expect(body.counts).toEqual({ total: 1, fiction: 1, nonfiction: 0, checkedOut: 0 })
    expect(body.placement.suggestedLocation).toBe('1A')

    const stored = running.store.getBook(body.id)
    expect(stored?.title).toBe('Dune')
    expect(stored?.isbn13).toBe(DUNE)
    // Placed automatically, since the request carried no location of its own.
    expect(stored?.location).toBe('1A')
  })

  it('refuses a book with no title rather than saving a blank one', async () => {
    const { status, body } = await post('/api/books', { authors: ['Nobody'], isFiction: true })

    expect(status).toBe(400)
    expect(body.error).toContain('title')
    expect(running.store.counts().total).toBe(0)
  })

  it('records the location a person actually gave it, not the auto-placement', async () => {
    // The auto-placed label for the very first book is always 1A; asking for
    // 1C proves the client's answer wins rather than being silently
    // overwritten by the derived one.
    const { body } = await post('/api/books', {
      title: 'Dune', authors: ['Frank Herbert'], isFiction: true, location: '1C',
    })

    expect(running.store.getBook(body.id)?.location).toBe('1C')
  })
})

describe('updating a book', () => {
  it('edits an existing book in place', async () => {
    const { id } = running.store.addBook({
      title: 'Old Title', authors: ['Ann Author'], isFiction: true,
    })

    const { status, body } = await put(`/api/books/${id}`, {
      title: 'New Title', authors: ['Ann Author'], isFiction: true,
    })

    expect(status).toBe(200)
    expect(body.id).toBe(id)
    expect(running.store.getBook(id)?.title).toBe('New Title')
    expect(running.store.counts().total).toBe(1) // edited, not duplicated
  })

  it('404s on a book that does not exist, and writes nothing', async () => {
    const { status, body } = await put('/api/books/999', {
      title: 'X', authors: ['Y'], isFiction: true,
    })

    expect(status).toBe(404)
    expect(body.error).toContain('No such book')
    expect(running.store.counts().total).toBe(0)
  })

  it('400s when the edit drops the title, and leaves the row untouched', async () => {
    const { id } = running.store.addBook({
      title: 'Keep Me', authors: ['Ann Author'], isFiction: true,
    })

    const { status } = await put(`/api/books/${id}`, { authors: ['Ann Author'], isFiction: true })

    expect(status).toBe(400)
    expect(running.store.getBook(id)?.title).toBe('Keep Me')
  })
})

describe('deleting a book', () => {
  it('removes it from the catalogue', async () => {
    const { id } = running.store.addBook({
      title: 'Gone Soon', authors: ['Ann Author'], isFiction: true,
    })

    const { status, body } = await del(`/api/books/${id}`)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(running.store.getBook(id)).toBeUndefined()
    expect(running.store.counts().total).toBe(0)
  })

  it('404s on an id that was never there', async () => {
    const { status, body } = await del('/api/books/999')
    expect(status).toBe(404)
    expect(body.error).toContain('No such book')
  })
})

describe('updating a location', () => {
  it('records where a person says the book actually is', async () => {
    const { id } = running.store.addBook({
      title: 'X', authors: ['Ann Author'], isFiction: true, location: '1A',
    })

    const { status, body } = await patch(`/api/books/${id}/location`, { location: '2C' })

    expect(status).toBe(200)
    expect(body.book.location).toBe('2C')
    expect(running.store.getBook(id)?.location).toBe('2C')
  })

  it('takes the book back to never-placed on an empty label', async () => {
    const { id } = running.store.addBook({
      title: 'X', authors: ['Ann Author'], isFiction: true, location: '1A',
    })

    const { body } = await patch(`/api/books/${id}/location`, { location: '' })
    expect(body.book.location).toBe('')
  })

  it('refuses a label that is not a real location, and does not touch the row', async () => {
    const { id } = running.store.addBook({
      title: 'X', authors: ['Ann Author'], isFiction: true, location: '1A',
    })

    const { status, body } = await patch(`/api/books/${id}/location`, { location: 'the loft' })

    expect(status).toBe(400)
    expect(body.error).toContain('the loft')
    expect(running.store.getBook(id)?.location).toBe('1A')
  })

  it('404s on a book that does not exist', async () => {
    const { status } = await patch('/api/books/999/location', { location: '1A' })
    expect(status).toBe(404)
  })
})

describe('checking a book out and back in by id', () => {
  it('takes it off the shelf the first time', async () => {
    const { id } = running.store.addBook({ title: 'X', authors: ['Ann Author'], isFiction: true })

    const { status, body } = await post(`/api/books/${id}/checkout`, { out: true })

    expect(status).toBe(200)
    expect(body.outcome).toBe('checked-out')
    expect(body.book.checked_out_at).not.toBeNull()
    expect(body.counts.checkedOut).toBe(1)
  })

  it('reports already-out on a second checkout and keeps the original timestamp', async () => {
    const { id } = running.store.addBook({ title: 'X', authors: ['Ann Author'], isFiction: true })
    const first = await post(`/api/books/${id}/checkout`, { out: true })

    const second = await post(`/api/books/${id}/checkout`, { out: true })

    expect(second.body.outcome).toBe('already-out')
    expect(second.body.book.checked_out_at).toBe(first.body.book.checked_out_at)
  })

  it('checks it back in, clearing the timestamp', async () => {
    const { id } = running.store.addBook({ title: 'X', authors: ['Ann Author'], isFiction: true })
    await post(`/api/books/${id}/checkout`, { out: true })

    const { status, body } = await post(`/api/books/${id}/checkout`, { out: false })

    expect(status).toBe(200)
    expect(body.outcome).toBe('checked-in')
    expect(body.book.checked_out_at).toBeNull()
  })

  it('reports already-in for a book already on the shelf, as a no-op', async () => {
    const { id } = running.store.addBook({ title: 'X', authors: ['Ann Author'], isFiction: true })

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
      title, authors: [author], isFiction: true,
    })
    expect(status, `seeding ${title}`).toBe(201)
    return body.id as number
  }

  const misfiles = async () => (await call('/api/misfiles?range=fiction')).body

  it('leaves a book put back where the app said out of the misfile list', async () => {
    const rama = await seed('Rendezvous with Rama', 'Arthur C. Clarke')
    const dispossessed = await seed('The Dispossessed', 'Ursula K. Le Guin')
    expect(running.store.getBook(rama)?.location).toBe('1A')

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
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], isFiction: true,
      location: '2A',
    })
    expect(status).toBe(200)
    await patch(`/api/books/${dispossessed}/location`, { location: '1A' })
    await post(`/api/books/${dispossessed}/checkout`, { out: false })

    expect(running.store.getBook(dispossessed)?.location).toBe('1A')
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

    expect(running.store.getBook(dispossessed)?.location).toBe('1B')
    expect((await misfiles()).misfiles).toEqual([])
  })

  it('leaves a recorded location alone when an edit carries no observation', async () => {
    const id = await seed('The Dispossessed', 'Ursula K. Le Guin')
    await patch(`/api/books/${id}/location`, { location: '2C' })

    // The two shapes a metadata-only edit arrives in: no location key at all,
    // and the empty string. Neither one was made by somebody standing at a
    // shelf, so neither may touch the column that says where the book is.
    await put(`/api/books/${id}`, {
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], isFiction: true,
    })
    expect(running.store.getBook(id)?.location).toBe('2C')

    await put(`/api/books/${id}`, {
      title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], isFiction: true,
      location: '',
    })
    expect(running.store.getBook(id)?.location).toBe('2C')
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
      title, authors: [author], isFiction: true,
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

    expect(running.store.getBook(dune)?.location).toBe('1B')
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
    expect(running.store.getBook(rama)?.location).toBe('1A')
    expect((await misfiles()).misfiles).toEqual([])
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
    const { id } = running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], isFiction: true,
    })
    running.store.setHashes(id, hash, '')
    return { id, buffer }
  }

  it('answers with candidates and writes nothing to the catalogue', async () => {
    const { id, buffer } = await seedRecognisable()
    const before = running.store.getBook(id)

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('candidates')
    expect(body.candidates.map((c: { id: number }) => c.id)).toContain(id)

    // Load bearing: a shortlist is not a decision. Nothing about the row
    // this candidate names may have changed.
    expect(running.store.getBook(id)).toEqual(before)
    expect(running.store.counts().checkedOut).toBe(0)
  }, 20_000)

  it('still writes nothing when the book it recognises is already off the shelf', async () => {
    // The case the automatic path would have acted on: a book that is out,
    // held up again. Scanning must still only look. Deferred until the wrong
    // first candidate rate is measurably better than one in ten (#49).
    const { id, buffer } = await seedRecognisable()
    running.store.setCheckedOut(id, true)
    const before = running.store.getBook(id)

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(body.outcome).toBe('candidates')
    expect(running.store.getBook(id)).toEqual(before)
    expect(running.store.counts().checkedOut).toBe(1)
  }, 20_000)

  it('identifies a catalogued book by its barcode and leaves it exactly as it was', async () => {
    const { id } = running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], isFiction: true, isbn13: DUNE,
    })
    const before = running.store.getBook(id)
    const buffer = await backCover(DUNE)

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('identified')
    expect(body.book.id).toBe(id)

    // A barcode settles what the book is, and nothing more. Which of the two
    // directions the person wanted is theirs to say on the book's own page.
    expect(running.store.getBook(id)).toEqual(before)
    expect(running.store.counts().checkedOut).toBe(0)
  }, 20_000)

  it('takes no direction, so a body asking for one changes nothing', async () => {
    // Belt and braces on the shape: the old route wrote when told to, and a
    // client left on the old contract must not be able to reach that again.
    const { id } = running.store.addBook({
      title: 'Dune', authors: ['Frank Herbert'], isFiction: true, isbn13: DUNE,
    })
    const buffer = await backCover(DUNE)

    const { body } = await post('/api/books/scan', { image: dataUrl(buffer), out: true })

    expect(body.outcome).toBe('identified')
    expect(running.store.getBook(id)?.checked_out_at).toBeNull()
  }, 20_000)

  it('reports not-catalogued for a real ISBN nobody has saved, and writes nothing', async () => {
    const buffer = await backCover(DUNE)

    const { status, body } = await post('/api/books/scan', { image: dataUrl(buffer) })

    expect(status).toBe(200)
    expect(body.outcome).toBe('not-catalogued')
    expect(body.isbn13).toBe(DUNE)
    expect(running.store.counts().total).toBe(0)
  }, 20_000)
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
