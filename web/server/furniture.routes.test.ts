/**
 * The furniture routes, driven over real HTTP against a catalogue with books in
 * it.
 *
 * The app is built with `createApp()` and started on an ephemeral port, the same
 * way `index.test.ts` and `tags.routes.test.ts` do it; this suite must not add
 * supertest. The world itself is built through `Store` and the handlers
 * directly, the way `relocate-run.test.ts` builds it, so no network call is made
 * setting it up.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeTestDatabase, keepThisCatalogue, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { createApp, type BookScanApp } from './index'
import { signedIn } from './testauth'
import { Store, type DraftBook } from './store'
import { Shelves } from './shelves'
import { recordCredits, settleGenre } from './book-save'
import { photographTaken, recordCrop } from './photographs'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store
let shelves: Shelves
let app: BookScanApp
let server: Server
let baseUrl: string
/** The session every request in this file carries. See server/testauth.ts. */
let cookie: string
/** This file's own scratch root, which no other test file can name. */
let scratch: string
let coverDir: string

/** A save, all four steps of it, exactly as `POST /api/books` performs them. */
async function shelve(draft: DraftBook): Promise<number> {
  const authors = new DrizzleAuthorRepository(db)
  const tags = new DrizzleTagRepository(db)
  const { id, placement } = await store.addBook(draft)
  await settleGenre(new RestateTagsHandler(tags, new DbBookTransactions(db)), tags, id, draft)
  await recordCredits(
    new CreditBookHandler(authors), authors, new FileAliasHandler(authors), id, draft,
  )
  const landed = placement && await shelves.labelFor(placement.range, id)
  if (landed) await store.setLocation(id, landed)
  return id
}

const draft = (at: number, genre = NON_FICTION_SLUG): DraftBook => ({
  title: `Title ${String(at).padStart(3, '0')}`,
  authors: [`Author ${String(at).padStart(3, '0')}`],
  genre,
})

/**
 * The same world `relocate-run.test.ts` builds, in the same order: the
 * dividers go in around books that were already there.
 *
 * The size is a parameter, default small, because building the owner's actual
 * fifty seventeen times over would cost most of a minute of every CI run.
 */
async function buildWorld(books = 6, cuts = [2, 4]): Promise<number[]> {
  const ids: number[] = []
  for (let at = 0; at < books; at += 1) ids.push(await shelve(draft(at)))
  ids.push(await shelve(draft(100, FICTION_SLUG)))

  const run = await shelves.layout('nonfiction')
  const separators = new DrizzleSeparatorRepository(db)
  for (const [position, first] of cuts.entries()) {
    await separators.add({
      range: 'nonfiction',
      kind: 'area',
      startsAt: run[first]!.book.sortKey,
      position,
      note: '',
      createdAt: new Date().toISOString(),
    })
  }

  for (const placed of await shelves.layout('nonfiction')) {
    await store.setLocation(placed.book.id, placed.label)
  }

  return ids
}

/**
 * A kept snapshot of the owner's fifty, restored rather than rebuilt each
 * time, for the tests that need it. `openTestDatabase` also restores the
 * session table, so the caller must sign in again afterward.
 */
const buildTheWorld = async () => {
  const restored = await openTestDatabase('the_owners_room')
  cookie = (await signedIn(restored)).cookie
  return restored
}

interface Answer {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
    // Every route under /api requires a session; a request without one is refused 401.
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  })
  return { status: response.status, body: await response.json() }
}

const get = (path: string) => call('GET', path)
const post = (path: string, body?: unknown) => call('POST', path, body ?? {})
const patch = (path: string, body: unknown) => call('PATCH', path, body)
const remove = (path: string) => call('DELETE', path)

/** The bookcase the non-fiction run stands on, which is number 4. */
async function nonFiction() {
  const { body } = await get('/api/fixtures')
  return body.fixtures.find((one: { position: number }) => one.position === 4)
}

/** Every placement row in the catalogue, so a test can prove none was deleted. */
async function everyPlacement(): Promise<{ id: number; area_id: number | null }[]> {
  return db.all('SELECT id, area_id FROM book_placement ORDER BY id')
}

/**
 * Excludes `assigned` rows: a renumber legitimately writes those now, so
 * "unchanged" here means what a person recorded, not the whole ledger.
 */
async function placedRows(): Promise<{ id: number; area_id: number | null }[]> {
  return db.all(
    `SELECT id, area_id FROM book_placement WHERE kind <> 'assigned' ORDER BY id`,
  )
}

/** The assignments, newest last, with the sentence saying what wrote them. */
async function assignedRows(): Promise<{ area_id: number | null; reason: string }[]> {
  return db.all(
    `SELECT area_id, reason FROM book_placement WHERE kind = 'assigned' ORDER BY id`,
  )
}

/** openTestDatabase restores every table in the catalogue between tests, so this file does not need to snapshot and restore the furniture itself. */
beforeAll(async () => {
  scratch = scratchRoot('furniture')

  // The owner's fifty, built once and kept, for the two tests that want it.
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
  await buildWorld(50, [8, 28])
  await keepThisCatalogue('the_owners_room')
})

beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)

  coverDir = mkdtempSync(join(scratch, 'furniture-test-'))
  cookie = (await signedIn(db)).cookie
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
  // The per-test cover directories go in `afterEach`; this is the root they were made in.
  removeScratchRoot(scratch)
})

