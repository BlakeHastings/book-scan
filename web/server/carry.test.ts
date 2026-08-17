/**
 * The journey, driven end to end against a real catalogue.
 *
 * Fifty non-fiction books on bookcase 4, cut 8, 20 and 22 across its three
 * areas, the owner's actual shape. Move the run to bookcase 3, then walk the
 * list this issue is about: read the trips, take an armful off `4A`, say each
 * book is down, and watch the trip empty and the list shrink.
 *
 * **Nothing here writes a placement except `Store.setLocation`**, which is what
 * `PATCH /api/books/:id/location` calls and is a person saying they carried a
 * book. If the list ever needed a write of its own to work, this file is where
 * that would show up.
 *
 * The world is built the way `relocate-run.test.ts` builds it, and deliberately
 * so: the two files answer the two halves of one sentence, and a second world
 * would let them drift about what the room looks like.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, keepThisCatalogue, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { Store, type DraftBook } from './store'
import { Shelves } from './shelves'
import { recordCredits, settleGenre } from './book-save'
import { applyRunMove, planRunMove } from './relocate-run'
import { outstandingWork, tripAtArea } from './carry'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { NON_FICTION_SLUG, FICTION_SLUG } from '../domain/tagging/catalogue-claims'

let db: Db
let store: Store
let shelves: Shelves

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

async function buildTheWorld(): Promise<number[]> {
  const ids: number[] = []
  for (let at = 0; at < 50; at += 1) ids.push(await shelve(draft(at)))
  for (let at = 0; at < 3; at += 1) ids.push(await shelve(draft(100 + at, FICTION_SLUG)))

  const run = await shelves.layout('nonfiction')
  const separators = new DrizzleSeparatorRepository(db)
  for (const [position, first] of [8, 28].entries()) {
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
 * The ids `buildTheWorld` handed back, which every test reads and none rebuilds.
 */
let world: number[] = []

/**
 * One database for the file, and one world built in it, put back between tests
 * (#343).
 *
 * **Two things were wrong here and they compounded.** The file closed the
 * database in an `afterEach`, and closing it is what makes the next
 * `openTestDatabase()` build another one rather than reset this one, so twelve
 * tests meant twelve `CREATE DATABASE`, twelve schemas applied and twelve `DROP
 * DATABASE`; and a drop forces an immediate checkpoint across the whole server,
 * which stalls every other worker's writes as well as this one's. Then each of
 * those twelve tests built the world again, at about 250 sequential round trips
 * to the server it had just finished stalling. This file and
 * `relocate-run.test.ts` were the only two doing either, and they are the two
 * #343 was filed about, which is not a coincidence: they were losing to the
 * contention they were generating.
 *
 * Measured on this machine, running beside another full suite: the first test
 * here took 78 seconds against a twenty second budget, and 25 of the 12 tests'
 * seconds were the database being made and dropped. Built once and put back, a
 * test starts in one round trip.
 *
 * Every test still gets the world untouched, because `keepThisCatalogue` copies
 * every table and `openTestDatabase` puts every table back. What it does not get
 * is the *building* of the world twelve times, and nothing here was proving
 * anything by that: the room is the setup, and what these tests are about is the
 * list of books to carry out of it.
 */
beforeAll(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)

  world = await buildTheWorld()
  await keepThisCatalogue('the_owners_room')
})

beforeEach(async () => {
  await openTestDatabase('the_owners_room')
})

afterAll(async () => {
  await closeTestDatabase()
})

