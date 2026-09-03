/**
 * The boundary lines the library draws, and what Remove on one of them does
 * to the database.
 *
 * This is the dangerous half of #145 and it is asserted here rather than on a
 * screen. The visible fault was that every line named the heading above it;
 * the fault that moved books was that the line's Remove deleted a different
 * boundary from the one it named, so somebody was told to carry four books to
 * planks they did not belong on. A test that only read the rendered labels
 * would have passed throughout the defect's life, because both halves were
 * wrong in the same direction and each looked self-consistent alone.
 *
 * So each case here finds the line the way a person does, by what it says and
 * which heading it sits above, taps it, and then opens the `area` table to see
 * which row actually went and which books actually changed plank. That was the
 * `separators` table until #232; a boundary is an area now, the one it opens,
 * and the rows it is judged on are the furniture's.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { Shelves, type ShelvedBook } from './shelves'
import { Store } from './store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { libraryRows, plankAt, type LibraryRow, type ShelfGroup } from '../shared/layout'
import { FICTION_SLUG } from '../domain/tagging/catalogue-claims'
import { outstandingWork } from './carry'

let db: Db
let store: Store
let shelves: Shelves

// Both databases, since stage F. Nothing below knows which. See testdb.ts.
// This file reads the furniture tables directly, and which row actually went
// is exactly the kind of claim that has to hold on the database being shipped.
beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db, new DrizzleAuthorRepository(db))
  shelves = new Shelves(db)
})

afterAll(closeTestDatabase)

/** Surnames in alphabetical order, so filing order is the order they are added. */
const NAMES = [
  'Ann Author', 'Bob Baker', 'Cal Church', 'Dee Dunn', 'Eve East', 'Fay Ford',
  'Gil Gray', 'Hal Hale', 'Ida Innes', 'Jo Jones', 'Kim Kent',
]

const labels = async () => (await shelves.layout('fiction')).map((p) => p.label)

/** One plank of the fiction run as the tables hold it. */
interface AreaRow {
  id: number
  fixture_position: number
  position: number
  starts_at: string
}

/**
 * Every plank of the fiction run, in the order a person walking it meets them.
 *
 * Read through the same `Db` the stores use, so this asserts against the rows
 * the shipping driver returns rather than reaching past it to better-sqlite3.
 *
 * `a.position >= 0` is what keeps a retired area out, which is what an area a
 * removal could not delete becomes: the ledger names it, so the row stays and
 * comes off the fixture's face instead. `f.position < 4` is where fiction's run
 * stops, because bookcase 4 is where non-fiction's begins (migration `0013`),
 * and its first plank would otherwise read as a bookcase break.
 */
const areas = () =>
  db.all<AreaRow>(
    `SELECT a.id, f.position AS fixture_position, a.position, a.starts_at
       FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE a.position >= 0 AND f.position < 4
      ORDER BY f.position, f.id, a.position`,
  )

/**
 * The boundaries those planks cut the run into, which is what a removal is
 * judged on.
 *
 * The first plank of a run opens at nothing and is therefore not a boundary;
 * each one after it is. A boundary's kind is not stored and never was a fact of
 * its own: `shelf` means the plank hangs on a bookcase the plank before it did
 * not, so it is read off the walk here rather than out of a column.
 */
type SeparatorRow = { id: number; kind: string; starts_at: string; position: number }

const rows = async (): Promise<SeparatorRow[]> => {
  const run = await areas()
  return run.slice(1).map((area, at) => ({
    id: area.id,
    kind: area.fixture_position > run[at]!.fixture_position ? 'shelf' : 'area',
    starts_at: area.starts_at,
    position: at,
  }))
}

/** Each plank said as the bookcase it hangs on and its number along it. */
const planks = async () =>
  (await areas()).map((area) => `${area.fixture_position}:${area.position}`)

/**
 * A boundary said as this file reads it: its kind, and the book it opens at.
 *
 * In the order a person walking the shelves meets them, which `rows` is already
 * in. It used to need a sort by anchor: `separators.position` recorded the order
 * boundaries were created in, so a bookcase break made after the plank break
 * beyond it sat earlier on the furniture than it did in the table. A boundary is
 * a plank now, and a plank's place in the run is the walk.
 */
