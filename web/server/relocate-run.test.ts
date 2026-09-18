/**
 * Nothing here moves a book: applying a plan records where the rules want each
 * one, and the needs-attention list is that disagreeing with where the book was
 * last seen. `PATCH /api/books/:id/location` is what a person carrying a book
 * says. If applying wrote a location itself, this file would still pass on the
 * counts while the app lied about where somebody's books are.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, keepThisCatalogue, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { Store, type DraftBook } from './store'
import { Shelves } from './shelves'
import { recordCredits, settleGenre } from './book-save'
import { applyRunMove, planRunMove, runMoveOffer } from './relocate-run'
import {
  addAreaTo, addFixture, booksInArea, booksOnFixture, describeFixture, describeFurniture,
  dropArea, editFixture, planAreaRemoval, type DescribedFixture,
} from './furniture'
import { applyRuleChange } from './place-rule'
import { outstandingWork } from './carry'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleSeparatorRepository } from '../infrastructure/shelving/separator-repository'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'
import { NON_FICTION_SLUG, FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import { TagSlug } from '../domain/tagging/tags'
import { standingOf } from '../domain/placement/ledger'
import { bandsOf, furnitureIn, runAreasOf } from '../infrastructure/shelving/areas'
import { claim, entryAreaOf } from '../domain/placement/rules'

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
 * Planks are cut after the books are in, mirroring how the room actually
 * happened: somebody filled a shelf and then said it was full.
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

  // Everybody is where the new planks say: the dividers went in around the
  // books, which never physically moved.
  for (const placed of await shelves.layout('nonfiction')) {
    await store.setLocation(placed.book.id, placed.label)
  }

  return ids
}

/** The ids `buildTheWorld` handed back, which every test reads and none rebuilds. */
let world: number[] = []

/**
 * Built once in `beforeAll` and restored per test with `openTestDatabase`,
 * rather than dropped and rebuilt every time: `DROP DATABASE` forces a
 * checkpoint across the whole server, and rebuilding this file's world in every
 * test caused contention with other heavy files in the suite. See
 * `carry.test.ts` for the long version.
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

    const standing = standingOf(await new DrizzlePlacementLedger(db).forBooks([first.book.id]))
    expect(standing.assigned).toBe(standing.area)
  })

  it('is safe to apply twice, and the second one writes nothing', async () => {
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const again = await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
    if (!again.ok) throw new Error(again.error)

    /*
     * The plan still says 50 books need carrying, because they do: the
     * assignment is recorded but the books have not physically moved. Nothing
     * must write a second identical `assigned` row per book (`assignmentFor`'s rule).
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

/**
 * Applying a move deletes no furniture: a piece goes only through
 * `DELETE /api/fixtures/:id`, which refuses while books or rules are on it.
 * Hall stands after bookcase 4 with no rule of its own, so the non-fiction run
 * flows onto it, and a piece the move would leave empty is only named in the plan.
 */