describe('reading the room', () => {
  it('answers the furniture the catalogue already has, with labels worked out', async () => {
    await buildTheWorld()

    const answer = await get('/api/fixtures')
    expect(answer.status).toBe(200)

    const bookcase = await nonFiction()
    expect(bookcase.label).toBe('4')
    expect(bookcase.books).toBe(50)
    expect(bookcase.areas.map((one: { label: string; books: number }) =>
      [one.label, one.books])).toEqual([['4A', 8], ['4B', 20], ['4C', 22]])

    // No label is stored anywhere, so none comes back off a column.
    const stored = await db.all<{ count: number }>(
      `SELECT count(*) AS count FROM information_schema.columns
        WHERE table_name IN ('fixture', 'area') AND column_name = 'label'`,
    )
    expect(Number(stored[0]!.count)).toBe(0)
  })

  /**
   * A rule points at a piece, so only the first area on it is where the run
   * begins; the rest are that run carrying on. `genre/non-fiction` is an
   * internal identity and must never reach a screen in place of its label.
   */
  it('says what files onto each piece and each area, in words and never in slugs',
    async () => {
      await buildWorld()

      const bookcase = await nonFiction()
      expect(bookcase.holds).toBe('Anything tagged Non-fiction')
      expect(bookcase.rule.about).toBe('fixture')
      expect(bookcase.rule.conditions)
        .toEqual([{ operator: 'is', tag: 'Non-fiction', carried: 6 }])

      expect(bookcase.areas.map((one: { holds: string; entry: boolean }) =>
        [one.holds, one.entry])).toEqual([
        ['Non-fiction starts here', true],
        ['Non-fiction, carrying on', false],
        ['Non-fiction, carrying on', false],
      ])

      const { body } = await get('/api/fixtures')
      expect(JSON.stringify(body)).not.toMatch(/genre\//)
    })

  /**
   * An area with an order of its own takes no overflow, so it opens a run, and
   * nothing points at that run. Saying "Non-fiction, carrying on" there would be
   * claiming books arrive somewhere they cannot reach.
   */
  it('says an area nothing can reach is filled by hand', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const middle = bookcase.areas[1]

    const set = await patch(`/api/areas/${middle.id}`, {
      sortStrategy: 'title', acknowledge: true,
    })
    expect(set.status).toBe(200)

    expect((await nonFiction()).areas.map((one: { holds: string }) => one.holds)).toEqual([
      'Non-fiction starts here', 'Put here by hand', 'Put here by hand',
    ])
  })
})

/**
 * `/api/fixtures` names a plank through `labelFor`; `/api/shelves` names it
 * through `locationLabel`. These are two independent renderings of one place,
 * and using a crate rather than a bookcase catches a screen that worked its
 * heading out of the label by assuming the word "Bookcase".
 */
describe('the shelf and the furniture, asked about one piece', () => {
  it('names a plank the same way on both routes', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const renamed = await patch(`/api/fixtures/${bookcase.id}`, {
      name: 'Hall shelf', kind: 'crate',
    })
    expect(renamed.status).toBe(200)

    const furniture = (await nonFiction()).areas.map((one: { label: string }) => one.label)
    const shelved = (await get('/api/shelves?range=nonfiction')).body
      .groups.map((one: { label: string }) => one.label)

    expect(furniture).toEqual(['Hall shelf · A', 'Hall shelf · B', 'Hall shelf · C'])
    expect(shelved).toEqual(furniture)
  })

  it('says which piece the planks hang on, and calls a crate a crate', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    await patch(`/api/fixtures/${bookcase.id}`, { kind: 'crate' })

    const { body } = await get('/api/shelves?range=nonfiction')
    expect(body.groups.map((one: { standing: { kind: string; fixtureId: number } | null }) =>
      one.standing && [one.standing.fixtureId, one.standing.kind]))
      .toEqual([[bookcase.id, 'crate'], [bookcase.id, 'crate'], [bookcase.id, 'crate']])
  })
})

describe('how the whole collection is ordered', () => {
  it('writes it, and every area that inherits is ordered by it afterwards', async () => {
    await buildWorld()

    const before = await nonFiction()
    expect(before.sortStrategy).toBe('inherit')
    expect(before.areas.map((one: { ordering: string }) => one.ordering))
      .toEqual(['author', 'author', 'author'])

    const set = await patch('/api/collection', { defaultSortStrategy: 'title' })
    expect(set.status).toBe(200)
    expect(set.body.collection.defaultSortStrategy).toBe('title')

    const { body } = await get('/api/fixtures')
    expect(body.defaultSortStrategy).toBe('title')
    expect((await nonFiction()).areas.map((one: { ordering: string }) => one.ordering))
      .toEqual(['title', 'title', 'title'])
  })

  /**
   * An area given an order of its own is deliberately not touched by this: a
   * run is only ever reordered by somebody changing that run.
   */
  it('leaves an area that has chosen for itself exactly where it was', async () => {
    await buildWorld()
    const middle = (await nonFiction()).areas[1]
    await patch(`/api/areas/${middle.id}`, { sortStrategy: 'published', acknowledge: true })

    await patch('/api/collection', { defaultSortStrategy: 'title' })

    expect((await nonFiction()).areas.map((one: { ordering: string }) => one.ordering))
      .toEqual(['title', 'published', 'title'])
  })

  it('refuses inherit, which has nothing above it to ask', async () => {
    await buildWorld()

    const set = await patch('/api/collection', { defaultSortStrategy: 'inherit' })
    expect(set.status).toBe(400)
    expect(set.body.error).toMatch(/nothing above it/)
    expect((await get('/api/fixtures')).body.defaultSortStrategy).toBe('author')
  })

  /*
   * Ordering by tag is sensible for one area but files a whole house by an
   * accident of the vocabulary, which is why it is refused as a collection default.
   */
  it('refuses tag, which is a way to order one area and not a house', async () => {
    await buildWorld()

    const set = await patch('/api/collection', { defaultSortStrategy: 'tag' })
    expect(set.status).toBe(400)
    expect(set.body.error).toMatch(/cannot be ordered by tag/)
    expect((await get('/api/fixtures')).body.defaultSortStrategy).toBe('author')
  })

  it('refuses a word that is not a way of ordering anything', async () => {
    await buildWorld()

    expect((await patch('/api/collection', { defaultSortStrategy: 'colour' })).status).toBe(400)
    expect((await patch('/api/collection', {})).status).toBe(400)
  })
})