const openers = async () => {
  const placed = await shelves.layout('fiction')
  return (await rows()).map((row) => {
    const at = placed.find((p) => p.book.sort_key === row.starts_at)
    return `${row.kind}@${at?.book.title ?? row.starts_at}`
  })
}

/**
 * Say a plank is full and record where the displaced book went, which is the
 * only way a boundary comes into existence in this app.
 */
const fillUp = async (label: string, kind: 'area' | 'shelf') => {
  const result = await shelves.overflow('fiction', plankAt(label)!, kind)
  expect(result.ok, `filling ${label} failed: ${result.error ?? ''}`).toBe(true)
  const step = result.step!
  // The plank, not its name: what the person is told to carry the book to is a
  // place, and only the id says which place that is (#359).
  await store.setLocationIn(step.moved.id, result.planks!.to.areaId!)
}

/**
 * Two bookcases, four planks, arrived at the way the app arrives at them.
 *
 * Leaves the arrangement #145 was reported against: an area break inside
 * bookcase 1, a bookcase break, and an area break inside bookcase 2.
 */
async function twoBookcases() {
  for (const name of NAMES) {
    await store.addBook({ title: name, authors: [name], genre: FICTION_SLUG })
  }

  for (let i = 0; i < 6; i += 1) await fillUp('1A', 'area')
  await fillUp('1B', 'area')
  await fillUp('1B', 'area')
  await fillUp('1B', 'shelf')
  await fillUp('1B', 'shelf')

  expect(await labels()).toEqual([
    '1A', '1A', '1A', '1A', '1A', '1B', '1B', '2A', '2A', '2B', '2B',
  ])
  expect(await openers())
    .toEqual(['area@Fay Ford', 'shelf@Hal Hale', 'area@Jo Jones'])
}

type Row = LibraryRow<ShelfGroup<ShelvedBook>>

/** The library read down the page: headings and the lines between them. */
const readingOrder = (drawn: Row[]) =>
  drawn.map((row) => (row.row === 'divider' ? row.notice : row.group.label))

/**
 * The line a person taps, found only by what it says and what it sits above.
 *
 * Nothing here knows which separator that is. Which one it turns out to be is
 * the answer under test.
 */
function lineAbove(drawn: Row[], heading: string) {
  const at = drawn.findIndex((row) => row.row === 'shelf' && row.group.label === heading)
  expect(at, `no area labelled ${heading} is drawn`).toBeGreaterThan(0)

  const above = drawn[at - 1]!
  expect(above.row, `nothing is drawn between ${heading} and the area before it`)
    .toBe('divider')
  return above as Extract<Row, { row: 'divider' }>
}

describe('the lines drawn between areas', () => {
  it('puts each one above the heading it names', async () => {
    await twoBookcases()

    expect(readingOrder(libraryRows(await shelves.groups('fiction')))).toEqual([
      '1A',
      'New area starts here', '1B',
      'New bookcase starts here', '2A',
      'New area starts here', '2B',
    ])
  })
})

/**
 * The screen that manages the furniture, while a book is out of the house.
 *
 * **Lending a book is not a fact about the room** (#457). A boundary is a plank
 * somebody screwed in and an area is a place they decided to have, and neither
 * moves because a book left the house for a fortnight. The hunt that found this
 * lent one book, watched a `Remove` control disappear, pressed the only one
 * left, and it belonged to a boundary two areas away.
 *
 * Both failures came out of one habit: `groupByShelf` emits a board per **run of
 * books**, and pairs a boundary to a board by comparing the boundary's anchor
 * with the sort key of that board's first book. A checked-out book is absent
 * from `shelved_books`, so lending the book an anchor names unpairs the
 * boundary, and lending the last book on a plank takes the plank off the one
 * screen that exists to manage planks.
 *
 * Asserted here rather than on the screen for the same reason the rest of this
 * file is: what a person taps has to be the boundary the row names, and reading
 * the drawn labels alone would pass while both halves were wrong together.
 */
