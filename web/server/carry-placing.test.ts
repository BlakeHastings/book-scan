/**
 * Carrying a book, driven over the wire the way the screens drive it (#429).
 *
 * **The reproduction in the issue, in a world built here.** Add a piece of
 * furniture, stand it first, give it a rule another piece already has, move the
 * non-fiction run onto bookcase 3, and then walk the carry list: read the trip,
 * ask where the book in your hand goes, say it fits, and look at the list again.
 *
 * Three things were wrong and they were one defect. The trip said `3A`, the
 * placing screen said `Landing shelves · Top`, and the plan had said something
 * else again; the book went where the app asked, no assignment named that plank,
 * so the trip came straight back and the list never shrank. The finished screen
 * then said a book was on `3A` while drawing `3A` with nothing on it, because
 * nothing had ever been written there.
 *
 * The cause was that **the placing screen asked where the book belongs now,
 * from the rules, rather than being told where this trip was taking it.** With a
 * second piece claiming the same tag, "where it belongs" is answered by a
 * different reading of the rules from the one that wrote the assignment, and the
 * two answers are two different planks.
 *
 * ## Why the world has two pieces claiming one tag
 *
 * Because that is legitimate and it is what exposes this. Two rules asking for
 * the same tag is a room somebody is rearranging, not an error, and nothing here
 * refuses it. What it does is make the two readings disagree, which is the only
 * way to tell a placing screen that is *told* where to go from one that works it
 * out and happens to agree.
 *
 * ## What these tests drive
 *
 * The four calls the four carry screens make and nothing else: `GET /api/carry`
 * for the list, `GET /api/carry/trip` for the area the books come off and for
 * the area they land on, `POST /api/placement/preview` for where one book goes,
 * and `PATCH /api/books/:id/location` for the person saying they carried it.
 * **Nothing here writes a placement any other way**, which is the same promise
 * `carry.test.ts` makes at the module level: if the list needed a write of its
 * own to work, this file is where that would show up.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeTestDatabase, keepThisCatalogue, openTestDatabase } from './testdb'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { createApp, type BookScanApp } from './index'
import type { Db } from './driver'
import { Store, type DraftBook } from './store'
import { Shelves } from './shelves'
import { recordCredits, settleGenre } from './book-save'
import { applyRunMove } from './relocate-run'
import { addAreaTo, addFixture, describeFurniture, editFixture } from './furniture'
import { applyRuleChange } from './place-rule'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

/* The catalogues are stubbed the way every route test stubs them: nothing here
   is about a lookup and nothing here goes near the network. */
const nothing = {
  found: false, title: '', subtitle: '', authors: [] as string[], publisher: '',
  published: '', pages: '', isbn13: '', isbn10: '', seriesName: '', seriesIndex: null,
  coverUrl: '', source: '',
  classification: { genre: FICTION_SLUG, confidence: 'unknown' as const, reason: 'stub' },
  notes: [] as string[], subjects: [] as string[], categories: [] as string[],
}

vi.mock('./lookup', () => ({
  lookupIsbn: vi.fn(async () => ({ ...nothing })),
  searchTitle: vi.fn(async () => ({ ...nothing })),
}))

vi.mock('./covers', () => ({
  downloadCover: vi.fn(async () => ''),
  openLibraryCover: (isbn: string) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
  upgradeGoogleCover: (url: string) => url,
}))

let db: Db
let store: Store
let shelves: Shelves
let scratch: string
let coverDir: string
let app: BookScanApp
let server: Server
let baseUrl: string

/** The piece standing first, and the plank on it, for the tests to name. */
let landing = { fixtureId: 0, areaId: 0, label: '' }

const draft = (at: number, genre = NON_FICTION_SLUG): DraftBook => ({
  title: `Title ${String(at).padStart(3, '0')}`,
  authors: [`Author ${String(at).padStart(3, '0')}`],
  genre,
} as unknown as DraftBook)

/** A book put on a shelf the way a save puts one there. `carry.test.ts`'s. */
async function shelve(of: DraftBook): Promise<number> {
  const authors = new DrizzleAuthorRepository(db)
  const tags = new DrizzleTagRepository(db)
  const { id, placement } = await store.addBook(of)
  await settleGenre(new RestateTagsHandler(tags, new DbBookTransactions(db)), tags, id, of)
  await recordCredits(
    new CreditBookHandler(authors), authors, new FileAliasHandler(authors), id, of,
  )
  const landed = placement && await shelves.labelFor(placement.range, id)
  if (landed) await store.setLocation(id, landed)
  return id
}

/**
 * The room the issue describes: books on a bookcase, a new piece standing in
 * front of them claiming the same tag, and the run moved off onto bookcase 3.
 *
 * Standing the piece first is what renumbers the non-fiction bookcase, which is
 * why the trip in these tests reads `5A to 3A` exactly as the issue's does. It
 * is done by bumping the pieces that were there and then taking the number, the
 * way the fixtures screen does it: nothing renumbers a room on somebody's
 * behalf, because every label on every piece is derived from its number.
 */
