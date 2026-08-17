/**
 * The owner's sentence, driven end to end against a real catalogue.
 *
 * "Non-fiction is on bookcase 4 and I want it on bookcase 3, and then show me
 * every book I have to carry." So this builds a world the shape his is in, 50
 * non-fiction books cut 8, 20 and 22 across `4A`, `4B` and `4C`, plans the move,
 * applies it, and then follows the books through the list that already exists
 * until one of them leaves it.
 *
 * **The last part is the part worth having.** Nothing here moves a book: the
 * apply records where the rules want each one, the needs-attention list is that
 * disagreeing with where the book was last seen, and `PATCH
 * /api/books/:id/location` is what a person carrying a book says. If applying
 * built a second list, or wrote a `placed` row, this file would still pass on
 * the counts and the app would be lying about where somebody's books are.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, keepThisCatalogue, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { Store, type DraftBook } from './store'
import { Shelves } from './shelves'
import { recordCredits, settleGenre } from './book-save'
import { applyRunMove, planRunMove } from './relocate-run'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { NON_FICTION_SLUG, FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import { standingOf } from '../domain/placement/ledger'

let db: Db
let store: Store
let shelves: Shelves

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
 * The catalogue as it stands in the owner's house: one bookcase of non-fiction
 * cut into three planks holding 8, 20 and 22, and fiction elsewhere.
 *
 * The planks are cut after the books are in, because that is the order the room
 * happened in: somebody filled a shelf and then said it was full.
 */
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

  // Everybody is where the new planks say, because in the room they never
  // moved: the dividers went in around the books.
  for (const placed of await shelves.layout('nonfiction')) {
    await store.setLocation(placed.book.id, placed.label)
  }

  return ids
}

/** The ids `buildTheWorld` handed back, which every test reads and none rebuilds. */
let world: number[] = []