describe('a book lent out of an area', () => {
  /** The ids of books on the shelves, by title, before anything is lent. */
  const idsOf = async (...titles: string[]) => {
    const placed = await shelves.layout('fiction')
    return titles.map((title) => {
      const found = placed.find((one) => one.book.title === title)
      expect(found, `no book called ${title} is on a shelf`).toBeDefined()
      return found!.book.id
    })
  }

  /**
   * The reading this screen owes whatever is lent: four planks and three lines,
   * each above the plank it opens.
   */
  const wholeRun = [
    '1A',
    'New area starts here', '1B',
    'New bookcase starts here', '2A',
    'New area starts here', '2B',
  ]

  it('keeps the line that opens an area when its first book is lent', async () => {
    await twoBookcases()
    const [fay] = await idsOf('Fay Ford')

    await store.setCheckedOut(fay!, true)

    expect(readingOrder(libraryRows(await shelves.groups('fiction')))).toEqual(wholeRun)
    // And it is still the boundary that opens 1B, which is the half that moved
    // books: the line somebody presses has to take the plank under it.
    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')
    expect((await shelves.removalCost('fiction', line.separatorId)).area).toBe('1B')
  })

  it('keeps the area itself when every book on it is lent', async () => {
    await twoBookcases()
    const out = await idsOf('Fay Ford', 'Gil Gray')

    for (const id of out) await store.setCheckedOut(id!, true)

    expect(readingOrder(libraryRows(await shelves.groups('fiction')))).toEqual(wholeRun)
    // Drawn, and drawn empty. The books are out of the house; the plank is not.
    expect((await shelves.groups('fiction')).map((group) => [group.label, group.books.length]))
      .toEqual([['1A', 5], ['1B', 0], ['2A', 2], ['2B', 2]])
  })

  it('puts the books back on it the moment they are checked in', async () => {
    await twoBookcases()
    const out = await idsOf('Fay Ford', 'Gil Gray')
    for (const id of out) await store.setCheckedOut(id!, true)

    for (const id of out) await store.setCheckedOut(id!, false)

    expect(readingOrder(libraryRows(await shelves.groups('fiction')))).toEqual(wholeRun)
    expect((await shelves.groups('fiction')).map((group) => group.books.length))
      .toEqual([5, 2, 2, 2])
  })
})

describe('removing the bookcase boundary', () => {
  /**
   * **What this used to assert is what #465 found and changed.**
   *
   * Remove on this line used to fold bookcase 2 back into bookcase 1: the
   * boundary list came out one entry shorter, `areasOf` walked it without a
   * bookcase break, and the rows were reconciled by position. So bookcase 1
   * gained two planks it had never had, bookcase 2 was left standing with none
   * on its face, and four books changed plank with nothing written down. That
   * outcome contradicted `docs/shelving.md` in the sentence this act is
   * specified by: "Removing a boundary takes **that area** off the furniture
   * and hands its books to the area in front" — one area, not a bookcase.
   *
   * Both doors go through `dropArea` now, so the plank the line opens is the
   * plank that goes, every row after it keeps its identity, and the piece keeps
   * standing with the planks it really has.
   */
  it('takes the plank the line opens off the bookcase, and leaves the bookcase', async () => {
    await twoBookcases()

    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '2A')
    const doomed = (await rows()).find((row) => row.kind === 'shelf')!
    const survivors = (await rows()).filter((row) => row.id !== doomed.id)
    const before = await shelves.layout('fiction')

    await shelves.remove(line.separatorId, { theAreaGoes: true })

    // At the database: that boundary and no other, and the run is a plank
    // shorter rather than a bookcase shorter.
    const after = await rows()
    expect(after.map((row) => row.id)).not.toContain(doomed.id)
    expect(await openers()).toEqual(['area@Fay Ford', 'shelf@Hal Hale'])
    expect(await planks()).toEqual(['1:0', '1:1', '2:0'])

    // **Every surviving row is the row it was**, which is the half that used to
    // be false. A book recorded on the plank below the removed one is still
    // recorded on that row; what changed is the letter it reads as, and
    // `becomes` is how somebody is told that.
    expect(after.map((row) => row.id)).toEqual(survivors.map((row) => row.id))

    // The plank that came forward took the removed one's anchor, so the books
    // that were on it are the books it now opens at.
    expect(after[1]!.starts_at).toBe(doomed.starts_at)

    // Only Jo and Kim read a different letter, and neither changed row: the
    // books that have to be carried are Hal and Ida, off the plank that went,
    // and they are on the carry list rather than in this diff. See the ledger
    // case below, and note that `movesSince` compares labels rather than
    // planks, which is why it names two books nobody has to move (#465).
    expect(await titlesOf(await shelves.movesSince('fiction', before))).toEqual([
      { title: 'Jo Jones', from: '2B', to: '2A' },
      { title: 'Kim Kent', from: '2B', to: '2A' },
    ])
    expect(await labels()).toEqual([
      '1A', '1A', '1A', '1A', '1A', '1B', '1B', '2A', '2A', '2A', '2A',
    ])

    // Asserted last, and separately: what the line said is the visible half,
    // and the half above is true whether or not anybody reads it.
    expect(line.notice).toBe('New bookcase starts here')
  })
})