async function buildTheWorld(): Promise<void> {
  for (let at = 0; at < 6; at += 1) await shelve(draft(at))
  await shelve(draft(100, FICTION_SLUG))

  const added = await addFixture(db, { kind: 'bookshelf', name: 'Landing shelves' })
  if (!added.ok) throw new Error(added.error)
  const shelf = await addAreaTo(db, added.fixture.id, { name: 'Top' })
  if (!shelf.ok) throw new Error(shelf.error)

  for (const piece of (await describeFurniture(db)).fixtures) {
    if (piece.id === added.fixture.id) continue
    const bumped = await editFixture(db, piece.id, { position: piece.position + 1 })
    if (!bumped.ok) throw new Error(bumped.error)
  }
  const first = await editFixture(db, added.fixture.id, { position: 1 })
  if (!first.ok) throw new Error(first.error)

  const wrote = await applyRuleChange(db, {
    about: 'fixture',
    placeId: added.fixture.id,
    rules: [{ id: null, conditions: [{ operator: 'is', tag: NON_FICTION_SLUG }] }],
  }, new Date().toISOString())
  if (!wrote.ok) throw new Error(wrote.error)

  landing = {
    fixtureId: added.fixture.id,
    areaId: shelf.area.id,
    // What it reads as now that it stands first, which is what the placing
    // screen was putting in front of people.
    label: (await describeFurniture(db)).fixtures
      .find((piece) => piece.id === added.fixture.id)!.areas[0]!.label,
  }

  const moved = await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
  if (!moved.ok) throw new Error(moved.error)
}

beforeAll(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
  scratch = scratchRoot('carry-placing')

  await buildTheWorld()
  await keepThisCatalogue('a_second_claimant')
})

beforeEach(async () => {
  await openTestDatabase('a_second_claimant')
  coverDir = mkdtempSync(join(scratch, 'carry-placing-'))
  app = createApp({ db, coverDir, startBackgroundWork: false })
  server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await app.settled()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  rmSync(coverDir, { recursive: true, force: true })
})

afterAll(async () => {
  await closeTestDatabase()
  removeScratchRoot(scratch)
})