/**
 * One database for the file, and one world built in it, put back between tests.
 *
 * See the long version of this in `carry.test.ts`, the other file #343 names.
 * The short version: this file used to drop and rebuild its database and rebuild
 * its fifty-three book world in every one of its eight tests, a `DROP DATABASE`
 * forces an immediate checkpoint across the whole server, and the two heaviest
 * files in the suite were losing to the contention they were generating.
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

describe('moving the non-fiction run from bookcase 4 to bookcase 3', () => {
  it('plans every book to carry, grouped plank by plank, and writes nothing', async () => {

    const before = await new DrizzlePlacementLedger(db).forBooks(
      (await shelves.layout('nonfiction')).map((placed) => placed.book.id),
    )

    const planned = await planRunMove(db, 'nonfiction', 3)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    expect(planned.plan.from).toBe(4)
    expect(planned.plan.to).toBe(3)
    expect(planned.plan.planks).toEqual([
      { from: '4A', to: '3A' },
      { from: '4B', to: '3B' },
      { from: '4C', to: '3C' },
    ])
    expect(planned.plan.moving).toBe(50)
    expect(planned.plan.groups.map((group) => [group.from, group.to, group.books.length]))
      .toEqual([['4A', '3A', 8], ['4B', '3B', 20], ['4C', '3C', 22]])
    expect(planned.plan.skipped).toEqual([])
    expect(planned.plan.unclaimed).toEqual([])

    const after = await new DrizzlePlacementLedger(db).forBooks(
      (await shelves.layout('nonfiction')).map((placed) => placed.book.id),
    )
    expect(after).toEqual(before)
  })

  it('says how many books it skipped and why, rather than counting them as moves', async () => {
    const ids = world
    const pinned = ids[0]!
    await new DrizzlePlacementLedger(db).record({
      bookId: pinned,
      kind: 'pinned',
      areaId: (await db.get<{ current_area_id: number }>(
        'SELECT current_area_id FROM books WHERE id = ?', [pinned],
      ))!.current_area_id,
      sortKey: '',
      actor: 'person',
      reason: 'it lives here',
      createdAt: new Date().toISOString(),
    })
    await store.setCheckedOut(ids[1]!, true)

    const planned = await planRunMove(db, 'nonfiction', 3)
    if (!planned.ok) throw new Error(planned.error)

    expect(planned.plan.moving).toBe(48)
    expect(planned.plan.skipped).toEqual([
      { reason: 'pinned', books: [expect.objectContaining({ id: pinned })] },
      { reason: 'checked-out', books: [expect.objectContaining({ id: ids[1] })] },
    ])
  })

  it('applies as assignments, and the needs-attention list holds exactly those books',
    async () => {
      const wanted = (await shelves.layout('nonfiction')).map((placed) => placed.book.id)

      const applied = await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
      expect(applied.ok).toBe(true)
      if (!applied.ok) return

      expect(applied.wrote.assigned).toBe(50)

      // Assignments, not placements: nobody has carried anything, so every book
      // is still recorded exactly where it was.
      const rows = await new DrizzlePlacementLedger(db).forBooks(wanted)
      expect(rows.filter((row) => row.kind === 'assigned')).toHaveLength(50)
      expect(rows.filter((row) => row.kind === 'assigned').every((row) => row.actor === 'rules'))
        .toBe(true)

      const review = await shelves.review('nonfiction')
      expect(review.misfiles.map((misfile) => misfile.book.id).sort((a, b) => a - b))
        .toEqual([...wanted].sort((a, b) => a - b))
      expect(review.misfiles.map((misfile) => misfile.from.slice(0, 1))).toEqual(
        review.misfiles.map(() => '4'),
      )
      expect(review.misfiles.map((misfile) => misfile.to.slice(0, 1))).toEqual(
        review.misfiles.map(() => '3'),
      )
    })

  it('lets a book leave the list the moment somebody says they carried it', async () => {
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const first = (await shelves.review('nonfiction')).misfiles[0]!
    expect(first.from).toBe('4A')
    expect(first.to).toBe('3A')

    await store.setLocation(first.book.id, first.to)

    const after = await shelves.review('nonfiction')
    expect(after.misfiles.map((misfile) => misfile.book.id)).not.toContain(first.book.id)
    expect(after.misfiles).toHaveLength(49)

    // And the ledger agrees, which is the same fact said as rows: the standing
    // assignment is where the book now is.
    const standing = standingOf(await new DrizzlePlacementLedger(db).forBooks([first.book.id]))
    expect(standing.assigned).toBe(standing.area)
  })

  it('is safe to apply twice, and the second one writes nothing', async () => {
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const again = await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
    if (!again.ok) throw new Error(again.error)

    /*
     * Nothing is written twice, and the plan still says 50 books have to be
     * carried, because they do: the assignment is recorded and the books are
     * still on the planks they were on. Those are different questions and it
     * matters that they answer differently. What must not happen is a second
     * identical `assigned` row per book, which is `assignmentFor`'s rule.
     */
    expect(again.wrote.assigned).toBe(0)
    expect(again.wrote.unchanged).toBe(50)
    expect(again.plan.moving).toBe(50)
    expect(again.plan.planks).toEqual([])

    const rows = await new DrizzlePlacementLedger(db).forBooks(
      (await shelves.review('nonfiction')).misfiles.map((misfile) => misfile.book.id),
    )
    expect(rows.filter((row) => row.kind === 'assigned')).toHaveLength(50)
  })

  it('leaves fiction exactly where it was', async () => {
    const before = await shelves.layout('fiction')

    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    expect((await shelves.layout('fiction')).map((placed) => placed.label))
      .toEqual(before.map((placed) => placed.label))
    expect((await shelves.review('fiction')).misfiles).toEqual([])
  })

  it('takes the run back to bookcase 4 and puts every book back on the plank it names',
    async () => {
      await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

      const back = await applyRunMove(db, 'nonfiction', 4, new Date().toISOString())
      if (!back.ok) throw new Error(back.error)

      // The planks come back rather than being made again, so the books are on
      // the rows the ledger already names and there is nothing to carry.
      expect(await shelves.review('nonfiction')).toEqual(
        expect.objectContaining({ misfiles: [] }),
      )
    })

  it('refuses a bookcase another run is standing on, and writes nothing', async () => {

    const refused = await applyRunMove(db, 'nonfiction', 1, new Date().toISOString())
    expect(refused.ok).toBe(false)
    expect((await shelves.review('nonfiction')).misfiles).toEqual([])
    expect((await shelves.layout('nonfiction'))[0]!.label).toBe('4A')
  })
})