describe('the list of books to carry', () => {
  it('is empty until somebody changes their mind about where books belong', async () => {

    const work = await outstandingWork(db)

    expect(work.moving).toBe(0)
    expect(work.trips).toEqual([])
    expect(work.changed).toBeNull()
  })

  it('is the trips the applied plan implies, biggest piece first, areas in order',
    async () => {
      await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

      const work = await outstandingWork(db)

      expect(work.moving).toBe(50)
      expect(work.trips.map((trip) => [trip.from, trip.to, trip.books.length]))
        .toEqual([['4A', '3A', 8], ['4B', '3B', 20], ['4C', '3C', 22]])
      // Every book, named, so a number that looks wrong can be opened.
      expect(work.trips[0]!.books[0]!.title).toBe('Title 000')
    })

  /*
   * The whole point of the flow, and the thing that would be quietly broken by
   * a second list: carrying a book takes it off this one, and the only write
   * involved is the person saying where they put it.
   */
  it('loses a book the moment somebody says they carried it', async () => {
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const trip = (await outstandingWork(db)).trips[0]!
    await store.setLocation(trip.books[0]!.id, trip.to)

    const after = await outstandingWork(db)
    expect(after.moving).toBe(49)
    expect(after.trips[0]!.books.map((book) => book.id)).not.toContain(trip.books[0]!.id)
  })

  it('says how much of a trip is already done, so resuming is not starting', async () => {
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const trip = (await outstandingWork(db)).trips[0]!
    for (const book of trip.books.slice(0, 3)) await store.setLocation(book.id, trip.to)

    const after = (await outstandingWork(db)).trips[0]!
    expect(after.books).toHaveLength(5)
    expect(after.carried).toBe(3)
  })

  it('empties as the last book of a trip goes down', async () => {
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const trip = (await outstandingWork(db)).trips[0]!
    for (const book of trip.books) await store.setLocation(book.id, trip.to)

    const after = await outstandingWork(db)
    expect(after.moving).toBe(42)
    expect(after.trips.map((one) => one.from)).toEqual(['4B', '4C'])
    expect(after.carried.books).toBe(8)
  })

  it('counts a pinned book as left alone rather than dropping it silently', async () => {
    const ids = world
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const area = (await db.get<{ current_area_id: number }>(
      'SELECT current_area_id FROM books WHERE id = ?', [ids[0]!],
    ))!.current_area_id
    await new DrizzlePlacementLedger(db).record({
      bookId: ids[0]!,
      kind: 'pinned',
      areaId: area,
      sortKey: '',
      actor: 'person',
      reason: 'it lives here',
      createdAt: new Date().toISOString(),
    })

    const work = await outstandingWork(db)
    expect(work.moving).toBe(49)
    expect(work.skipped).toEqual([{ reason: 'pinned', books: 1 }])
  })

  /*
   * #325, and it is the same claim from both ends: the plan and this list are
   * one job of work read twice, minutes apart, by the same person. A checked out
   * book never gets an `assigned` row, so it used to be counted by the plan and
   * unmentioned here, and somebody told six were skipped would work a list that
   * accounted for five and hunt for a sixth book that is not there.
   */
  it('counts a checked out book as left alone, the way the plan does', async () => {
    const ids = world
    await store.setCheckedOut(ids[0]!, true)

    const planned = await planRunMove(db, 'nonfiction', 3)
    expect(planned.ok).toBe(true)
    const skippedByThePlan = planned.ok
      ? planned.plan.skipped.map((one) => [one.reason, one.books.length])
      : []

    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
    const work = await outstandingWork(db)

    expect(skippedByThePlan).toEqual([['checked-out', 1]])
    expect(work.skipped).toEqual([{ reason: 'checked-out', books: 1 }])
    expect(work.moving).toBe(49)
  })

  /*
   * The other half of that decision. A checked out book is counted because it is
   * coming back, so the count has to go the moment it does, or the card silts up
   * with books that are home.
   */
  it('takes it back off the moment it is back in the house', async () => {
    const ids = world
    await store.setCheckedOut(ids[0]!, true)
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    await store.setCheckedOut(ids[0]!, false)

    const work = await outstandingWork(db)
    expect(work.skipped).toEqual([])
  })

  it('names the books somebody carried that the newest change wants back', async () => {
    await applyRunMove(db, 'nonfiction', 3, '2026-08-09T10:00:00.000Z')

    const trip = (await outstandingWork(db)).trips[0]!
    const carried = trip.books[0]!
    await store.setLocation(carried.id, trip.to)

    // He changes his mind: the run goes back to bookcase 4.
    await applyRunMove(db, 'nonfiction', 4, '2026-08-12T10:00:00.000Z')

    const work = await outstandingWork(db)
    expect(work.changed).not.toBeNull()
    expect(work.changed!.left).toBe(49)
    expect(work.changed!.joined).toBe(1)
    expect(work.changed!.again).toEqual([
      { book: expect.objectContaining({ id: carried.id }), from: '3A', to: '4A' },
    ])
  })
})

describe('one trip, read at the area the books come off', () => {
  it('draws everything standing on the area, and says which of it is going',
    async () => {
      await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

      const trip = (await outstandingWork(db)).trips[0]!
      const at = await tripAtArea(db, trip.fromAreaId, trip.toAreaId)

      expect(at).not.toBeNull()
      expect(at!.from).toBe('4A')
      expect(at!.to).toBe('3A')
      expect(at!.books).toHaveLength(8)
      expect(at!.books.every((book) => book.going)).toBe(true)
    })

  it('keeps a pinned book on the area and says it is staying', async () => {
    const ids = world
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const area = (await db.get<{ current_area_id: number }>(
      'SELECT current_area_id FROM books WHERE id = ?', [ids[0]!],
    ))!.current_area_id
    await new DrizzlePlacementLedger(db).record({
      bookId: ids[0]!,
      kind: 'pinned',
      areaId: area,
      sortKey: '',
      actor: 'person',
      reason: 'it lives here',
      createdAt: new Date().toISOString(),
    })

    const trip = (await outstandingWork(db)).trips[0]!
    const at = await tripAtArea(db, trip.fromAreaId, trip.toAreaId)

    expect(at!.books).toHaveLength(8)
    expect(at!.books.filter((book) => book.going)).toHaveLength(7)
    expect(at!.books.find((book) => book.id === ids[0])!.staying).toBe('pinned')
  })

  it('answers nothing for a pair of areas this collection does not have', async () => {

    expect(await tripAtArea(db, 9999, 9998)).toBeNull()
  })
})