const get = async (path: string) => {
  const response = await fetch(`${baseUrl}${path}`)
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

const send = async (method: string, path: string, body: unknown) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

interface Trip {
  from: string
  to: string
  fromAreaId: number
  toAreaId: number
  books: { id: number; title: string }[]
}

/** The list, as the first carry screen reads it. */
const theList = async () => (await get('/api/carry')).body as unknown as {
  moving: number
  trips: Trip[]
}

/**
 * Where one book goes, asked the way `CarryingScreen` asks it.
 *
 * The book's own row first, because the preview is answered from a draft and the
 * answer has to be the one a save of that book would give; then the plank the
 * trip is taking it to, which is the argument this issue is about.
 */
async function whereItGoes(bookId: number, goingTo?: number) {
  const { book } = (await get(`/api/books/${bookId}`)).body as unknown as {
    book: { title: string; authors: string; shelf_range: string }
  }
  const answer = await send('POST', '/api/placement/preview', {
    title: book.title,
    authors: book.authors,
    genre: book.shelf_range === 'fiction' ? FICTION_SLUG : NON_FICTION_SLUG,
    excludeId: bookId,
    goingTo,
  })
  return answer as {
    status: number
    body: {
      derivedLocation?: string
      derivedAreaId?: number | null
      instruction?: string
      strip?: { label: string; gapIndex: number; books: { title: string }[] } | null
      error?: string
    }
  }
}

/** The person saying they carried it, which is the one route that moves a book. */
const carried = (bookId: number, areaId: number) =>
  send('PATCH', `/api/books/${bookId}/location`, { areaId })

describe('the placing screen is told where the trip goes', () => {
  it('names the plank the trip names, not the one the rules answer now', async () => {
    const { trips } = await theList()
    const trip = trips[0]!

    expect(trip.from, 'the run should have moved off the renumbered bookcase').toBe('5A')
    expect(trip.to).toBe('3A')

    const asked = await whereItGoes(trip.books[0]!.id, trip.toAreaId)

    expect(asked.status).toBe(200)
    expect(asked.body.derivedLocation, 'the placing screen names another plank')
      .toBe(trip.to)
    expect(asked.body.derivedAreaId, 'and would write the book onto it')
      .toBe(trip.toAreaId)
  })

  /*
   * The half that says the divergence is real rather than assumed. Asked without
   * being told, the same book is answered with a plank on the piece standing
   * first, because that is where the rules put it now. Both readings are
   * defensible and neither is this screen's to make: what the person is doing is
   * walking a trip, and the trip already said where it goes.
   */
  it('is a different answer from the one the rules give unasked', async () => {
    const { trips } = await theList()
    const trip = trips[0]!

    const unasked = await whereItGoes(trip.books[0]!.id)

    expect(unasked.body.derivedLocation).toBe(landing.label)
    expect(unasked.body.derivedAreaId).toBe(landing.areaId)
  })

  it('draws the plank as it stands, so the gap is among the books that are there',
    async () => {
      const { trips } = await theList()
      const trip = trips[0]!

      // Nothing on it yet, which is the ordinary first book of a trip: there is
      // no row of spines to put a gap in, so the sentence says so.
      const first = await whereItGoes(trip.books[0]!.id, trip.toAreaId)
      expect(first.body.strip).toBeNull()
      expect(first.body.instruction).toContain('nothing on it yet')

      await carried(trip.books[0]!.id, trip.toAreaId)

      // And then it is drawn, with the book just carried standing in it. The run
      // laid out by sort key would have drawn five more that are still on 5A.
      const second = await whereItGoes(trip.books[1]!.id, trip.toAreaId)
      expect(second.body.strip?.label).toBe(trip.to)
      expect(second.body.strip?.books.map((book) => book.title))
        .toEqual([trip.books[0]!.title])
      expect(second.body.instruction, 'the sentence claims a place in the whole run')
        .not.toContain('non-fiction')
    })

  it('refuses a plank this collection does not have rather than falling back',
    async () => {
      const { trips } = await theList()
      const asked = await whereItGoes(trips[0]!.books[0]!.id, 9_999)

      expect(asked.status).toBe(400)
      expect(asked.body.error).toBe('There is no such plank to put a book on.')
    })

  /*
   * The review pane asks the same route and asks the other question, so this is
   * the check that nothing was taken away from it: with no plank named, the
   * answer is still the rules' own.
   */
  it('still answers where a book belongs when nobody says where it is going',
    async () => {
      const { trips } = await theList()
      const asked = await whereItGoes(trips[0]!.books[0]!.id)

      expect(asked.status).toBe(200)
      expect(asked.body.derivedAreaId).not.toBeNull()
    })
})

describe('doing what the app asks satisfies the app', () => {
  it('takes each carried book off the list and moves the count', async () => {
    const before = await theList()
    expect(before.moving).toBe(6)

    const trip = before.trips[0]!
    let left = before.moving

    for (const book of trip.books) {
      const asked = await whereItGoes(book.id, trip.toAreaId)
      // Exactly what "It fits, save" sends: the plank the screen just named.
      const wrote = await carried(book.id, asked.body.derivedAreaId!)
      expect(wrote.status).toBe(200)

      left -= 1
      expect((await theList()).moving, `${book.title} did not come off the list`)
        .toBe(left)
    }

    const after = await theList()
    expect(after.moving).toBe(0)
    expect(after.trips, 'the trip came back').toEqual([])
  })

  it('draws the books it says are on the plank at the end of the trip', async () => {
    const trip = (await theList()).trips[0]!

    for (const book of trip.books) {
      const asked = await whereItGoes(book.id, trip.toAreaId)
      await carried(book.id, asked.body.derivedAreaId!)
    }

    // The area named twice is the area on its own, which is what the finished
    // screen reads. It said "one book is on 3A" over a drawing of nothing.
    const board = (await get(
      `/api/carry/trip?from=${trip.toAreaId}&to=${trip.toAreaId}`,
    )).body as unknown as { to: string; books: { title: string }[] }

    expect(board.to).toBe(trip.to)
    expect(board.books.map((book) => book.title))
      .toEqual(trip.books.map((book) => book.title))
  })

  /*
   * The rule this fix is not allowed to break. Where a book is is what a person
   * said, and one `placed` row per carry is the whole of what this journey
   * writes: no repair, no second row, and nothing rewriting an older one.
   */
  it('writes one placed row per book and rewrites none of them', async () => {
    const trip = (await theList()).trips[0]!
    const ids = trip.books.map((book) => book.id)

    const was = (await new DrizzlePlacementLedger(db).forBooks(ids))
      .filter((row) => row.kind === 'placed')

    for (const book of trip.books) {
      const asked = await whereItGoes(book.id, trip.toAreaId)
      await carried(book.id, asked.body.derivedAreaId!)
    }

    const now = await new DrizzlePlacementLedger(db).forBooks(ids)
    const placed = now.filter((row) => row.kind === 'placed')

    expect(placed.length, 'one row per book carried, on top of what was there')
      .toBe(was.length + ids.length)
    // The rows that were already there are untouched, by id and by area.
    expect(placed.filter((row) => was.some((old) => old.id === row.id))
      .map((row) => [row.id, row.areaId]).sort())
      .toEqual(was.map((row) => [row.id, row.areaId]).sort())
    // And every new one names the plank the person was standing at.
    for (const row of placed.filter((one) => !was.some((old) => old.id === one.id))) {
      expect(row.areaId).toBe(trip.toAreaId)
      expect(row.actor).toBe('person')
    }
  })
})