describe('removing an area boundary', () => {
  it('deletes the area break inside bookcase 1 and leaves the bookcase break', async () => {
    await twoBookcases()

    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')

    const before = await shelves.layout('fiction')
    await shelves.remove(line.separatorId, { theAreaGoes: true })

    // Bookcase 2 is still bookcase 2: only the plank break went, and it is
    // bookcase 1 that lost a plank. See the note on renumbering above.
    expect(await openers()).toEqual(['shelf@Hal Hale', 'area@Jo Jones'])
    expect(await planks()).toEqual(['1:0', '2:0', '2:1'])
    expect(line.notice).toBe('New area starts here')
    expect(await titlesOf(await shelves.movesSince('fiction', before))).toEqual([
      { title: 'Fay Ford', from: '1B', to: '1A' },
      { title: 'Gil Gray', from: '1B', to: '1A' },
    ])
    expect(await labels()).toEqual([
      '1A', '1A', '1A', '1A', '1A', '1A', '1A', '2A', '2A', '2B', '2B',
    ])
  })

  it('deletes the area break inside bookcase 2, not the bookcase break above it', async () => {
    await twoBookcases()

    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '2B')

    const before = await shelves.layout('fiction')
    await shelves.remove(line.separatorId, { theAreaGoes: true })

    expect(await openers()).toEqual(['area@Fay Ford', 'shelf@Hal Hale'])
    expect(await titlesOf(await shelves.movesSince('fiction', before))).toEqual([
      { title: 'Jo Jones', from: '2B', to: '2A' },
      { title: 'Kim Kent', from: '2B', to: '2A' },
    ])
    expect(line.notice).toBe('New area starts here')
  })
})

/**
 * The ledger, at the act rather than at one of the two doors into it (#465).
 *
 * `DELETE /api/areas/:id` wrote an `assigned` row per book naming the area that
 * took them in, and `DELETE /api/shelves/:id` wrote none, for the same act. Two
 * things followed from that, and both are asserted here rather than described:
 * the books on the plank that went were left with no record of where they now
 * belong, and the plank *after* the removed one was the row that got retired,
 * so a book nobody had to carry anywhere was reported as a trip.
 *
 * These read `book_placement` directly, the way the cases above read `area`.
 * What a route answers is somebody else's test; what is pinned here is what is
 * written down, because that is the half that outlives the request.
 */