describe('describing a piece of furniture that has never existed', () => {
  it('takes a name, a kind, areas in an order, and reads them back', async () => {
    await buildWorld()

    const made = await post('/api/fixtures', { kind: 'windowsill', name: 'By the window' })
    expect(made.status).toBe(201)
    const id = made.body.fixture.id
    expect(made.body.fixture.label).toBe('By the window')
    expect(made.body.fixture.areas).toEqual([])

    for (const name of ['', 'Cookery', '']) {
      const area = await post(`/api/fixtures/${id}/areas`, { name })
      expect(area.status).toBe(201)
    }

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { label: string }) => one.label)).toEqual([
      'By the window · A', 'By the window · Cookery', 'By the window · C',
    ])
    expect((await nonFiction()).books).toBe(6)
  })

  it('renames a piece and says every label that reads differently', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const before = await everyPlacement()

    const renamed = await patch(`/api/fixtures/${bookcase.id}`, { name: 'Hall shelf' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.becomes).toEqual([
      { from: '4A', to: 'Hall shelf · A' },
      { from: '4B', to: 'Hall shelf · B' },
      { from: '4C', to: 'Hall shelf · C' },
    ])

    // A rename strands nothing: a book's recorded location is an area row, so
    // the ledger is untouched and every book reads under the new name.
    expect(await everyPlacement()).toEqual(before)
    expect((await nonFiction()).areas.map((one: { books: number }) => one.books))
      .toEqual([2, 2, 2])
  })

  /**
   * Standing this piece on a taken position hands its planks to the piece
   * already there, since the run walks in `fixture.position` order, so every
   * book on it derives somewhere else. `placedRows` checks what a person
   * recorded stays unchanged; `assignedRows` below checks what the renumber
   * itself writes.
   */
  it('renumbers a piece, records where that put its books, and says who else is on that number',
    async () => {
      await buildWorld()
      const bookcase = await nonFiction()
      const before = await placedRows()

      const moved = await patch(`/api/fixtures/${bookcase.id}`, { position: 1 })
      expect(moved.status).toBe(200)
      expect(moved.body.becomes).toEqual([
        { from: '4A', to: '1A' },
        { from: '4B', to: '1B' },
        { from: '4C', to: '1C' },
      ])

      // The recorded location is where the book physically is; nothing a
      // person put on a shelf was rewritten by the renumber.
      expect(await placedRows()).toEqual(before)

      // Every non-fiction book now derives onto a plank of the piece already
      // standing at 1, so each one gets an assignment.
      const assigned = await assignedRows()
      expect(assigned).toHaveLength(6)
      expect(new Set(assigned.map((row) => row.reason))).toEqual(new Set(['4 was renumbered']))

      // Two pieces standing on one number is recorded, not refused; `sharing` reports it.
      expect(moved.body.fixture.sharing).toHaveLength(1)
    })

  it('writes nothing for a rename, which really does move no book', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const before = await everyPlacement()

    const renamed = await patch(`/api/fixtures/${bookcase.id}`, { name: 'Hall shelf' })
    expect(renamed.status).toBe(200)

    // The whole ledger, assignments included: a rename is read by no
    // derivation, so there is nothing here for the comparison to find.
    expect(await everyPlacement()).toEqual(before)
  })
})

/**
 * A boundary is a book, so a run with nothing standing in it has no book to
 * anchor a new area on; it opens on the same anchor as the run itself. Two
 * anchors being equal is allowed on purpose: it takes no book off anybody.
 */
describe('cutting an area into a run with nothing standing in it', () => {
  it('adds it to a piece nothing has ever been filed onto', async () => {
    await buildWorld()
    const made = await post('/api/fixtures', { kind: 'crate', name: 'Hall crate' })
    const id = made.body.fixture.id
    await post(`/api/fixtures/${id}/areas`, {})

    const added = await post(`/api/fixtures/${id}/areas`, { position: 1 })
    expect(added.status).toBe(201)

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { label: string }) => one.label))
      .toEqual(['Hall crate · A', 'Hall crate · B'])
  })

  /**
   * The new area opens on the same anchor as the one it follows, which the
   * server must accept rather than refuse as running backwards.
   */
  it('adds it after an empty area on a bookcase that is full, and moves no book', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const before = await everyPlacement()

    // A plank past the end of the run: anchored after every book on the piece,
    // so it stands there holding nothing, exactly as one emptied by a carry.
    const beyond = await post(`/api/fixtures/${bookcase.id}/areas`, { startsAt: '~~~' })
    expect(beyond.status).toBe(201)
    expect(beyond.body.area.books).toBe(0)

    const added = await post(`/api/fixtures/${bookcase.id}/areas`, {
      position: beyond.body.area.position + 1,
      startsAt: beyond.body.area.startsAt,
    })
    expect(added.status).toBe(201)
    expect(added.body.area.books).toBe(0)

    const after = await get(`/api/fixtures/${bookcase.id}`)
    expect(after.body.fixture.areas.map((one: { books: number }) => one.books))
      .toEqual([2, 2, 2, 0, 0])
    expect(await everyPlacement()).toEqual(before)
  })

  /**
   * This is why the empty case above takes its neighbour's anchor rather than
   * the beginning: an area cannot open before the one in front of it.
   */
  it('still refuses an area that opens before the one in front of it', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const added = await post(`/api/fixtures/${bookcase.id}/areas`, { startsAt: '' })
    expect(added.status).toBe(409)
  })
})

/**
 * A label comes from an ordinal nothing else has, so adding an area this way
 * relabels nothing. It opens anchored past every book already on the piece,
 * since anchoring at the empty string or at the area it follows would each
 * claim books that belong elsewhere.
 */
