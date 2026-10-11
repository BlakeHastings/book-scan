/**
 * The books still to be put on a plank, which the queue lists beside the
 * captures (#601): `GET /api/books?placed=no` and the `unplaced` count, over
 * real HTTP against real Postgres.
 *
 * The world is the one the reset in Settings leaves behind, part worked
 * through: two books put back on planks since, one still waiting from the
 * reset, one saved and never placed at all, one checked out and one withdrawn.
 * Only the third and fourth are waiting to be placed.
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
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { NON_FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import type { ShelfRange } from '../shared/shelving'

let db: Db
let store: Store
let shelves: Shelves
let app: BookScanApp
let server: Server
let baseUrl: string
let cookie: string
let scratch: string
let coverDir: string

/** Saved the way a save saves it: the row, its genre tag and its credits. */
async function save(draft: DraftBook): Promise<{ id: number; range: ShelfRange | null }> {
  const authors = new DrizzleAuthorRepository(db)
  const tags = new DrizzleTagRepository(db)
  const { id, placement } = await store.addBook(draft)
  await settleGenre(new RestateTagsHandler(tags, new DbBookTransactions(db)), tags, id, draft)
  await recordCredits(
    new CreditBookHandler(authors), authors, new FileAliasHandler(authors), id, draft,
  )
  return { id, range: placement?.range ?? null }
}

/** Saved and then put on the plank the shelves say it belongs on. */
async function shelve(draft: DraftBook): Promise<number> {
  const { id, range } = await save(draft)
  const landed = range && await shelves.labelFor(range, id)
  if (landed) await store.setLocation(id, landed)
  return id
}

const draft = (author: string, title: string): DraftBook => ({
  title,
  authors: [author],
  genre: NON_FICTION_SLUG,
})

interface World {
  placed: number[]
  /** Taken off its plank by the reset and not carried to one since. */
  returned: number
  /** Saved and never put anywhere. */
  never: number
  out: number
  withdrawn: number
}
let world: World

async function buildWorld(): Promise<World> {
  const placed = [
    await shelve(draft('Adams', 'Placed first')),
    await shelve(draft('Brown', 'Placed second')),
  ]
  const returned = await shelve(draft('Carter', 'Came back'))
  const out = await shelve(draft('Dunn', 'Still out'))
  const withdrawn = await shelve(draft('Evans', 'Given away'))
  const never = (await save(draft('Baker', 'Never placed'))).id
  await store.setCheckedOut(out, true)

  // The reset, through the writer Settings presses, then two of the books put
  // back where they belong.
  await store.unplaceEveryBook()
  for (const id of placed) await store.setLocation(id, (await shelves.labelFor('nonfiction', id))!)

  await db.run(
    `UPDATE books SET state = 'withdrawn', current_area_id = NULL WHERE id = ?`, [withdrawn],
  )
  await new DrizzlePlacementLedger(db).record({
    bookId: withdrawn,
    kind: 'withdrawn',
    areaId: null,
    sortKey: '',
    actor: 'person',
    reason: 'given away',
    createdAt: new Date().toISOString(),
  })

  return { placed, returned, never, out, withdrawn }
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

const titles = (answer: Answer): string[] =>
  (answer.body.books as { title: string }[]).map((book) => book.title)

beforeAll(async () => {
  scratch = scratchRoot('unplaced')
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
  world = await buildWorld()
  await keepThisCatalogue('books_to_place')
})

beforeEach(async () => {
  db = await openTestDatabase('books_to_place')
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)

  coverDir = mkdtempSync(join(scratch, 'unplaced-test-'))
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
  it('has two books on planks and the other four on none', async () => {
    const rows = await db.all<{ id: number; state: string; current_area_id: number | null }>(
      'SELECT id, state, current_area_id FROM books ORDER BY id',
    )
    const at = (id: number) => rows.find((row) => row.id === id)!
    for (const id of world.placed) expect(at(id).current_area_id).not.toBeNull()
    expect(at(world.returned)).toMatchObject({ state: 'shelved', current_area_id: null })
    expect(at(world.never)).toMatchObject({ state: 'shelved', current_area_id: null })
    expect(at(world.out)).toMatchObject({ state: 'checked_out', current_area_id: null })
    expect(at(world.withdrawn)).toMatchObject({ state: 'withdrawn', current_area_id: null })
  })
})