describe('a bookcase somebody put up, standing after the run being moved', () => {
  /** Hall, four shelves, the bottom one called Comics. */
  async function putUpTheHall(): Promise<number> {
    const added = await addFixture(db, { name: 'Hall' })
    if (!added.ok) throw new Error(added.error)

    for (const name of ['', '', '', 'Comics']) {
      const area = await addAreaTo(db, added.fixture.id, { name })
      if (!area.ok) throw new Error(area.error)
    }
    return added.fixture.id
  }

  const faceOf = async (id: number): Promise<string[]> =>
    (await db.all<{ name: string }>(
      'SELECT name FROM area WHERE fixture_id = ? AND position >= 0 ORDER BY position',
      [id],
    )).map((row) => row.name)

  it('is still standing after the move, under the name somebody gave it', async () => {
    const hall = await putUpTheHall()
    expect(await faceOf(hall)).toEqual(['', '', '', 'Comics'])

    const applied = await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
    if (!applied.ok) throw new Error(applied.error)

    expect(await db.get<{ name: string }>('SELECT name FROM fixture WHERE id = ?', [hall]))
      .toEqual(expect.objectContaining({ name: 'Hall' }))
  })

  it('loses no area row, so the name somebody wrote on a plank survives', async () => {
    await putUpTheHall()
    const before = await db.get<{ n: number }>('SELECT count(*)::int AS n FROM area')

    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

    const after = await db.get<{ n: number }>('SELECT count(*)::int AS n FROM area')
    expect(after!.n).toBeGreaterThanOrEqual(before!.n)
    expect(await db.get<{ n: number }>(
      "SELECT count(*)::int AS n FROM area WHERE name = 'Comics'",
    )).toEqual({ n: 1 })
  })

  it('is named in the plan as a piece the move would leave with nothing on it', async () => {
    await putUpTheHall()

    const planned = await planRunMove(db, 'nonfiction', 3)
    if (!planned.ok) throw new Error(planned.error)

    expect(planned.plan.emptied).toEqual([
      expect.objectContaining({ name: 'Hall', planks: 4 }),
    ])
  })

  /**
   * A bookcase somebody's rule stands on is that rule's furniture: a move does
   * not touch it. `runFrom` stops at any rule's entry area.
   */
  describe('and the rule somebody wrote on its bottom shelf', () => {
    const COMICS = TagSlug.of('subject/comics')

    /** Task 1 and task 2 of the usability run, done through the same calls the app makes. */
    async function prepareTheComicsShelf(): Promise<{ hall: number; bottom: number }> {
      const hall = await putUpTheHall()

      const piece = await describeFixture(db, hall)
      const bottom = piece!.areas[piece!.areas.length - 1]!
      expect(bottom.name).toBe('Comics')

      const wrote = await applyRuleChange(db, {
        about: 'area',
        placeId: bottom.id,
        rules: [{ id: null, conditions: [{ operator: 'is', tag: COMICS.value, label: 'Comics' }] }],
      }, new Date().toISOString())
      if (!wrote.ok) throw new Error(wrote.error)

      return { hall, bottom: bottom.id }
    }

    /** Every plank the app would draw on a piece, in the order it draws them. */
    const drawn = async (id: number): Promise<string[]> =>
      (await describeFixture(db, id))!.areas.map((area) => `${area.label}${area.name ? ` ${area.name}` : ''}`)

    it('leaves every shelf of the hall bookcase exactly where somebody put it', async () => {
      const { hall } = await prepareTheComicsShelf()
      expect(await drawn(hall))
        .toEqual(['Hall · A', 'Hall · B', 'Hall · C', 'Hall · Comics Comics'])

      const applied = await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
      if (!applied.ok) throw new Error(applied.error)

      expect(await drawn(hall))
        .toEqual(['Hall · A', 'Hall · B', 'Hall · C', 'Hall · Comics Comics'])
      expect(await db.get<{ n: number }>(
        'SELECT count(*)::int AS n FROM area WHERE fixture_id = ? AND position < 0', [hall],
      )).toEqual({ n: 0 })
    })

    it('leaves the comics rule pointing at a shelf the app draws', async () => {
      const { bottom } = await prepareTheComicsShelf()

      await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

      const rule = await db.get<{ id: number; area_id: number }>(
        `SELECT r.id, r.area_id FROM placement_rule r JOIN rule_condition c ON c.rule_id = r.id
          WHERE c.value = ?`, [COMICS.value],
      )
      expect(rule?.area_id).toBe(bottom)

      const { rules, order } = await furnitureIn(db)
      const entry = entryAreaOf(rules.find((one) => one.id === rule!.id)!, order)
      expect(entry).toBe(bottom)
      expect(order.some((slot) => slot.area.id === bottom)).toBe(true)
    })

    it('stands no plank on the bookcase the books came off, so there is no 4D', async () => {
      await prepareTheComicsShelf()
      const before = await drawn((await describeFurniture(db)).fixtures
        .find((one) => one.position === 4)!.id)
      expect(before).toEqual(['4A', '4B', '4C'])

      await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

      const four = (await describeFurniture(db)).fixtures.find((one) => one.position === 4)!
      expect(four.areas).toEqual([])
      expect(four.gone.map((area) => area.label)).toEqual(['4A', '4B', '4C'])
      // The books are still standing on it: the piece accounts for them even
      // with none of its planks on its face.
      expect(four.books).toBe(50)
    })

    it('moves the three planks it is about, and says so in the plan', async () => {
      await prepareTheComicsShelf()

      const planned = await planRunMove(db, 'nonfiction', 3)
      if (!planned.ok) throw new Error(planned.error)

      expect(planned.plan.planks).toEqual([
        { from: '4A', to: '3A' }, { from: '4B', to: '3B' }, { from: '4C', to: '3C' },
      ])
      expect(planned.plan.emptied).toEqual([
        expect.objectContaining({ position: 4, planks: 3 }),
      ])
    })

    /**
     * A run and a move answer different questions with different, both-correct
     * bounds: the non-fiction run extends onto the hall (a run continues until
     * the next area a rule points at), but the move stops at bookcase 4.
     */
    it('reaches the hall as a run and stops before it as a move', async () => {
      const { hall } = await prepareTheComicsShelf()

      const planks = (await runAreasOf(db, 'nonfiction')).map((area) =>
        `${area.fixturePosition}:${area.position}`)
      const hallPosition = (await describeFixture(db, hall))!.position

      // The three shelves above the comics rule, and not the one it stands on.
      expect(planks).toEqual([
        '4:0', '4:1', '4:2',
        `${hallPosition}:0`, `${hallPosition}:1`, `${hallPosition}:2`,
      ])

      const planned = await planRunMove(db, 'nonfiction', 3)
      if (!planned.ok) throw new Error(planned.error)
      expect(planned.plan.planks).toEqual([
        { from: '4A', to: '3A' }, { from: '4B', to: '3B' }, { from: '4C', to: '3C' },
      ])
    })

    it('leaves no shelf anywhere that nobody can reach', async () => {
      await prepareTheComicsShelf()

      await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

      /*
       * A plank off a face with nothing standing on it must not exist; a plank
       * off a face with books on it is fine and reachable, which is what a move
       * leaves behind on the bookcase it emptied.
       */
      const orphans = await db.all<{ id: number; label: string }>(
        `SELECT a.id, f.position || ':' || a.position AS label
           FROM area a JOIN fixture f ON f.id = a.fixture_id
          WHERE a.position < 0
            AND NOT EXISTS (SELECT 1 FROM books b WHERE b.current_area_id = a.id)`,
      )
      expect(orphans).toEqual([])
    })

    /*
     * Taking a plank with a rule on it out by hand is allowed; the rule then
     * falls back to the piece the plank was on rather than being refused or
     * deleted, and keeps claiming the same books.
     */
    it('leaves a rule on the piece when somebody takes its plank out by hand', async () => {
      const { hall, bottom } = await prepareTheComicsShelf()

      const dropped = await dropArea(db, bottom, new Date().toISOString())
      if (!dropped.ok) throw new Error(dropped.error)

      const rule = await db.get<{ area_id: number | null; fixture_id: number | null }>(
        `SELECT r.area_id, r.fixture_id FROM placement_rule r
           JOIN rule_condition c ON c.rule_id = r.id WHERE c.value = ?`, [COMICS.value],
      )
      expect(rule).toEqual({ area_id: null, fixture_id: hall })

      // And it still opens a run, on the plank that is now the top of the piece.
      const { rules, order } = await furnitureIn(db)
      const comics = rules.find((one) => one.fixtureId === hall)!
      expect(entryAreaOf(comics, order)).not.toBeNull()
    })

    it('still puts every book back on the plank it names when the run comes home', async () => {
      await prepareTheComicsShelf()
      const where = async (): Promise<string[]> =>
        (await shelves.layout('nonfiction')).map((placed) => placed.label)

      await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
      await applyRunMove(db, 'nonfiction', 4, new Date().toISOString())

      const home = await where()
      expect(home[0]).toBe('4A')
      expect(new Set(home)).toEqual(new Set(['4A', '4B', '4C']))
    })
  })
})