describe('adding an area with no question asked', () => {
  it('lands at the end, holding nothing, and moves no book', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const before = await everyPlacement()

    const added = await post(`/api/fixtures/${bookcase.id}/areas`, {})
    expect(added.status).toBe(201)
    expect(added.body.area.books).toBe(0)
    expect(added.body.area.position).toBe(3)

    const after = await get(`/api/fixtures/${bookcase.id}`)
    expect(after.body.fixture.areas.map((one: { books: number }) => one.books))
      .toEqual([2, 2, 2, 0])
    expect(await everyPlacement()).toEqual(before)
  })

  it('changes no label at all, and says so', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const was = (await get(`/api/fixtures/${bookcase.id}`)).body.fixture.areas
      .map((one: { label: string }) => one.label)

    const added = await post(`/api/fixtures/${bookcase.id}/areas`, {})
    expect(added.body.becomes).toEqual([])

    const now = (await get(`/api/fixtures/${bookcase.id}`)).body.fixture.areas
      .map((one: { label: string }) => one.label)
    expect(now.slice(0, was.length)).toEqual(was)
    expect(now).toHaveLength(was.length + 1)
  })

  /** And the same on a piece somebody has named, where every label is a phrase. */
  it('changes no label on a piece whose areas are named either', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    await patch(`/api/fixtures/${bookcase.id}`, { name: 'Hall shelf' })
    await patch(`/api/areas/${bookcase.areas[1].id}`, { name: 'Cookery' })

    const was = (await get(`/api/fixtures/${bookcase.id}`)).body.fixture.areas
      .map((one: { label: string }) => one.label)
    expect(was).toContain('Hall shelf · Cookery')

    const added = await post(`/api/fixtures/${bookcase.id}/areas`, {})
    expect(added.status).toBe(201)
    expect(added.body.becomes).toEqual([])

    const now = (await get(`/api/fixtures/${bookcase.id}`)).body.fixture.areas
      .map((one: { label: string }) => one.label)
    expect(now.slice(0, was.length)).toEqual(was)
  })

  /**
   * The second press follows an area already anchored past every book, so the
   * anchor arithmetic has to take that anchor rather than one below it.
   */
  it('can be pressed twice, and the second one is refused by nothing', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    expect((await post(`/api/fixtures/${bookcase.id}/areas`, {})).status).toBe(201)
    const second = await post(`/api/fixtures/${bookcase.id}/areas`, {})
    expect(second.status).toBe(201)
    expect(second.body.area.books).toBe(0)

    const after = await get(`/api/fixtures/${bookcase.id}`)
    expect(after.body.fixture.areas.map((one: { books: number }) => one.books))
      .toEqual([2, 2, 2, 0, 0])
  })

  /**
   * A new piece stands at the end of the room, so books already on the piece
   * before it would flow onto a naively-anchored new area; the anchor has to
   * be worked out rather than defaulted.
   */
  it('takes no book off the piece before it on a brand new piece', async () => {
    await buildWorld()
    const before = await everyPlacement()
    const made = await post('/api/fixtures', { kind: 'crate', name: 'Hall crate' })
    const id = made.body.fixture.id

    expect((await post(`/api/fixtures/${id}/areas`, {})).status).toBe(201)
    expect((await post(`/api/fixtures/${id}/areas`, {})).status).toBe(201)

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { label: string }) => one.label))
      .toEqual(['Hall crate · A', 'Hall crate · B'])
    expect(body.fixture.areas.map((one: { books: number }) => one.books)).toEqual([0, 0])
    expect(await everyPlacement()).toEqual(before)
  })
})

describe('reordering the areas on a piece', () => {
  /** A piece with five unanchored planks, which is somebody typing furniture in. */
  async function fivePlanks(): Promise<{ id: number; areas: number[] }> {
    const made = await post('/api/fixtures', { name: 'By the window' })
    const id = made.body.fixture.id
    const areas: number[] = []
    for (let at = 0; at < 5; at += 1) {
      areas.push((await post(`/api/fixtures/${id}/areas`, {})).body.area.id)
    }
    return { id, areas }
  }

  it('moves one to the front without two areas ever sharing an ordinal', async () => {
    await buildWorld()
    const { id, areas } = await fivePlanks()

    const moved = await patch(`/api/areas/${areas[4]}`, { position: 0 })
    expect(moved.status).toBe(200)

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { id: number }) => one.id))
      .toEqual([areas[4], areas[0], areas[1], areas[2], areas[3]])
    expect(body.fixture.areas.map((one: { position: number }) => one.position))
      .toEqual([0, 1, 2, 3, 4])
    expect(moved.body.becomes).toEqual([
      { from: 'By the window · E', to: 'By the window · A' },
      { from: 'By the window · A', to: 'By the window · B' },
      { from: 'By the window · B', to: 'By the window · C' },
      { from: 'By the window · C', to: 'By the window · D' },
      { from: 'By the window · D', to: 'By the window · E' },
    ])
  })

  it('swaps two neighbours, which is the move a one-pass update collides on', async () => {
    await buildWorld()
    const { id, areas } = await fivePlanks()

    expect((await patch(`/api/areas/${areas[1]}`, { position: 0 })).status).toBe(200)

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { id: number }) => one.id))
      .toEqual([areas[1], areas[0], areas[2], areas[3], areas[4]])
  })

  it('inserts an area between two that exist and shuffles the rest along', async () => {
    await buildWorld()
    const { id, areas } = await fivePlanks()

    const added = await post(`/api/fixtures/${id}/areas`, { position: 1, name: 'Cookery' })
    expect(added.status).toBe(201)
    expect(added.body.becomes).toEqual([
      { from: 'By the window · B', to: 'By the window · C' },
      { from: 'By the window · C', to: 'By the window · D' },
      { from: 'By the window · D', to: 'By the window · E' },
      { from: 'By the window · E', to: 'By the window · F' },
    ])

    const { body } = await get(`/api/fixtures/${id}`)
    expect(body.fixture.areas.map((one: { id: number }) => one.id))
      .toEqual([areas[0], added.body.area.id, areas[1], areas[2], areas[3], areas[4]])
  })

  it('refuses to put an area in front of one whose books come before it', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const refused = await patch(`/api/areas/${bookcase.areas[2].id}`, { position: 0 })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('cannot start before')

    expect((await nonFiction()).areas.map((one: { label: string }) => one.label))
      .toEqual(['4A', '4B', '4C'])
  })
})