describe('removing a boundary records where its books went', () => {
  /** Every `assigned` row this book has, newest last, as area ids. */
  const assignedTo = async (bookId: number) =>
    (await db.all<{ area_id: number; actor: string; reason: string }>(
      `SELECT area_id, actor, reason FROM book_placement
        WHERE book_id = ? AND kind = 'assigned' ORDER BY id`,
      [bookId],
    ))

  /**
   * What the removal added, rather than what the book has ever been asked.
   *
   * `fillUp` says a plank is full, and since #487 that act records where the
   * run then puts the book it pushed along, exactly as this act does — so the
   * fixture no longer arrives with an empty ledger and the claim below has to
   * be about the delta. It is the same claim: these cases are about what
   * removing a boundary writes, and the rows a full plank wrote earlier belong
   * to a different act that has already been carried out and recorded.
   */
  const assignedSince = async (bookId: number, was: Map<number, number>) =>
    (await assignedTo(bookId)).slice(was.get(bookId) ?? 0)

  /** How many answers each of these books already has, before the act. */
  const asked = async (...ids: number[]) => new Map(await Promise.all(
    ids.map(async (id) => [id, (await assignedTo(id)).length] as const),
  ))

  /**
   * The plank a board is drawn on, taken off the board (#469).
   *
   * Found by what the board says, the way every case in this file finds the line
   * a person taps, and then read as a row. What it does not do is parse that
   * label back into a bookcase and a plank: since #469 a board carries the area
   * it is drawn on, so the identity is there to be asked for, and #447 closed
   * the last place in the app that recovered one from a rendered string.
   */
  const areaOfBoard = async (label: string) =>
    (await shelves.groups('fiction')).find((group) => group.label === label)?.areaId ?? null

  const bookNamed = async (title: string) =>
    (await shelves.layout('fiction')).find((placed) => placed.book.title === title)!.book.id

  it('writes an assigned row per book, naming the area that took them in', async () => {
    await twoBookcases()

    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')
    const absorbing = await areaOfBoard('1A')
    const fay = await bookNamed('Fay Ford')
    const gil = await bookNamed('Gil Gray')
    const hal = await bookNamed('Hal Hale')

    const was = await asked(fay, gil, hal)

    await shelves.remove(line.separatorId, { theAreaGoes: true })

    // The two books that were standing on the plank that went, and the area
    // that took them in, said as a row rather than as a label.
    for (const id of [fay, gil]) {
      const rows = await assignedSince(id, was)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.area_id).toBe(absorbing)
      expect(rows[0]!.actor).toBe('rules')
      expect(rows[0]!.reason).toBe('1B was removed')
    }

    // And nothing for a book the removal was not about. `assigned` rows are
    // written only where the answer differs from where the book already is,
    // which is `assignmentFor`, and writing one for every book in the range
    // would make the ledger useless as history.
    expect(await assignedSince(hal, was)).toEqual([])
  })

  /**
   * The trip nobody had to walk, which is what this defect actually cost.
   *
   * The boundary list rewrite retired the **last** row of the run and left
   * every row between the removal and the end holding an id that had come to
   * mean a different plank. So the book on the plank below the removed one was
   * recorded on a row it was no longer standing on, and the shelving review
   * read that as a book to carry. Nobody had to carry it: its plank simply
   * reads a letter earlier now, which is what `becomes` is for.
   */
  it('leaves the plank below alone, so nobody is sent to carry a book that has not moved', async () => {
    await twoBookcases()
    // A third plank on bookcase 2, so there is a row *after* the one being
    // removed and still on its piece. Without it the removed plank is the tail
    // of its fixture and the two write paths cannot be told apart.
    await fillUp('2A', 'area')
    await fillUp('2B', 'area')

    const groups = await shelves.groups('fiction')
    const line = lineAbove(libraryRows(groups), '2B')
    // The plank below the one that is going, and a book standing on it. A
    // boundary's id is the area it opens, so the group after this one names its
    // own row without anything here parsing a label.
    const at = groups.findIndex((group) => group.opensWith?.id === line.separatorId)
    const below = groups[at + 1]!.areaId
    const stayed = groups[at + 1]!.books[0]!.book.id
    const wasLabelled = groups[at + 1]!.label

    const rowsBefore = await areas()
    const was = await asked(stayed)
    await shelves.remove(line.separatorId, { theAreaGoes: true })

    // Nobody is asked to carry it, and nothing claims it belongs elsewhere.
    // This is the assertion the issue is about; the two below it are the
    // mechanism that makes it true.
    const review = await shelves.review('fiction')
    expect(review.misfiles.map((one) => one.book.id)).not.toContain(stayed)
    expect(await assignedSince(stayed, was)).toEqual([])

    // The row that went is the one the line opened, and the row below it is
    // still the row it was: same id, one letter earlier.
    expect(rowsBefore.map((row) => row.id)).toContain(line.separatorId)
    expect((await areas()).map((row) => row.id)).not.toContain(line.separatorId)
    expect(await areaOfBoard(wasLabelled)).not.toBe(below)
    expect(await areaOfBoard('2B')).toBe(below)
  })

  /**
   * The work a removal makes reaches both lists, which is #458.
   *
   * A hunting pass found the library saying "Needs attention (2)" while the
   * first screen said "0 to carry" and the carry screen said "Every book is
   * where the rules want it", straight after a boundary removal. The two are
   * different reads by design — `review` recomputes from sort order and the
   * furniture, `outstandingWork` folds the ledger — and only the first could see
   * a removal, because the removal wrote nothing for the second to fold. That is
   * not two screens to reconcile; it is one missing write.
   *
   * **The delta, not the two totals**, and the difference matters. The lists are
   * not the same list and are not meant to be: the review catches a book whose
   * plank changed under it for any reason, the carry list holds what the rules
   * have asked for and nobody has done. Asserting they match whole would pin
   * this fixture's own backlog — `twoBookcases` leaves Jo Jones and Kim Kent
   * recorded on `1C` and derived onto `2B`, uncarried, before this test touches
   * anything. What #458 is about is a removal adding to one and not the other.
   *
   * The sets, not the counts: two lists of one that name different books agree
   * on a number and on nothing else.
   */
  it('puts the books a removal moves on both the review and the carry list', async () => {
    await twoBookcases()

    const reviewed = async () =>
      (await shelves.review('fiction')).misfiles.map((one) => one.book.id)
    const carrying = async () =>
      (await outstandingWork(db)).trips.flatMap((trip) => trip.books.map((book) => book.id))

    const wasReviewed = new Set(await reviewed())
    const wasCarrying = new Set(await carrying())

    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')
    await shelves.remove(line.separatorId, { theAreaGoes: true })

    const addedToReview = (await reviewed()).filter((id) => !wasReviewed.has(id))
    const addedToCarry = (await carrying()).filter((id) => !wasCarrying.has(id))

    expect(addedToReview.length).toBeGreaterThan(0)
    expect([...addedToCarry].sort()).toEqual([...addedToReview].sort())
  })
})