/**
 * A piece of furniture accounts for the books standing on it whatever became
 * of the area holding them, even a retired one off the face. Retiring itself
 * is unchanged: retired areas stay off the face, out of `fixture.areas`, and
 * are not boundaries; nothing here deletes one.
 */
describe('the bookcase a stretch of books was moved off, before anybody carries one', () => {
  /** Bookcase 4 as `/api/fixtures` answers it, after the move and no carrying. */
  async function bookcaseFour(): Promise<DescribedFixture> {
    const room = await describeFurniture(db)
    const four = room.fixtures.find((one) => one.position === 4)
    if (!four) throw new Error('bookcase 4 is not in the room')
    return four
  }

  beforeEach(async () => {
    await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())
  })

  /**
   * Two pieces standing on one number is an arrangement this catalogue allows
   * (see `places` in lib/furniture.ts); when neither is named, `labelFor`
   * renders both their top planks `4A`, so a trip here can read `4A -> 4A`.
   */
  it('says so when a trip has two ends that read the same', async () => {
    const room = await describeFurniture(db)
    const three = room.fixtures.find((one) => one.position === 3)!
    const renumbered = await editFixture(db, three.id, { position: 4 })
    expect(renumbered.ok).toBe(true)

    const work = await outstandingWork(db)

    // Both ends read alike, which is the defect, and it is still true: nothing
    // here renames a plank.
    expect(work.trips.map((trip) => `${trip.from} -> ${trip.to}`))
      .toEqual(['4A -> 4A', '4B -> 4B', '4C -> 4C'])
    // The areas underneath are three distinct pairs, and the counts are the
    // owner's own 8, 20 and 22.
    expect(work.trips.map((trip) => [trip.fromAreaId, trip.toAreaId, trip.books.length]))
      .toEqual([[2, 5, 8], [3, 6, 20], [4, 7, 22]])
    // And the list now says which number the two pieces are sharing, so the
    // screen can say that rather than drawing a trip to where you are standing.
    expect(work.trips.map((trip) => trip.sharedNumber)).toEqual([4, 4, 4])
  })

  /** Every ordinary trip, which is nearly all of them, says nothing about it. */
  it('says nothing of the sort about a trip whose ends read differently', async () => {
    const work = await outstandingWork(db)

    expect(work.trips.map((trip) => `${trip.from} -> ${trip.to}`))
      .toEqual(['4A -> 3A', '4B -> 3B', '4C -> 3C'])
    expect(work.trips.map((trip) => trip.sharedNumber)).toEqual([null, null, null])
  })

  it('is the two answers the owner saw, and they are now the same number', async () => {
    const four = await bookcaseFour()
    const work = await outstandingWork(db)
    const carrying = work.trips.reduce((total, trip) => total + trip.books.length, 0)

    expect(carrying).toBe(50)
    expect(work.trips.map((trip) => trip.from)).toEqual(['4A', '4B', '4C'])
    expect(work.trips.map((trip) => trip.to)).toEqual(['3A', '3B', '3C'])

    // Nought areas is correct: the areas were taken off the face, and the face
    // is what `areas` is. Nought books would be the wrong half.
    expect(four.areas).toEqual([])
    expect(four.books).toBe(carrying)
  })

  it('names the areas that were taken out, with the books standing on each', async () => {
    const four = await bookcaseFour()

    expect(four.gone.map((area) => [area.label, area.books]))
      .toEqual([['4A', 8], ['4B', 20], ['4C', 22]])
    expect(four.gone.every((area) => area.gone)).toBe(true)
    expect(four.areas).toEqual([])
  })

  it('lists every one of those books on the piece itself', async () => {
    const four = await bookcaseFour()
    const on = await booksOnFixture(db, four.id)
    if (!on.ok) throw new Error(on.error)

    expect(on.fixture.books).toBe(50)
    expect(on.books).toHaveLength(50)
  })

  it('opens the area they are standing on rather than answering that there is none',
    async () => {
      const four = await bookcaseFour()
      const first = four.gone[0]!

      const read = await booksInArea(db, first.id)
      if (!read.ok) throw new Error(read.error)

      expect(read.area.label).toBe('4A')
      expect(read.area.books).toBe(8)
      expect(read.area.gone).toBe(true)
      expect(read.books).toHaveLength(8)
    })

  /*
   * The area is off the face already, so there is nothing on the piece to take
   * it off; removal is refused because the row is still pinned by the
   * placements naming it.
   */
  it('still refuses to remove an area that is already off the piece', async () => {
    const four = await bookcaseFour()

    const planned = await planAreaRemoval(db, four.gone[0]!.id)
    expect(planned.ok).toBe(false)
  })

  it('empties the piece as the books are carried, one answer at a time', async () => {
    const work = await outstandingWork(db)
    const trip = work.trips[0]!

    for (const book of trip.books) await store.setLocation(book.id, trip.to)

    const four = await bookcaseFour()
    expect(four.books).toBe(42)
    expect(four.gone.map((area) => [area.label, area.books]))
      .toEqual([['4B', 20], ['4C', 22]])

    // An area nothing is standing on any more is not drawn at all, though the
    // row stays, pinned by the ledger; it is not a leftover somebody has to dismiss.
    expect(four.gone.map((area) => area.label)).not.toContain('4A')
  })

  it('leaves the bookcase the books are going to reading as it should', async () => {
    const room = await describeFurniture(db)
    const three = room.fixtures.find((one) => one.position === 3)!

    expect(three.areas.map((area) => area.label)).toEqual(['3A', '3B', '3C'])
    expect(three.gone).toEqual([])
    // Nobody has carried anything yet, so nothing is standing on 3 yet: an
    // honest zero, unlike bookcase 4's.
    expect(three.books).toBe(0)
  })
})

