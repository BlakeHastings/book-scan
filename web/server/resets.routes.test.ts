/**
 * The three resets in Settings, driven over real HTTP against a catalogue with
 * books, a pin, a checked out book, a withdrawn one, photographs, tags and
 * credits in it. Built the way `furniture.routes.test.ts` builds its world.
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
import { photographTaken } from './photographs'
import { UNPLACED_BY_RESET } from './placement-ledger'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DbUnitOfWork } from '../infrastructure/db/unit-of-work'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { standingOf } from '../domain/placement/ledger'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import { RESET_PHRASES } from '../shared/resets'

let db: Db
let store: Store
let shelves: Shelves
let app: BookScanApp
let server: Server
let baseUrl: string
let cookie: string
let scratch: string
let coverDir: string

async function shelve(draft: DraftBook): Promise<number> {
  const authors = new DrizzleAuthorRepository(db)
  const tags = new DrizzleTagRepository(db)
  const { id, placement } = await store.addBook(draft)
  await settleGenre(new RestateTagsHandler(tags, new DbUnitOfWork(db)), tags, id, draft)
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

/** The ids the world was built with, kept beside the catalogue snapshot. */
interface World { pinned: number; out: number; withdrawn: number }
let world: World

/**
 * Eight non-fiction books on three areas and one fiction book, every one
 * photographed, then one pinned, one checked out and one withdrawn.
 */
async function buildWorld(): Promise<World> {
  const ids: number[] = []
  for (let at = 0; at < 8; at += 1) ids.push(await shelve(draft(at)))
  ids.push(await shelve(draft(100, FICTION_SLUG)))

  const run = await shelves.layout('nonfiction')
  const separators = new DrizzleSeparatorRepository(db)
  for (const [position, first] of [3, 6].entries()) {
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
  for (const id of ids) {
    await photographTaken(db, id, 'front', `front-${id}.jpg`, new Date().toISOString())
  }

  const ledger = new DrizzlePlacementLedger(db)
  const [pinned, out, withdrawn] = [ids[1]!, ids[4]!, ids[7]!]
  const pinnedAt = await db.get<{ current_area_id: number; sort_key: string }>(
    'SELECT current_area_id, sort_key FROM books WHERE id = ?', [pinned],
  )
  await ledger.record({
    bookId: pinned,
    kind: 'pinned',
    areaId: pinnedAt!.current_area_id,
    sortKey: pinnedAt!.sort_key,
    actor: 'person',
    reason: 'it lives here',
    createdAt: new Date().toISOString(),
  })

  await store.setCheckedOut(out, true)

  await db.run(`UPDATE books SET state = 'withdrawn' WHERE id = ?`, [withdrawn])
  await ledger.record({
    bookId: withdrawn,
    kind: 'withdrawn',
    areaId: null,
    sortKey: '',
    actor: 'person',
    reason: 'given away',
    createdAt: new Date().toISOString(),
  })

  return { pinned, out, withdrawn }
}

interface Answer {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

async function call(method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
  })
  return { status: response.status, body: await response.json() }
}

const get = (path: string) => call('GET', path)
const post = (path: string, body?: unknown) => call('POST', path, body ?? {})

/**
 * Everything the issue says no reset may touch, read back as rows: the books
 * themselves with their state and sort key, the photographs, the tags, the
 * credits and the aliases, and the users.
 */
async function untouched(): Promise<unknown> {
  return {
    books: await db.all(
      'SELECT id, title, state, sort_key, shelf_range FROM books ORDER BY id',
    ),
    captures: await db.all('SELECT * FROM capture ORDER BY id'),
    tags: await db.all('SELECT * FROM book_tag ORDER BY book_id, tag_id, source'),
    tagNames: await db.all('SELECT * FROM tag ORDER BY id'),
    credits: await db.all('SELECT * FROM book_author ORDER BY book_id, position'),
    authors: await db.all('SELECT * FROM author ORDER BY id'),
    aliases: await db.all('SELECT * FROM author_alias ORDER BY id'),
    users: await db.all('SELECT id, enabled FROM "user" ORDER BY id'),
  }
}

async function ledgerRows(): Promise<{ id: number; book_id: number; kind: string }[]> {
  return db.all('SELECT id, book_id, kind FROM book_placement ORDER BY id')
}

async function placedBooks(): Promise<number> {
  const row = await db.get<{ n: number }>(
    'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM books WHERE current_area_id IS NOT NULL',
  )
  return row?.n ?? 0
}

async function count(table: string): Promise<number> {
  const row = await db.get<{ n: number }>(`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM ${table}`)
  return row?.n ?? 0
}