/**
 * The assent, at the act rather than at any of the three doors into it (#456).
 *
 * Every case here goes through `Shelves.remove`, which is one line over
 * `RemoveSeparatorHandler`, because that is where the rule now lives. The route
 * and the boundary move are tested where they are; what is pinned here is that
 * the act itself will not do this for a caller that has not been asked, however
 * it is reached and whoever writes the next caller.
 */
describe('removing a boundary asks first', () => {
  it('refuses a caller that has not been asked, and leaves the run alone', async () => {
    await twoBookcases()
    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')
    const before = { areas: await areas(), labels: await labels() }

    const refused = await shelves.remove(line.separatorId)

    expect(refused).toEqual({
      ok: false, reason: 'not-assented', areaId: line.separatorId, range: 'fiction',
    })
    // Every plank still there, still anchored at the same book, and every book
    // still on the plank it was on. Nothing was written and rolled back: the
    // refusal happens before the statement.
    expect(await areas()).toEqual(before.areas)
    expect(await labels()).toEqual(before.labels)
  })

  it('will not be talked into it by anything but the word', async () => {
    await twoBookcases()
    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')
    const before = await areas()

    for (const said of [undefined, false]) {
      // The shape a caller reaches for when it is trying to satisfy a
      // parameter rather than answer a question.
      const answer = await shelves.remove(
        line.separatorId,
        said === undefined ? undefined : { theAreaGoes: said },
      )
      expect(answer.ok, `theAreaGoes: ${String(said)} was taken as assent`).toBe(false)
    }

    expect(await areas()).toEqual(before)
  })

  /**
   * The idempotence the handler's own header promises, kept across the change.
   *
   * A boundary somebody else has already removed comes back missing and the act
   * does nothing. That has to stay an `ok`: a second tap on a screen drawn
   * before the first one landed is a retry, and turning a retry into an error
   * puts a refusal in front of somebody for a thing that is already done.
   */
  it('does nothing, rather than refusing, for a boundary already gone', async () => {
    await twoBookcases()
    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')

    expect(await shelves.remove(line.separatorId, { theAreaGoes: true }))
      .toEqual({ ok: true, removed: line.separatorId })
    const after = await areas()

    // The retry, and it does not carry the assent, because the screen that
    // sends it has not asked anybody a second time.
    expect(await shelves.remove(line.separatorId)).toEqual({ ok: true, removed: null })
    expect(await areas()).toEqual(after)
  })
})

/** Moves said as books, because a list of row ids proves nothing to a reader. */
async function titlesOf(moves: { id: number; from: string; to: string }[]) {
  const placed = await shelves.layout('fiction')
  return moves.map((move) => ({
    title: placed.find((p) => p.book.id === move.id)?.book.title ?? `#${move.id}`,
    from: move.from,
    to: move.to,
  }))
}