/**
 * Two fixtures claiming one tag is legal and stays legal; this must never
 * become an error, a warning, or a rule quietly ignored. `bandsOf` and `claim`
 * must resolve an ambiguous genre to the same rule, or the plank a book is
 * filed onto and the plank it is drawn on can disagree.
 */
describe('two rules naming one genre', () => {
  /** An area rule, since that beats the fixture rule on bookcase 1 outright, whatever order the two come back in. */
  async function writeASecondFictionRule(): Promise<{ fixture: number; area: number }> {
    const added = await addFixture(db, { position: 2 })
    if (!added.ok) throw new Error(added.error)

    const plank = await addAreaTo(db, added.fixture.id, {})
    if (!plank.ok) throw new Error(plank.error)

    const wrote = await applyRuleChange(db, {
      about: 'area',
      placeId: plank.area.id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: FICTION_SLUG }] }],
    }, new Date().toISOString())
    if (!wrote.ok) throw new Error(wrote.error)

    return { fixture: added.fixture.id, area: plank.area.id }
  }

  it('is accepted, and both rules stay on and keep claiming', async () => {
    const { area } = await writeASecondFictionRule()

    const { rules } = await furnitureIn(db)
    const naming = rules.filter((rule) => rule.conditions.some((line) =>
      line.field === 'tag' && line.value === FICTION_SLUG))

    expect(naming).toHaveLength(2)
    expect(naming.every((rule) => rule.enabled)).toBe(true)
    expect(naming.map((rule) => rule.areaId)).toContain(area)
  })

  it('begins the run where claim begins it, and not where the rows happen to sort', async () => {
    const { area } = await writeASecondFictionRule()

    const { order, rules } = await furnitureIn(db)
    const won = claim(rules, { tagSlugs: [FICTION_SLUG] })
    expect(won?.areaId).toBe(area)

    const entry = entryAreaOf(won!, order)
    const slot = order.find((one) => one.area.id === entry)!

    const band = (await bandsOf(db)).get('fiction')
    expect(band?.start).toEqual({ shelf: slot.fixture.position, area: slot.area.position })
    expect(band?.start).toEqual({ shelf: 2, area: 0 })
  })

  it('draws every fiction book on the plank the rules file it onto', async () => {
    await writeASecondFictionRule()

    // Three books shelved on 1A under the old fixture rule; the area rule now
    // claims all three, so 2A is where they belong and 1A is where they
    // physically are, a misfile.
    const drawn = await shelves.layout('fiction')
    expect(drawn).not.toEqual([])
    expect([...new Set(drawn.map((placed) => placed.label))]).toEqual(['2A'])
  })

  it('still stops the run where the next one begins', async () => {
    await writeASecondFictionRule()

    // Non-fiction is on bookcase 4; moving fiction's start to bookcase 2 must
    // not let its band reach across it.
    expect((await bandsOf(db)).get('fiction')?.limit).toBe(4)
  })

  /**
   * The one place `claim` and `bandsOf` legitimately diverge: `claim` refuses a
   * switched-off rule outright, but `bandsOf` falls back to it only when there
   * is no enabled rule, since being off does not merge the run into the one before it.
   */
  describe('and one of them switched off', () => {
    const switchOff = (id: number) =>
      db.run('UPDATE placement_rule SET enabled = false WHERE id = ?', [id])

    it('begins the run at the rule that is still on, which is the one filing books', async () => {
      const { area } = await writeASecondFictionRule()

      const before = await furnitureIn(db)
      const winner = claim(before.rules, { tagSlugs: [FICTION_SLUG] })!
      expect(winner.areaId).toBe(area)
      await switchOff(winner.id)

      const { rules } = await furnitureIn(db)
      const now = claim(rules, { tagSlugs: [FICTION_SLUG] })
      expect(now?.id).not.toBe(winner.id)

      expect((await bandsOf(db)).get('fiction')?.start).toEqual({ shelf: 1, area: 0 })
    })

    it('keeps the run standing when every rule for it is off', async () => {
      const { rules } = await furnitureIn(db)
      for (const rule of rules.filter((one) => one.conditions.some((line) =>
        line.field === 'tag' && line.value === FICTION_SLUG))) {
        await switchOff(rule.id)
      }

      // Nothing claims a fiction book any more, but the run has not moved or
      // merged into anything: it is a shelf with nothing on it.
      expect(claim((await furnitureIn(db)).rules, { tagSlugs: [FICTION_SLUG] })).toBeNull()
      expect((await bandsOf(db)).get('fiction')?.start).toEqual({ shelf: 1, area: 0 })
    })
  })
})