/** What `/api/health` says about placement, which every reset must leave at nought. */
async function healthy(): Promise<void> {
  const health = await get('/api/health')
  expect(health.status).toBe(200)
  expect(health.body.placement.projection.disagreeing).toBe(0)
  expect(health.body.placement.stranded.books).toBe(0)
  expect(health.body.ok).toBe(true)
}

beforeAll(async () => {
  scratch = scratchRoot('resets')
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
  world = await buildWorld()
  await keepThisCatalogue('a_room_to_reset')
})

beforeEach(async () => {
  db = await openTestDatabase('a_room_to_reset')
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)

  coverDir = mkdtempSync(join(scratch, 'resets-test-'))
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
  removeScratchRoot(scratch)
})

describe('the world these tests start from', () => {
  it('has books on planks, one pinned, one out and one withdrawn', async () => {
    const pinned = await new DrizzlePlacementLedger(db).forBooks([world.pinned])
    expect(standingOf(pinned).pinned).toBe(true)
    expect(await placedBooks()).toBeGreaterThan(5)
    expect(await count('capture')).toBe(9)
    expect(await count('book_tag')).toBeGreaterThan(0)
    expect(await count('book_author')).toBe(9)
    expect(await count('fixture')).toBeGreaterThan(0)
    expect(await count('placement_rule')).toBeGreaterThan(0)
    await healthy()
  })
})

