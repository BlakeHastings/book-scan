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
import {
  addAreaTo, addFixture, booksInArea, booksOnFixture, describeFixture, describeFurniture,
  dropArea, planAreaRemoval, type DescribedFixture,
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
import { bandsOf, furnitureIn } from '../infrastructure/shelving/areas'
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

/**
 * #391: the move that deleted a bookcase somebody had just put up.
 *
 * The usability baseline (#388) built a bookcase called Hall with four shelves,
 * named one of them Comics, and then moved non-fiction from bookcase 4 to
 * bookcase 3. Afterwards the Hall was gone, its four areas with it, and nothing
 * anywhere had said so.
 *
 * Hall stands after bookcase 4 with no rule of its own, so the non-fiction run
 * flows onto it, and that is what put its planks inside an operation about
 * somewhere else. What this holds to is what happens next: **applying a move
 * deletes no furniture at all**. A piece of furniture is a thing standing in a
 * room and it goes when somebody takes it away, through
 * `DELETE /api/fixtures/:id`, which refuses while books or rules are on it. And
 * a piece the move would leave with nothing on it is named in the plan, before
 * anybody presses anything.
 */
describe('a bookcase somebody put up, standing after the run being moved', () => {
  /** Hall, four shelves, the bottom one called Comics, exactly as #388 built it. */
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
   * #420: the same bookcase, with the rule somebody wrote on it.
   *
   * The second pass of the usability loop (#419) ran the same three tasks
   * against the same seed. Task 1 put the Hall up with four shelves; task 2 said
   * the comics live on its bottom one, which is a rule pointing at that plank;
   * task 3 moved non-fiction from bookcase 4 to bookcase 3. Afterwards the Hall
   * stood with all four of its shelves at `area_position` -4 to -1, drawn by no
   * screen, the piece answering "0 areas, 0 books", the comics rule still
   * pointing at one of them, and a `4D` nobody had added standing on the
   * bookcase the books had come off. **Task 3 silently undid task 2.**
   *
   * One defect and three symptoms. The plan cut the run where the comics rule
   * did, because `runFrom` stops at any rule's entry area; the write cut it
   * where the next *genre range* began, and there is no genre range past
   * non-fiction, so `bandsOf` handed `relocateRunTo` every bookcase standing
   * past bookcase 4. The plan moved six planks and the write moved seven.
   *
   * What this holds to is the sentence the fix is: **a bookcase somebody's rule
   * stands on is that rule's furniture, and a move does not touch it.**
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
      // The books are still standing on it, which is the whole of #403, and the
      // piece accounts for them while none of its planks is on its face.
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

    it('leaves no shelf anywhere that nobody can reach', async () => {
      await prepareTheComicsShelf()

      await applyRunMove(db, 'nonfiction', 3, new Date().toISOString())

      /*
       * The one state #420 says must not exist: a plank off a face with nothing
       * standing on it. A plank off a face with books on it is reachable, on the
       * piece's own page and in the carry list, and is what a move leaves the
       * bookcase it emptied.
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
     * The other half of "a rule pointing at an unreachable area is its own
     * defect": a move must not create one, and neither must anything else.
     * Taking the plank out by hand is deliberate and stays (#307), so the rule
     * comes to rest on the piece the plank was on rather than being refused or
     * deleted. It keeps claiming the same books and opens its run one plank up.
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
 * #401: the bookcase that read as empty while fifty books were standing on it.
 *
 * On the owner's own catalogue, in the same second:
 *
 *     GET /api/fixtures  ->  Bookshelf 4 (0 areas, 0 books)
 *     GET /api/carry     ->  46 books, "Bookshelf 4 · A" to "Bookshelf 2 · E"
 *
 * The state is legitimate and it is the one this file already builds: moving a
 * stretch of books off a bookcase retires every one of its areas, because the
 * ledger names them, and nobody has carried a book yet, so every book is still
 * recorded on the areas that were retired. **The carry list was right.** Its
 * read is `areaFaces`, which walks every area there has ever been. The fixture
 * read walked the face, `position >= 0`, and hung the per-area book count off
 * it, so fifty books were counted by nothing that draws furniture.
 *
 * What this holds to is that the two are now one answer rather than two that
 * agree today. Every count below comes from `areasStanding`, which is the only
 * statement left in the app that counts the books standing on an area, and it
 * does not know what a retired area is.
 *
 * **Retiring is untouched and must stay** (#307, #391). The areas are still off
 * the face, still not in `fixture.areas`, still not boundaries, and nothing here
 * deletes one. What changed is that a piece of furniture accounts for the books
 * standing on it whatever became of the area holding them.
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

  it('is the two answers the owner saw, and they are now the same number', async () => {
    const four = await bookcaseFour()
    const work = await outstandingWork(db)
    const carrying = work.trips.reduce((total, trip) => total + trip.books.length, 0)

    // The list that was right, unchanged: fifty books, off bookcase 4's areas.
    expect(carrying).toBe(50)
    expect(work.trips.map((trip) => trip.from)).toEqual(['4A', '4B', '4C'])
    expect(work.trips.map((trip) => trip.to)).toEqual(['3A', '3B', '3C'])

    // The answer that was wrong. Nought areas is still true: they were taken
    // off the face and the face is what `areas` is. Nought books was not.
    expect(four.areas).toEqual([])
    expect(four.books).toBe(carrying)
  })

  it('names the areas that were taken out, with the books standing on each', async () => {
    const four = await bookcaseFour()

    expect(four.gone.map((area) => [area.label, area.books]))
      .toEqual([['4A', 8], ['4B', 20], ['4C', 22]])
    expect(four.gone.every((area) => area.gone)).toBe(true)
    // Off the face and staying off it: nothing here puts one back on the piece.
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
   * The area is off the face, so there is nothing on the piece to take it off.
   * Removing it is refused exactly as it was, which is the half of #307 that
   * this issue must not weaken: the row is pinned by the placements naming it.
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

    // An area nothing is standing on any more is not drawn at all. The row is
    // still there, pinned by the ledger; it is not furniture and not a leftover
    // somebody has to dismiss.
    expect(four.gone.map((area) => area.label)).not.toContain('4A')
  })

  it('leaves the bookcase the books are going to reading as it should', async () => {
    const room = await describeFurniture(db)
    const three = room.fixtures.find((one) => one.position === 3)!

    expect(three.areas.map((area) => area.label)).toEqual(['3A', '3B', '3C'])
    expect(three.gone).toEqual([])
    // Nobody has carried anything, so nothing is standing on it yet, and that
    // is the honest nought: these two zeros are different facts.
    expect(three.books).toBe(0)
  })
})

/**
 * #463: two rules naming one genre, and where the run begins.
 *
 * **The arrangement is legal and stays legal.** #430 item 1 settled that two
 * fixtures claiming one tag is something somebody is entitled to build, so
 * nothing here may become an error, a warning, or a rule quietly ignored.
 *
 * What was not legal was the app answering "where does fiction begin" twice.
 * `bandsOf` took the range's rule with `rules.find`, first row back from a
 * `SELECT` with no `ORDER BY`, and `claim` took it by area-before-fixture, then
 * priority, then id. With one rule per genre the two agree and nothing shows.
 * With two they part company, and then the plank a book is filed onto and the
 * plank the app draws it on are decided by two different rules.
 *
 * Seen live before it was fixed, on `GET /api/books/1/claim` answering
 * `"wanted":{"areaId":3,"label":"2A"}` while `GET /api/shelves?range=fiction`
 * drew the same book in a group labelled `1A`, and `GET /api/misfiles` answered
 * an empty list, which reads as "everything is fine".
 */
describe('two rules naming one genre', () => {
  /**
   * Bookcase 2, one plank, and a second Fiction rule written on that plank.
   *
   * An **area** rule, because that is the half of the ladder `rules.find` could
   * not see: it beats the fixture rule on bookcase 1 outright, whatever order
   * the two come back in.
   */
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

    // Three books, shelved on 1A while the fixture rule was the only Fiction
    // rule. The area rule now claims all three, so 2A is where they belong and
    // 1A is where they physically are: a misfile, which is the answer that
    // sends somebody to carry them, and it was an empty list before #463.
    const drawn = await shelves.layout('fiction')
    expect(drawn).not.toEqual([])
    expect([...new Set(drawn.map((placed) => placed.label))]).toEqual(['2A'])
  })

  it('still stops the run where the next one begins', async () => {
    await writeASecondFictionRule()

    // Non-fiction is on bookcase 4 and nothing has changed about that. Moving
    // fiction's start to bookcase 2 must not let its band reach across it.
    expect((await bandsOf(db)).get('fiction')?.limit).toBe(4)
  })
})