describe('removing an area from a bookcase that is not empty', () => {
  it('says what becomes of its books before anything happens', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const before = await everyPlacement()

    const { status, body } = await get(`/api/areas/${bookcase.areas[1].id}/removal`)
    expect(status).toBe(200)
    expect(body.plan.area).toEqual({ id: bookcase.areas[1].id, label: '4B', books: 2 })
    expect(body.plan.into).toEqual({ id: bookcase.areas[0].id, label: '4A' })
    expect(body.plan.joins).toBe('previous')
    expect(body.plan.joining).toBe(2)
    expect(body.plan.skipped).toEqual([])
    expect(body.plan.becomes).toEqual([
      { from: '4B', to: '4A' },
      { from: '4C', to: '4B' },
    ])

    // Strictly a plan.
    expect(await everyPlacement()).toEqual(before)
  })

  it('merges it into the area before, writes assignments, and deletes no placement',
    async () => {
      await buildTheWorld()
      const bookcase = await nonFiction()
      const going = bookcase.areas[1].id
      const into = bookcase.areas[0].id
      const before = await everyPlacement()

      const removed = await remove(`/api/areas/${going}`)
      expect(removed.status).toBe(200)
      expect(removed.body.plan.joining).toBe(20)

      const after = await everyPlacement()
      expect(after.slice(0, before.length)).toEqual(before)
      expect(after).toHaveLength(before.length + 20)

      const written = await db.all<{ kind: string; area_id: number; actor: string }>(
        'SELECT kind, area_id, actor FROM book_placement ORDER BY id DESC LIMIT 20',
      )
      expect(written.every((row) => row.kind === 'assigned')).toBe(true)
      expect(written.every((row) => Number(row.area_id) === into)).toBe(true)
      expect(written.every((row) => row.actor === 'rules')).toBe(true)

      // The plank is retired rather than deleted, so a book recorded on it is
      // still recorded on it: the row survives at a negative ordinal.
      const retired = await db.get<{ position: number }>(
        'SELECT position FROM area WHERE id = ?', [going],
      )
      expect(Number(retired!.position)).toBeLessThan(0)

      const face = await nonFiction()
      expect(face.areas.map((one: { id: number; label: string }) => [one.id, one.label]))
        .toEqual([[into, '4A'], [bookcase.areas[2].id, '4B']])
    })

  it('leaves a pinned book alone and says how many it left alone', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const going = bookcase.areas[1].id

    const pinned = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1', [going],
    )
    await new DrizzlePlacementLedger(db).record({
      bookId: pinned!.id,
      kind: 'pinned',
      areaId: going,
      sortKey: '',
      actor: 'person',
      reason: 'it lives here',
      createdAt: new Date().toISOString(),
    })

    const planned = await get(`/api/areas/${going}/removal`)
    expect(planned.body.plan.joining).toBe(1)
    expect(planned.body.plan.skipped).toEqual([{ reason: 'pinned', books: 1 }])

    const removed = await remove(`/api/areas/${going}`)
    expect(removed.body.plan.skipped).toEqual([{ reason: 'pinned', books: 1 }])

    const rows = await new DrizzlePlacementLedger(db).forBooks([pinned!.id])
    expect(rows.filter((row) => row.kind === 'assigned')).toEqual([])
    expect(rows[rows.length - 1]!.kind).toBe('pinned')
  })

  it('brings the next area forward when the first one goes, anchor and all', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const going = bookcase.areas[0].id
    const into = bookcase.areas[1].id

    const planned = await get(`/api/areas/${going}/removal`)
    expect(planned.body.plan.joins).toBe('next')
    expect(planned.body.plan.into).toEqual({ id: into, label: '4B' })
    expect(planned.body.plan.joining).toBe(2)
    expect(planned.body.plan.becomes).toEqual([
      { from: '4B', to: '4A' },
      { from: '4C', to: '4B' },
    ])

    expect((await remove(`/api/areas/${going}`)).status).toBe(200)

    // The area coming forward took over the removed one's anchor, opening it
    // at the beginning of the run rather than a third of the way in.
    const anchor = await db.get<{ starts_at: string }>(
      'SELECT starts_at FROM area WHERE id = ?', [into],
    )
    expect(anchor!.starts_at).toBe('')

    const face = await nonFiction()
    expect(face.areas.map((one: { id: number; label: string }) => [one.id, one.label]))
      .toEqual([[into, '4A'], [bookcase.areas[2].id, '4B']])
  })

  it('refuses the only area on a piece, and says what the way out is', async () => {
    await buildWorld()
    const made = await post('/api/fixtures', { kind: 'desk', name: 'Desk' })
    const id = made.body.fixture.id
    const only = (await post(`/api/fixtures/${id}/areas`, { name: 'Left side' })).body.area.id

    const refused = await remove(`/api/areas/${only}`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('Desk · Left side')
    expect(refused.body.error).toContain('Deleting the piece')

    expect((await get(`/api/fixtures/${id}`)).body.fixture.areas).toHaveLength(1)
  })
})