/**
 * A run lives where its rule points, not wherever the first group of books
 * happens to be standing (`groups[0].shelf`), since the two can be different
 * bookcases if the run's leading bookcase holds nothing. Whether a run can be
 * moved must be answerable before a destination is chosen, with the same
 * refusal wording either way.
 */
describe('what the arrange screen is told before it offers a bookcase', () => {
  /**
   * Writes exactly the rule the rule editor's own guidance produces for "say
   * what belongs here" on a plank; `ruleForRange` answers with it since an area
   * rule is the more specific statement.
   */
  async function sayFictionBelongsOnThisPlank(): Promise<number> {
    const added = await addFixture(db, { position: 2 })
    if (!added.ok) throw new Error(added.error)

    const plank = await addAreaTo(db, added.fixture.id, {})
    if (!plank.ok) throw new Error(plank.error)

    const wrote = await applyRuleChange(db, {
      about: 'area',
      placeId: plank.area.id,
      rules: [{ id: null, conditions: [{ operator: 'is', tag: FICTION_SLUG }] }],
    }, new Date().toISOString())
    if (!wrote.ok) throw new Error(wrote.error)

    return plank.area.id
  }

  /** A bookcase after the run with one plank anchored at the run's first book. */
  async function putUpAHallHoldingEverything(): Promise<void> {
    const first = (await shelves.layout('nonfiction'))[0]!.book.sortKey

    const hall = await addFixture(db, { name: 'Hall' })
    if (!hall.ok) throw new Error(hall.error)

    const plank = await addAreaTo(db, hall.fixture.id, { startsAt: first })
    if (!plank.ok) throw new Error(plank.error)
  }

  it('says a run cannot be moved before anybody has chosen where to move it', async () => {
    await sayFictionBelongsOnThisPlank()

    const offer = await runMoveOffer(db, 'fiction')
    expect(offer.why).toContain('names one plank rather than a bookcase')

    // Word for word the sentence the move gives after a destination is chosen.
    expect(await planRunMove(db, 'fiction', 3)).toEqual({ ok: false, error: offer.why })
  })

  /*
   * A run a move will not pick up still stands somewhere and the screen may
   * say so; what it may not do is offer three bookcases to send it to.
   */
  it('still says where the run it will not move lives', async () => {
    await sayFictionBelongsOnThisPlank()

    const offer = await runMoveOffer(db, 'fiction')
    expect(offer.from).toBe(2)
    expect(offer.planks).toEqual([])
  })

  it('says where a run lives when there is not a book standing on it', async () => {
    for (const id of world.slice(50)) await store.deleteBook(id)

    // A bare plank of the run is still drawn, holding nothing.
    expect((await shelves.groups('fiction')).map((g) => [g.label, g.books.length]))
      .toEqual([['1A', 0]])

    const offer = await runMoveOffer(db, 'fiction')
    expect(offer.from).toBe(1)
    expect(offer.planks).toEqual([{ label: '1A', books: 0 }])
    expect(offer.why).toBeNull()
  })

  /**
   * A bookcase put up after the non-fiction run is the tail of that run; a
   * plank anchored at the run's first book takes every book in it, so
   * bookcase 4 still "lives" there but holds none of it.
   */
  it('says where a run lives when its leading bookcase is the empty one', async () => {
    await putUpAHallHoldingEverything()

    const groups = await shelves.groups('nonfiction')
    expect(groups.map((group) => [group.label, group.books.length])[0]).toEqual(['4A', 0])
    expect(groups[0]!.shelf).toBe(4)
    expect((await runMoveOffer(db, 'nonfiction')).from).toBe(4)

    /*
     * The picker would have called bookcase 5 "Where it lives now"; planning
     * that choice actually moves the whole run, showing why it must not be
     * offered as a no-op destination.
     */
    const planned = await planRunMove(db, 'nonfiction', 5)
    if (!planned.ok) throw new Error(planned.error)
    expect(planned.plan.planks).not.toEqual([])
  })

  /* Every plank a move would take, including the ones holding nothing. */
  it('names the planks of the run rather than the planks holding books', async () => {
    await putUpAHallHoldingEverything()

    const offer = await runMoveOffer(db, 'nonfiction')
    expect(offer.planks).toEqual([
      { label: '4A', books: 8 },
      { label: '4B', books: 20 },
      { label: '4C', books: 22 },
      { label: 'Hall · A', books: 0 },
    ])
  })
})