describe('GET /api/books?placed=no', () => {
  it('lists the shelved books on no plank, in shelf order, and nothing else', async () => {
    const answer = await get('/api/books?range=all&placed=no')
    expect(answer.status).toBe(200)
    // Baker files before Carter, so the book never placed comes first even
    // though it was saved last.
    expect(titles(answer)).toEqual(['Never placed', 'Came back'])
    expect(answer.body.total).toBe(2)
    expect(answer.body.books.every((book: { location: string }) => book.location === ''))
      .toBe(true)
  })

  it('leaves out a book that is checked out, withdrawn, or on a plank', async () => {
    const answer = await get('/api/books?range=all&placed=no')
    const ids = (answer.body.books as { id: number }[]).map((book) => book.id)
    expect(ids).not.toContain(world.out)
    expect(ids).not.toContain(world.withdrawn)
    for (const id of world.placed) expect(ids).not.toContain(id)
  })

  it('answers a page at a time, with the total of the whole question', async () => {
    const second = await get('/api/books?range=all&placed=no&limit=1&offset=1')
    expect(titles(second)).toEqual(['Came back'])
    expect(second.body.total).toBe(2)
  })

  it('answers the books on planks for placed=yes', async () => {
    const answer = await get('/api/books?range=all&placed=yes')
    expect(titles(answer)).toEqual(['Placed first', 'Placed second'])
  })

  it('refuses a placed it cannot read, rather than answering everything', async () => {
    const refused = await get('/api/books?range=all&placed=maybe')
    expect(refused.status).toBe(400)
    expect(refused.body.error).toContain('maybe')
  })

  it('counts the same books in the catalogue counts', async () => {
    const answer = await get('/api/books?range=all&placed=no')
    expect(answer.body.counts.unplaced).toBe(2)
    const health = await get('/api/health')
    expect(health.body.counts.unplaced).toBe(2)
  })

  it('is behind the gate like every other route', async () => {
    const response = await fetch(`${baseUrl}/api/books?range=all&placed=no`)
    expect(response.status).toBe(401)
  })
})

describe('placing one of them', () => {
  it('takes it off the list and writes a placed row through the location route', async () => {
    const plank = await db.get<{ current_area_id: number }>(
      'SELECT current_area_id FROM books WHERE id = ?', [world.placed[0]],
    )
    const before = await db.all<{ id: number }>(
      'SELECT id FROM book_placement WHERE book_id = ? ORDER BY id', [world.returned],
    )

    const placed = await call(
      'PATCH', `/api/books/${world.returned}/location`, { areaId: plank!.current_area_id },
    )
    expect(placed.status).toBe(200)

    const after = await get('/api/books?range=all&placed=no')
    expect(titles(after)).toEqual(['Never placed'])
    expect(after.body.counts.unplaced).toBe(1)

    const rows = await db.all<{ kind: string; area_id: number; actor: string }>(
      'SELECT kind, area_id, actor FROM book_placement WHERE book_id = ? ORDER BY id',
      [world.returned],
    )
    expect(rows).toHaveLength(before.length + 1)
    expect(rows.at(-1)).toEqual({
      kind: 'placed', area_id: plank!.current_area_id, actor: 'person',
    })

    const health = await get('/api/health')
    expect(health.body.placement.projection.disagreeing).toBe(0)
    expect(health.body.ok).toBe(true)
  })
})

describe('where the rules want one of them', () => {
  it('can be a plank the run would not put it on, and placing it there writes a placed row', async () => {
    const areas = await db.all<{ id: number }>(
      'SELECT id FROM area WHERE position >= 0 ORDER BY id',
    )
    const elsewhere = areas[0]!.id
    // Written straight into the tables, like `separator-repository.test.ts`: a
    // plank's rule for one subject, which beats the bookcase's rule for its genre.
    const rule = await db.get<{ id: number }>(
      `INSERT INTO placement_rule (area_id, fixture_id, priority, name, enabled)
       VALUES (?, NULL, 1, 'history', TRUE) RETURNING id`,
      [elsewhere],
    )
    await db.run(
      `INSERT INTO rule_condition (rule_id, field, operator, value)
       VALUES (?, 'tag', 'is', 'subject/history')`,
      [rule!.id],
    )
    const tagged = await call('POST', `/api/books/${world.returned}/tags`, { slug: 'subject/history' })
    expect(tagged.status).toBe(201)

    const claim = await get(`/api/books/${world.returned}/claim`)
    expect(claim.body.claim.standing).toBeNull()
    const wanted = claim.body.claim.wanted as { areaId: number; label: string }
    expect(wanted.areaId).toBe(elsewhere)

    // The run's answer is a different plank, which is why the shelving step
    // reads the claim as well as the preview.
    const preview = await call('POST', '/api/placement/preview', {
      title: 'Came back', authors: ['Carter'], genre: NON_FICTION_SLUG, excludeId: world.returned,
    })
    expect(preview.body.derivedAreaId).not.toBe(elsewhere)

    const placed = await call(
      'PATCH', `/api/books/${world.returned}/location`, { areaId: wanted.areaId },
    )
    expect(placed.status).toBe(200)

    expect((await get(`/api/books/${world.returned}/claim`)).body.claim.standing).toEqual(wanted)
    const rows = await db.all<{ kind: string; area_id: number; actor: string }>(
      `SELECT kind, area_id, actor FROM book_placement
        WHERE book_id = ? ORDER BY id DESC LIMIT 1`,
      [world.returned],
    )
    expect(rows).toEqual([{ kind: 'placed', area_id: elsewhere, actor: 'person' }])
    expect(titles(await get('/api/books?range=all&placed=no'))).toEqual(['Never placed'])
  })
})