describe('removing a piece of furniture', () => {
  it('refuses while books are standing on it, and says how many', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const planned = await get(`/api/fixtures/${bookcase.id}/removal`)
    expect(planned.body.removal.books).toBe(6)
    expect(planned.body.removal.areas).toBe(3)

    const refused = await remove(`/api/fixtures/${bookcase.id}`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('Its 6 books move to other furniture first.')

    expect((await nonFiction()).areas).toHaveLength(3)
  })

  it('takes an empty one away entirely', async () => {
    await buildWorld()
    const made = await post('/api/fixtures', { name: 'Crate', kind: 'crate' })
    const id = made.body.fixture.id
    await post(`/api/fixtures/${id}/areas`, {})

    const removed = await remove(`/api/fixtures/${id}`)
    expect(removed.status).toBe(200)
    expect(removed.body.removed.retires).toBe(false)

    expect((await get(`/api/fixtures/${id}`)).status).toBe(404)
    expect(await db.get('SELECT id FROM fixture WHERE id = ?', [id])).toBeUndefined()
  })

  /**
   * A piece can look empty by `books.current_area_id` alone while the carry
   * list still has outstanding work for it; the refusal must account for both.
   */
  it('refuses while the carry list is still sending books to it', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const id = (await post('/api/fixtures', { kind: 'crate' })).body.fixture.id
    const first = (await post(`/api/fixtures/${id}/areas`, {})).body.area.id
    const second = (await post(`/api/fixtures/${id}/areas`, {})).body.area.id

    // A book stands on the second plank, and taking that plank off assigns it to
    // the first. Nobody has carried it.
    const book = (await db.all<{ id: number }>('SELECT id FROM books ORDER BY id LIMIT 1'))[0]!.id
    expect((await patch(`/api/books/${book}/location`, { areaId: second })).status).toBe(200)
    expect((await remove(`/api/areas/${second}`)).status).toBe(200)

    // Then it is carried away to another piece entirely, which satisfies nothing:
    // the rules still want it on the first plank of this one.
    expect((await patch(`/api/books/${book}/location`, { areaId: bookcase.areas[0].id })).status)
      .toBe(200)
    expect((await get('/api/carry')).body.trips.map((trip: { toAreaId: number }) => trip.toAreaId))
      .toContain(first)

    const planned = await get(`/api/fixtures/${id}/removal`)
    expect(planned.body.removal).toMatchObject({ books: 1, assigned: 1 })

    const refused = await remove(`/api/fixtures/${id}`)
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('The carry list is still sending 1 book to it.')

    expect((await get(`/api/fixtures/${id}`)).body.fixture.areas).toHaveLength(1)
    expect((await get('/api/carry')).body.moving).toBe(1)
  })

  it('takes a piece its history keeps off the floor, and it still names its number',
    async () => {
      await buildWorld()
      const bookcase = await nonFiction()
      const made = await post('/api/fixtures', { kind: 'crate' })
      const id = made.body.fixture.id
      const position = made.body.fixture.position
      const plank = (await post(`/api/fixtures/${id}/areas`, {})).body.area.id

      // A book stood there and has since been carried off, so `book_placement`
      // names the plank, the plank cannot be deleted and neither can the piece.
      const book = (await db.all<{ id: number }>('SELECT id FROM books ORDER BY id LIMIT 1'))[0]!.id
      await patch(`/api/books/${book}/location`, { areaId: plank })
      await patch(`/api/books/${book}/location`, { areaId: bookcase.areas[0].id })

      const removed = await remove(`/api/fixtures/${id}`)
      expect(removed.status).toBe(200)
      expect(removed.body.removed.retires).toBe(true)

      // The row survives, and it is off the floor at `-(bookcase + 1)`.
      const row = await db.get<{ position: number }>(
        'SELECT position FROM fixture WHERE id = ?', [id],
      )
      expect(Number(row!.position)).toBe(-(position + 1))
      expect((await get(`/api/fixtures/${id}`)).status).toBe(404)
      expect((await get('/api/fixtures')).body.fixtures
        .some((one: { id: number }) => one.id === id)).toBe(false)

      const been = (await get(`/api/books/${book}/placements`)).body.been
      expect(been.map((row: { location: string }) => row.location)).toContain(`${position}A`)
    })
})

describe('giving an area an order of its own', () => {
  it('refuses until somebody has been told it stops taking overflow', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const middle = bookcase.areas[1].id

    const refused = await patch(`/api/areas/${middle}`, { sortStrategy: 'title' })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('nothing overflows into it')
    expect(refused.body.effect.selfContained).toBe(true)
    expect(refused.body.effect.affected).toEqual(['4B', '4C'])

    expect(refused.body.error).not.toMatch(/\bruns?\b/i)

    expect((await nonFiction()).areas[1].sortStrategy).toBe('inherit')

    const agreed = await patch(`/api/areas/${middle}`, {
      sortStrategy: 'title', acknowledge: true,
    })
    expect(agreed.status).toBe(200)
    expect(agreed.body.area.selfContained).toBe(true)
    expect(agreed.body.area.ordering).toBe('title')
  })

  it('lets a piece decide for its areas, which inherit it without cutting a run',
    async () => {
      await buildWorld()
      const bookcase = await nonFiction()

      const set = await patch(`/api/fixtures/${bookcase.id}`, { sortStrategy: 'published' })
      expect(set.status).toBe(200)
      expect(set.body.fixture.areas.every((one: { ordering: string }) =>
        one.ordering === 'published')).toBe(true)
      expect(set.body.fixture.areas.every((one: { selfContained: boolean }) =>
        !one.selfContained)).toBe(true)
    })
})

/**
 * A label is worked out at read time from several things a person can change,
 * so what matters is that this stays right after a rename that would break a
 * match on the label alone.
 */
