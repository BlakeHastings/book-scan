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
import { leaveWhereTheyAre, outstandingWork, putBackOnTheList, tripAtArea } from './carry'
import { countProjectionDisagreements } from '../infrastructure/placement/projection'
import { photographsTaken } from './photographs'
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

/**
 * The situation the owner is actually in, and the way out of it (#402).
 *
 * Fifty books assigned across the room, some already carried, one pinned, and a
 * person who is not going to walk any of it. **Everything here is a claim about
 * what did not happen**: no book moved, no `placed` row was written, the ones
 * already carried kept the home they were carried to, and the work did not come
 * straight back the next time the rules ran.
 */
describe('leaving books where they are', () => {
  /** Where the catalogue says every book is, which is the thing at risk. */
  const whereEverythingIs = async () => new Map((await db.all<{
    id: number; current_area_id: number | null
  }>('SELECT id, current_area_id FROM books ORDER BY id'))
    .map((row) => [Number(row.id), row.current_area_id]))

  /** How many rows say somebody put a book somewhere. */
  const placements = async () => Number((await db.get<{ n: string }>(
    `SELECT count(*)::text AS n FROM book_placement WHERE kind = 'placed'`,
  ))!.n)

  const now = () => new Date().toISOString()

  it('empties the list and moves nothing at all', async () => {
    await applyRunMove(db, 'nonfiction', 3, now())
    const before = await whereEverythingIs()
    const wasPlaced = await placements()

    const left = await leaveWhereTheyAre(db, null, now())

    expect(left.books).toBe(50)
    expect((await outstandingWork(db)).moving).toBe(0)
    // Every book, one by one, still standing where it stood.
    expect(await whereEverythingIs()).toEqual(before)
    expect(await placements()).toBe(wasPlaced)
    // And the projection still agrees with the ledger it is folded from.
    expect(await countProjectionDisagreements(db)).toBe(0)
  })

  it('says what was left, off which area, and where the rules wanted it', async () => {
    await applyRunMove(db, 'nonfiction', 3, now())
    await leaveWhereTheyAre(db, null, now())

    const work = await outstandingWork(db)

    expect(work.setAside.map((one) => [one.from, one.to, one.books]))
      .toEqual([['4C', '3C', 22], ['4B', '3B', 20], ['4A', '3A', 8]])
    // Named by the rule that asked, so the person knows what to change.
    expect(work.setAside.every((one) => one.rules.length > 0)).toBe(true)
  })

  it('does not hand the same work back the next time the rules run', async () => {
    /*
     * The question #402 says decides the design. The rule that put the run on
     * bookcase 3 is still there, so a run that knew nothing about the decision
     * would write all fifty rows again and give him back the list he had just
     * cleared.
     */
    await applyRunMove(db, 'nonfiction', 3, now())
    await leaveWhereTheyAre(db, null, now())

    await applyRunMove(db, 'nonfiction', 3, now())

    const work = await outstandingWork(db)
    expect(work.moving).toBe(0)
    expect(work.setAside.reduce((all, one) => all + one.books, 0)).toBe(50)
  })

  it('leaves the books somebody had already carried where they were carried to',
    async () => {
      await applyRunMove(db, 'nonfiction', 3, now())

      const trip = (await outstandingWork(db)).trips.find((one) => one.from === '4A')!
      const carried = trip.books.slice(0, 3)
      for (const book of carried) await store.setLocation(book.id, trip.to)

      const at = await whereEverythingIs()
      await leaveWhereTheyAre(db, null, now())

      // The three that were walked are on 3A and stay on 3A; the rest are where
      // they stood. Both halves are the same assertion, which is the point.
      expect(await whereEverythingIs()).toEqual(at)
      const work = await outstandingWork(db)
      expect(work.moving).toBe(0)
      expect(work.setAside.reduce((all, one) => all + one.books, 0)).toBe(47)
    })

  it('cannot touch a pinned book, because a pin left nothing to withdraw', async () => {
    const ids = world
    await applyRunMove(db, 'nonfiction', 3, now())

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
      createdAt: now(),
    })

    await leaveWhereTheyAre(db, null, now())

    const rows = await db.all<{ kind: string }>(
      'SELECT kind FROM book_placement WHERE book_id = ? ORDER BY id', [ids[0]!],
    )
    expect(rows.map((row) => row.kind)).not.toContain('released')
    expect((await outstandingWork(db)).skipped).toEqual([{ reason: 'pinned', books: 1 }])
  })

  it('takes one trip when it is given one, and leaves the others alone', async () => {
    await applyRunMove(db, 'nonfiction', 3, now())

    const trip = (await outstandingWork(db)).trips.find((one) => one.from === '4A')!
    const left = await leaveWhereTheyAre(
      db, { fromAreaId: trip.fromAreaId, toAreaId: trip.toAreaId }, now(),
    )

    const work = await outstandingWork(db)
    expect(left.books).toBe(8)
    expect(work.moving).toBe(42)
    expect(work.trips.map((one) => one.from)).toEqual(['4B', '4C'])
    expect(work.setAside.map((one) => [one.from, one.books])).toEqual([['4A', 8]])
  })

  it('is itself withdrawable, and the books come back on the list they left', async () => {
    await applyRunMove(db, 'nonfiction', 3, now())
    const before = await whereEverythingIs()
    await leaveWhereTheyAre(db, null, now())

    const back = await putBackOnTheList(db, null, now())

    const work = await outstandingWork(db)
    expect(back.books).toBe(50)
    expect(work.moving).toBe(50)
    expect(work.setAside).toEqual([])
    expect(work.trips.map((one) => [one.from, one.to, one.books.length]))
      .toEqual([['4A', '3A', 8], ['4B', '3B', 20], ['4C', '3C', 22]])
    // The way back moves nothing either.
    expect(await whereEverythingIs()).toEqual(before)
  })

  it('writes nothing when there is nothing outstanding to withdraw', async () => {
    const rows = async () => Number((await db.get<{ n: string }>(
      'SELECT count(*)::text AS n FROM book_placement',
    ))!.n)
    const before = await rows()

    expect((await leaveWhereTheyAre(db, null, now())).books).toBe(0)
    expect(await rows()).toBe(before)
  })

  it('keeps the assignment and the answer to it, because history is not a gap',
    async () => {
      await applyRunMove(db, 'nonfiction', 3, now())
      const id = (await outstandingWork(db)).trips[0]!.books[0]!.id

      const history = async () => db.all<{ kind: string; area_id: number | null }>(
        'SELECT kind, area_id FROM book_placement WHERE book_id = ? ORDER BY id', [id],
      )
      const before = (await history()).map((row) => row.kind)

      await leaveWhereTheyAre(db, null, now())

      // Nothing rewritten and nothing removed: one row on the end, and the
      // assignment it answers still there with the rule that wanted it.
      const rows = await history()
      expect(rows.map((row) => row.kind)).toEqual([...before, 'released'])
      expect(before).toContain('assigned')
      // The withdrawal names no area, which is what stops it saying where a book
      // is even by accident. The schema refuses it one.
      expect(rows[rows.length - 1]!.area_id).toBeNull()
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

/**
 * The read that both carry routes make, held to answering the pictures (#386).
 *
 * **This is the seam the whole defect lived at.** Every carry screen drew its
 * books as flat coloured blocks with no photograph and no spine to them, and the
 * cause was one thing rather than two: this was the only read of a book in the
 * app that never asked for the photographs, so the shelf drawing and the row
 * were handed nothing and fell back to the cloth they draw a book with no
 * picture in. It is checked here rather than only at the panes because a screen
 * cannot draw what it was never sent.
 */
describe('the pictures a book on the list is drawn by', () => {
  /** Which photograph the wire says stands in for each of the two views. */
  const picturesOf = async (id: number) => {
    const found = (await outstandingWork(db)).trips
      .flatMap((trip) => trip.books)
      .find((book) => book.id === id)
    return found && { spine: found.spine, cover: found.cover }
  }

  it('sends the spine photograph and the cover, on every book of every trip',
    async () => {
      const taken = new Date().toISOString()
      await photographsTaken(db, world[0]!, {
        front: 'front-one.jpg', back: 'back-one.jpg', edge: 'edge-one.jpg',
      }, taken)
      await applyRunMove(db, 'nonfiction', 3, taken)

      expect(await picturesOf(world[0]!))
        .toEqual({ spine: 'edge-one.jpg', cover: 'front-one.jpg' })
    })

  /*
   * The precedence is `shared/shelving.ts`'s and is not restated here: what
   * matters at this seam is that the same question is asked of a carried book
   * that the library asks of a shelved one, so a book cannot be one picture on
   * one screen and another on the next.
   */
  it('stands a cover in for a spine nobody photographed, as every shelf does',
    async () => {
      const taken = new Date().toISOString()
      await photographsTaken(db, world[0]!, { front: 'front-one.jpg' }, taken)
      await applyRunMove(db, 'nonfiction', 3, taken)

      expect(await picturesOf(world[0]!))
        .toEqual({ spine: 'front-one.jpg', cover: 'front-one.jpg' })
    })

  /*
   * A book nobody has photographed is a real book and stays on the list. It is
   * drawn in the cloth every view binds an unphotographed book in, which is a
   * decision the drawing makes from '' rather than one this route makes by
   * leaving the book out.
   */
  it('says so with an empty name rather than dropping the book', async () => {
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    expect(await picturesOf(world[0]!)).toEqual({ spine: '', cover: '' })
  })

  it('sends them for the books standing on the area, staying ones included',
    async () => {
      const taken = new Date().toISOString()
      await photographsTaken(db, world[0]!, { edge: 'edge-one.jpg' }, taken)
      await applyRunMove(db, 'nonfiction', 3, taken)

      const trip = (await outstandingWork(db)).trips[0]!
      const at = await tripAtArea(db, trip.fromAreaId, trip.toAreaId)

      expect(at!.books.find((book) => book.id === world[0])!.spine).toBe('edge-one.jpg')
      expect(at!.books.every((book) => typeof book.spine === 'string')).toBe(true)
    })
})