describe('a reset nobody confirmed', () => {
  it('answers 404 for a reset that does not exist', async () => {
    expect((await get('/api/resets/everything')).status).toBe(404)
    expect((await post('/api/resets/everything', { confirm: 'everything' })).status).toBe(404)
  })

  it.each(['unplace', 'history', 'furniture'] as const)(
    'refuses %s with no phrase, a wrong one, or another reset\'s, and changes nothing',
    async (name) => {
      const before = { ledger: await ledgerRows(), placed: await placedBooks(),
        fixtures: await count('fixture'), rules: await count('placement_rule') }
      const other = name === 'unplace' ? RESET_PHRASES.history : RESET_PHRASES.unplace

      for (const body of [{}, { confirm: '' }, { confirm: 'yes' }, { confirm: other }]) {
        const refused = await post(`/api/resets/${name}`, body)
        expect(refused.status).toBe(400)
        expect(refused.body.error).toContain(RESET_PHRASES[name])
      }

      expect({ ledger: await ledgerRows(), placed: await placedBooks(),
        fixtures: await count('fixture'), rules: await count('placement_rule') }).toEqual(before)
    },
  )

  it('refuses a request with no session at all', async () => {
    const response = await fetch(`${baseUrl}/api/resets/unplace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: RESET_PHRASES.unplace }),
    })
    expect(response.status).toBe(401)
    expect(await placedBooks()).toBeGreaterThan(0)
  })
})

describe('unplacing every book', () => {
  it('says how many books are on planks and how many of those are pinned', async () => {
    const plan = await get('/api/resets/unplace')
    expect(plan.status).toBe(200)
    expect(plan.body.phrase).toBe(RESET_PHRASES.unplace)

    const shelvedOnPlanks = await db.get<{ n: number }>(
      `SELECT CAST(COUNT(*) AS INTEGER) AS n FROM books
        WHERE state = 'shelved' AND current_area_id IS NOT NULL`,
    )
    expect(plan.body.counts.books).toBe(shelvedOnPlanks!.n)
    expect(plan.body.counts.pinned).toBe(1)
    expect(plan.body.counts.rows).toBeGreaterThanOrEqual(plan.body.counts.books)

    // Asking wrote nothing.
    expect((await get('/api/resets/unplace')).body).toEqual(plan.body)
  })

  it('takes every shelved book off its plank, pin and all, and keeps the history', async () => {
    const before = await ledgerRows()
    const kept = await untouched()
    const shelved = await db.all<{ id: number }>(
      `SELECT id FROM books WHERE state = 'shelved' ORDER BY id`,
    )
    const outRows = (await new DrizzlePlacementLedger(db).forBooks([world.out, world.withdrawn]))

    const done = await post('/api/resets/unplace', { confirm: '  Unplace  every book ' })
    expect(done.status).toBe(200)
    expect(done.body.done.pinned).toBe(1)
    expect(done.body.done.rows).toBe(shelved.length)

    // Nothing deleted: every row from before is still there, in order.
    const after = await ledgerRows()
    expect(after.slice(0, before.length)).toEqual(before)

    // One `checked_in` per shelved book, by a person, saying why.
    const written = await db.all<{ book_id: number; kind: string; actor: string; reason: string }>(
      'SELECT book_id, kind, actor, reason FROM book_placement WHERE id > ? ORDER BY book_id',
      [before[before.length - 1]!.id],
    )
    expect(written).toEqual(shelved.map((one) => ({
      book_id: one.id, kind: 'checked_in', actor: 'person', reason: UNPLACED_BY_RESET,
    })))

    // Nobody is anywhere, and the pin is gone.
    const ledger = new DrizzlePlacementLedger(db)
    for (const one of shelved) {
      const standing = standingOf(await ledger.forBooks([one.id]))
      expect(standing).toMatchObject({ area: null, assigned: null, pinned: false })
    }
    expect(await placedBooks()).toBe(0)

    // The checked out and withdrawn books have exactly the rows they had.
    expect(await ledger.forBooks([world.out, world.withdrawn])).toEqual(outRows)

    expect(await untouched()).toEqual(kept)
    await healthy()

    // The second press has nothing left to undo.
    const again = await post('/api/resets/unplace', { confirm: RESET_PHRASES.unplace })
    expect(again.body.done).toEqual({ books: 0, pinned: 0, rows: 0 })
    expect(await ledgerRows()).toHaveLength(after.length)
  })

  it('leaves the furniture standing', async () => {
    const fixtures = await count('fixture')
    const areas = await count('area')
    const rules = await count('placement_rule')

    await post('/api/resets/unplace', { confirm: RESET_PHRASES.unplace })

    expect([await count('fixture'), await count('area'), await count('placement_rule')])
      .toEqual([fixtures, areas, rules])
  })
})

describe('erasing the placement history', () => {
  it('says how many rows and books before anything goes', async () => {
    const plan = await get('/api/resets/history')
    expect(plan.body.phrase).toBe(RESET_PHRASES.history)
    expect(plan.body.counts.rows).toBe(await count('book_placement'))
    expect(plan.body.counts.onShelves).toBe(await placedBooks())
    expect(plan.body.counts.books).toBeGreaterThan(0)
  })

  it('deletes every row and every projection, and nothing else', async () => {
    const rows = await count('book_placement')
    const kept = await untouched()

    const done = await post('/api/resets/history', { confirm: RESET_PHRASES.history })
    expect(done.status).toBe(200)
    expect(done.body.done.rows).toBe(rows)

    expect(await count('book_placement')).toBe(0)
    expect(await placedBooks()).toBe(0)
    expect(await count('outstanding_move')).toBe(0)
    // The furniture is not part of this one.
    expect(await count('fixture')).toBeGreaterThan(0)
    // States are untouched, so the checked out book is still out.
    expect(await untouched()).toEqual(kept)
    await healthy()

    const book = await get(`/api/books/${world.out}`)
    expect(book.status).toBe(200)
    expect(book.body.book.location).toBe('')
  })
})

describe('removing all the furniture', () => {
  it('refuses while the history still names the furniture, and says so before', async () => {
    const plan = await get('/api/resets/furniture')
    expect(plan.body.phrase).toBe(RESET_PHRASES.furniture)
    expect(plan.body.counts.history).toBeGreaterThan(0)
    expect(plan.body.counts.fixtures).toBeGreaterThan(0)
    expect(plan.body.counts.areas).toBeGreaterThan(0)
    expect(plan.body.counts.rules).toBeGreaterThan(0)

    const refused = await post('/api/resets/furniture', { confirm: RESET_PHRASES.furniture })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toContain('Erase the placement history first')
    expect(await count('fixture')).toBe(plan.body.counts.fixtures)
  })

  it('takes every piece, area and rule once the history is gone', async () => {
    await post('/api/resets/history', { confirm: RESET_PHRASES.history })
    const kept = await untouched()
    const plan = await get('/api/resets/furniture')
    expect(plan.body.counts.history).toBe(0)

    const done = await post('/api/resets/furniture', { confirm: RESET_PHRASES.furniture })
    expect(done.status).toBe(200)
    expect(done.body.done).toEqual(plan.body.counts)

    expect(await count('fixture')).toBe(0)
    expect(await count('area')).toBe(0)
    expect(await count('placement_rule')).toBe(0)
    expect(await count('rule_condition')).toBe(0)
    // The house's default ordering is not furniture.
    expect(await count('collection')).toBe(1)
    expect(await untouched()).toEqual(kept)
    await healthy()

    const room = await get('/api/fixtures')
    expect(room.status).toBe(200)
    expect(room.body.fixtures).toEqual([])

    // And the room can be built again from empty.
    const added = await post('/api/fixtures', { kind: 'bookshelf' })
    expect(added.status).toBe(201)
  })

  it('runs all three in order from a full room to an empty one', async () => {
    const kept = await untouched()
    for (const name of ['unplace', 'history', 'furniture'] as const) {
      const done = await post(`/api/resets/${name}`, { confirm: RESET_PHRASES[name] })
      expect(done.status).toBe(200)
      await healthy()
    }
    expect(await untouched()).toEqual(kept)
  })
})