describe('what is standing in an area', () => {
  it('lists its books in the order they stand, by identity', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const { status, body } = await get(`/api/areas/${bookcase.areas[1].id}/books`)
    expect(status).toBe(200)
    expect(body.area)
      .toEqual({ id: bookcase.areas[1].id, label: '4B', books: 2, gone: false })
    expect(body.books.map((one: { title: string }) => one.title))
      .toEqual(['Title 002', 'Title 003'])
    // The anchor a boundary is cut at, which is the whole reason this is asked.
    expect(body.books[0].sortKey.length).toBeGreaterThan(0)
  })

  /**
   * Each of these fields is one of the ordering function's four keys, so
   * dropping one would silently order by an empty string rather than fail.
   * Tags travel twice, as slugs and as labels: a slug is an identity that must
   * never reach a screen on its own.
   */
  it('carries what every ordering reads, with tags said both ways', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const { body } = await get(`/api/areas/${bookcase.areas[1].id}/books`)
    const first = body.books[0]

    expect(first.titleFiling.length).toBeGreaterThan(0)
    expect(typeof first.published).toBe('string')
    expect(first.tagSlugs.length).toBeGreaterThan(0)
    expect(first.tags).toHaveLength(first.tagSlugs.length)
    expect(first.tags.some((one: string) => one.includes('/'))).toBe(false)
  })

  /**
   * Renaming the bookcase relabels every plank on it (`4B` becomes
   * `Hall shelf · B`); a screen matching by label alone would find no group to cut.
   */
  it('is unmoved by a rename that would have broken a match on labels', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const middle = bookcase.areas[1].id

    const renamed = await patch(`/api/fixtures/${bookcase.id}`, { name: 'Hall shelf' })
    expect(renamed.status).toBe(200)
    expect(renamed.body.becomes).toContainEqual({ from: '4B', to: 'Hall shelf · B' })

    const { status, body } = await get(`/api/areas/${middle}/books`)
    expect(status).toBe(200)
    expect(body.area.label).toBe('Hall shelf · B')
    expect(body.books.map((one: { title: string }) => one.title))
      .toEqual(['Title 002', 'Title 003'])
  })

  /**
   * A book no rule claims is a real, reachable state: no source stated a
   * genre, so no tag was written and nothing matches it. It stands where
   * somebody put it and no plan will move it.
   */
  it('says which of its books no rule claims at all', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const area = bookcase.areas[0].id

    const orphan = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1', [area],
    )
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [orphan!.id])

    const { body } = await get(`/api/areas/${area}/books`)
    const found = body.books.find((one: { id: number }) => one.id === orphan!.id)
    expect(found.claimedBy).toBeNull()
    expect(body.books
      .filter((one: { claimedBy: string | null }) => one.claimedBy !== null)
      .every((one: { claimedBy: string }) => one.claimedBy === 'Non-fiction')).toBe(true)
  })

  it('answers a spine and a thickness for each book, so a board can be drawn', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const area = bookcase.areas[0].id

    const first = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1', [area],
    )
    await photographTaken(db, first!.id, 'edge', 'edge-1.jpg', new Date().toISOString())
    await recordCrop(db, first!.id, 'edge', 'edge-1-crop.jpg')
    await db.run("UPDATE books SET pages = '320' WHERE id = ?", [first!.id])

    const { body } = await get(`/api/areas/${area}/books`)
    const found = body.books.find((one: { id: number }) => one.id === first!.id)

    // The crop, not the raw photograph: that is what a spine has to be drawn from.
    expect(found.spine).toBe('edge-1-crop.jpg')
    expect(found.spineSlot).toBe('edge')
    expect(found.pages).toBe('320')
  })

  /** A cover standing in for a spine says so rather than passing for one. */
  it('never lets a front cover pass for a spine', async () => {
    await buildWorld()
    const bookcase = await nonFiction()
    const area = bookcase.areas[0].id

    const first = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1', [area],
    )
    await photographTaken(db, first!.id, 'front', 'front-1.jpg', new Date().toISOString())

    const { body } = await get(`/api/areas/${area}/books`)
    const found = body.books.find((one: { id: number }) => one.id === first!.id)

    expect(found.spine).toBe('front-1.jpg')
    expect(found.spineSlot).toBe('front')
  })

  /* About one book in four carries no page count, which is a fact about the
     catalogue rather than a fault: the drawing puts such a book at the median
     of the ones that do, and it can only do that if it is told nothing. */
  it('answers an empty thickness for a book the catalogue cannot measure', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const { body } = await get(`/api/areas/${bookcase.areas[0].id}/books`)
    expect(body.books.every((one: { pages: string }) => one.pages === '')).toBe(true)
  })

  it('refuses an area that is not on any face', async () => {
    await buildWorld()
    const { status, body } = await get('/api/areas/999999/books')
    expect(status).toBe(404)
    expect(body.error).toBe('No such area.')
  })
})

/**
 * How a piece is ordered is a fact about the whole face, so the books it is
 * shown against are the whole face's, not one request per plank stitched back
 * together by a screen.
 */
describe('what is standing on a piece of furniture', () => {
  it('lists every book on its face, in the order they stand', async () => {
    await buildWorld()
    const bookcase = await nonFiction()

    const { status, body } = await get(`/api/fixtures/${bookcase.id}/books`)
    expect(status).toBe(200)
    expect(body.fixture.label).toBe('4')
    expect(body.books.map((one: { title: string }) => one.title))
      .toEqual(['Title 000', 'Title 001', 'Title 002', 'Title 003', 'Title 004', 'Title 005'])
  })

  /** A piece nothing has been filed onto holds nothing, which is not an error. */
  it('answers an empty list for a piece with nothing on it', async () => {
    await buildWorld()
    const made = await post('/api/fixtures', { kind: 'crate', name: 'Hall crate' })

    const { status, body } = await get(`/api/fixtures/${made.body.fixture.id}/books`)
    expect(status).toBe(200)
    expect(body.books).toEqual([])
    expect(body.fixture.books).toBe(0)
  })

  it('refuses a piece that is not on the floor', async () => {
    await buildWorld()
    const { status, body } = await get('/api/fixtures/999999/books')
    expect(status).toBe(404)
    expect(body.error).toBe('No such piece of furniture.')
  })
})

describe('why a book is here', () => {
  /** The book at the top of the non-fiction, which every test here is about. */
  async function first(): Promise<number> {
    const bookcase = await nonFiction()
    const row = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1',
      [bookcase.areas[0].id],
    )
    return Number(row!.id)
  }

  it('names the rule that claimed it, where it stands and where the rules want it',
    async () => {
      await buildWorld()
      const id = await first()

      const { status, body } = await get(`/api/books/${id}/claim`)
      expect(status).toBe(200)
      expect(body.claim.claims).toHaveLength(1)
      expect(body.claim.claims[0].won).toBe(true)
      expect(body.claim.claims[0].rule.name).toBe('Non-fiction')
      expect(body.claim.claims[0].rule.range).toBe('nonfiction')
      expect(body.claim.standing.label).toBe('4A')
      expect(body.claim.wanted.label).toBe('4A')
      expect(body.claim.pinned).toBe(false)
      expect(body.claim.tags).toEqual(['Non-fiction'])
    })

  it('draws a tag by its label and never by its slug', async () => {
    await buildWorld()
    const { body } = await get(`/api/books/${await first()}/claim`)
    expect(JSON.stringify(body)).not.toMatch(/genre\//)
  })

  /** A book can carry two genre tags at once; `priority` is what settles which rule wins. */
  it('lists every rule that wanted it, the winner first, with the loser said', async () => {
    await buildWorld()
    const id = await first()

    const applied = await post(`/api/books/${id}/tags`, { slug: 'genre/fiction', label: 'Fiction' })
    expect(applied.status).toBe(201)

    const { body } = await get(`/api/books/${id}/claim`)
    expect(body.claim.claims.map((one: { rule: { name: string }; won: boolean }) =>
      [one.rule.name, one.won])).toEqual([['Fiction', true], ['Non-fiction', false]])
    expect(body.claim.claims[1].why).toContain('tried first')
  })

  /**
   * Guessing a place for an unclaimed book would file it somewhere nobody
   * asked for and report nothing wrong; empty and honest is the correct answer here.
   */
  it('survives a book no rule claims at all', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])

    const { status, body } = await get(`/api/books/${id}/claim`)
    expect(status).toBe(200)
    expect(body.claim.claims).toEqual([])
    expect(body.claim.wanted).toBeNull()
    expect(body.claim.tags).toEqual([])
    expect(body.claim.standing.label).toBe('4A')
  })

  /** `pinned` beats every rule, forever, and the rule it beats is still named. */
  it('says a book is pinned and still names the rule the pin overrules', async () => {
    await buildWorld()
    const id = await first()
    const bookcase = await nonFiction()

    await new DrizzlePlacementLedger(db).record({
      bookId: id,
      kind: 'pinned',
      areaId: bookcase.areas[2].id,
      sortKey: '',
      actor: 'person',
      reason: 'it lives here',
      createdAt: new Date().toISOString(),
    })

    const { body } = await get(`/api/books/${id}/claim`)
    expect(body.claim.pinned).toBe(true)
    expect(body.claim.standing.label).toBe('4C')
    expect(body.claim.wanted.label).toBe('4A')
    expect(body.claim.claims[0].rule.name).toBe('Non-fiction')
  })

  it('answers nothing for a book this catalogue does not have', async () => {
    await buildWorld()
    const { status, body } = await get('/api/books/999999/claim')
    expect(status).toBe(404)
    expect(body.error).toBe('No such book.')
  })
})

/**
 * Two distinct reasons land a book here: no tag at all (`untagged`), or a tag
 * no rule asks for (`unmatched`). Both are unclaimed and both stand where they
 * were left.
 */
describe('the books no rule claims', () => {
  /** The book at the top of the non-fiction, claimed until a test says otherwise. */
  async function first(): Promise<number> {
    const bookcase = await nonFiction()
    const row = await db.get<{ id: number }>(
      'SELECT id FROM books WHERE current_area_id = ? ORDER BY sort_key LIMIT 1',
      [bookcase.areas[0].id],
    )
    return Number(row!.id)
  }

  it('answers an empty list for a room where every book is claimed', async () => {
    await buildWorld()
    const { status, body } = await get('/api/placement/unclaimed')
    expect(status).toBe(200)
    expect(body.books).toEqual([])
    expect(body.total).toBe(0)
  })

  it('names a book carrying no tag at all, and says that is why', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])

    const { body } = await get('/api/placement/unclaimed')
    expect(body.total).toBe(1)
    expect(body.books).toHaveLength(1)
    expect(body.books[0].id).toBe(id)
    expect(body.books[0].why).toBe('untagged')
    expect(body.books[0].tags).toEqual([])
    expect(body.books[0].standing.label).toBe('4A')
  })

  it('names a book carrying a tag no rule asks for, and says that is why', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
    const applied = await post(`/api/books/${id}/tags`, { slug: 'Poetry', label: 'Poetry' })
    expect(applied.status).toBe(201)

    const { body } = await get('/api/placement/unclaimed')
    expect(body.total).toBe(1)
    expect(body.books[0].id).toBe(id)
    expect(body.books[0].why).toBe('unmatched')
    expect(body.books[0].tags).toEqual(['Poetry'])
  })

  /** A tag is read by its label, so no slug may reach anybody. */
  it('carries no slug out to anybody', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
    await post(`/api/books/${id}/tags`, { slug: 'genre/poetry', label: 'Poetry' })

    const { body } = await get('/api/placement/unclaimed')
    expect(body.total).toBe(1)
    expect(JSON.stringify(body)).not.toMatch(/genre\//)
  })

  /**
   * Deliberately the opposite of what `GET /api/books/:id/claim` does with a
   * disabled rule: a rule that is off is a rule that files nothing, so its
   * books count as unmatched here.
   */
  it('holds every book of a rule somebody switched off', async () => {
    const ids = await buildWorld()
    await db.run("UPDATE placement_rule SET enabled = false WHERE name = 'Non-fiction'")

    const { body } = await get('/api/placement/unclaimed')
    // Every book but the one fiction title, which its own rule still claims.
    expect(body.total).toBe(ids.length - 1)
    expect(body.books.every((one: { why: string }) => one.why === 'unmatched')).toBe(true)
  })

  /** No rule places a withdrawn book, by design; counting it here would make this list untrustworthy. */
  it('leaves out a book that has left the collection', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
    await db.run("UPDATE books SET state = 'withdrawn' WHERE id = ?", [id])

    const { body } = await get('/api/placement/unclaimed')
    expect(body.books).toEqual([])
    expect(body.total).toBe(0)
  })

  /** A book still waiting in the queue is not here either: the queue is its screen. */
  it('leaves out a book nobody has catalogued yet', async () => {
    await buildWorld()
    const id = await first()
    await db.run('DELETE FROM book_tag WHERE book_id = ?', [id])
    await db.run("UPDATE books SET state = 'identified' WHERE id = ?", [id])

    const { body } = await get('/api/placement/unclaimed')
    expect(body.total).toBe(0)
  })
})
