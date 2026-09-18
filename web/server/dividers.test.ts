/**
 * Each case here finds the line the way a person does, by what it says and
 * which heading it sits above, taps it, and then opens the `area` table to see
 * which row actually went and which books actually changed plank.
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

// openTestDatabase may return either backing database, and this file reads
// the furniture tables directly, so its assertions must hold on both.
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

interface AreaRow {
  id: number
  fixture_position: number
  position: number
  starts_at: string
}

/**
 * `a.position >= 0` excludes retired areas, which a removal creates instead of
 * deleting a row the ledger still names. `f.position < 4` stops fiction's run
 * at bookcase 4, where non-fiction's begins (migration `0013`), or fiction's
 * last plank would read as a bookcase break.
 */
const areas = () =>
  db.all<AreaRow>(
    `SELECT a.id, f.position AS fixture_position, a.position, a.starts_at
       FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE a.position >= 0 AND f.position < 4
      ORDER BY f.position, f.id, a.position`,
  )

/**
 * The first plank of a run opens at nothing, so it is not a boundary; each one
 * after it is (hence the `slice(1)` below). A boundary's `kind` is not a stored
 * column: `shelf` means the plank hangs on a bookcase the plank before it did
 * not, computed here from the walk rather than read from a row.
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

const planks = async () =>
  (await areas()).map((area) => `${area.fixture_position}:${area.position}`)

/** A boundary said as this file reads it: its kind, and the book it opens at. */
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
  // The plank, not its name: only the id identifies the place the book was carried to.
  await store.setLocationIn(step.moved.id, result.planks!.to.areaId!)
}

/**
 * Two bookcases, four planks: an area break inside bookcase 1, a bookcase
 * break, and an area break inside bookcase 2.
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

const readingOrder = (drawn: Row[]) =>
  drawn.map((row) => (row.row === 'divider' ? row.notice : row.group.label))

/**
 * Finds the line only by what it says and what it sits above; which separator
 * that turns out to be is the answer under test.
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

describe('a book lent out of an area', () => {
  const idsOf = async (...titles: string[]) => {
    const placed = await shelves.layout('fiction')
    return titles.map((title) => {
      const found = placed.find((one) => one.book.title === title)
      expect(found, `no book called ${title} is on a shelf`).toBeDefined()
      return found!.book.id
    })
  }

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
    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')
    expect((await shelves.removalCost('fiction', line.separatorId)).area).toBe('1B')
  })

  it('keeps the area itself when every book on it is lent', async () => {
    await twoBookcases()
    const out = await idsOf('Fay Ford', 'Gil Gray')

    for (const id of out) await store.setCheckedOut(id!, true)

    expect(readingOrder(libraryRows(await shelves.groups('fiction')))).toEqual(wholeRun)
    // An empty plank is still drawn: the books left the house, the plank did not.
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
  it('takes the plank the line opens off the bookcase, and leaves the bookcase', async () => {
    await twoBookcases()

    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '2A')
    const doomed = (await rows()).find((row) => row.kind === 'shelf')!
    const survivors = (await rows()).filter((row) => row.id !== doomed.id)
    const before = await shelves.layout('fiction')

    await shelves.remove(line.separatorId, { theAreaGoes: true })

    const after = await rows()
    expect(after.map((row) => row.id)).not.toContain(doomed.id)
    expect(await openers()).toEqual(['area@Fay Ford', 'shelf@Hal Hale'])
    expect(await planks()).toEqual(['1:0', '1:1', '2:0'])

    expect(after.map((row) => row.id)).toEqual(survivors.map((row) => row.id))

    expect(after[1]!.starts_at).toBe(doomed.starts_at)

    // `movesSince` compares labels, not planks, so it reports Jo and Kim as
    // moved even though their plank did not change, only its letter did.
    expect(await titlesOf(await shelves.movesSince('fiction', before))).toEqual([
      { title: 'Jo Jones', from: '2B', to: '2A' },
      { title: 'Kim Kent', from: '2B', to: '2A' },
    ])
    expect(await labels()).toEqual([
      '1A', '1A', '1A', '1A', '1A', '1B', '1B', '2A', '2A', '2A', '2A',
    ])

    expect(line.notice).toBe('New bookcase starts here')
  })
})

describe('removing an area boundary', () => {
  it('deletes the area break inside bookcase 1 and leaves the bookcase break', async () => {
    await twoBookcases()

    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')

    const before = await shelves.layout('fiction')
    await shelves.remove(line.separatorId, { theAreaGoes: true })

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

/** These read `book_placement` directly, the way the cases above read `area`. */
describe('removing a boundary records where its books went', () => {
  const assignedTo = async (bookId: number) =>
    (await db.all<{ area_id: number; actor: string; reason: string }>(
      `SELECT area_id, actor, reason FROM book_placement
        WHERE book_id = ? AND kind = 'assigned' ORDER BY id`,
      [bookId],
    ))

  /**
   * Only the rows added since `was`: `fillUp` already writes ledger rows while
   * building the fixture, so the full history would count those too.
   */
  const assignedSince = async (bookId: number, was: Map<number, number>) =>
    (await assignedTo(bookId)).slice(was.get(bookId) ?? 0)

  const asked = async (...ids: number[]) => new Map(await Promise.all(
    ids.map(async (id) => [id, (await assignedTo(id)).length] as const),
  ))

  /** Reads the board's own `areaId` rather than parsing it back out of the label. */
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

    for (const id of [fay, gil]) {
      const rows = await assignedSince(id, was)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.area_id).toBe(absorbing)
      expect(rows[0]!.actor).toBe('rules')
      expect(rows[0]!.reason).toBe('1B was removed')
    }

    // `assigned` rows are written only where the answer differs from where the
    // book already is, so a book the removal was not about gets none.
    expect(await assignedSince(hal, was)).toEqual([])
  })

  it('leaves the plank below alone, so nobody is sent to carry a book that has not moved', async () => {
    await twoBookcases()
    // A third plank on bookcase 2 so there is a row after the one being
    // removed; without it the removed plank would be the tail of its fixture
    // and the two write paths could not be told apart.
    await fillUp('2A', 'area')
    await fillUp('2B', 'area')

    const groups = await shelves.groups('fiction')
    const line = lineAbove(libraryRows(groups), '2B')
    // A boundary's id is the area it opens, so `groups[at + 1]` names its own
    // row without parsing a label.
    const at = groups.findIndex((group) => group.opensWith?.id === line.separatorId)
    const below = groups[at + 1]!.areaId
    const stayed = groups[at + 1]!.books[0]!.book.id
    const wasLabelled = groups[at + 1]!.label

    const rowsBefore = await areas()
    const was = await asked(stayed)
    await shelves.remove(line.separatorId, { theAreaGoes: true })

    const review = await shelves.review('fiction')
    expect(review.misfiles.map((one) => one.book.id)).not.toContain(stayed)
    expect(await assignedSince(stayed, was)).toEqual([])

    expect(rowsBefore.map((row) => row.id)).toContain(line.separatorId)
    expect((await areas()).map((row) => row.id)).not.toContain(line.separatorId)
    expect(await areaOfBoard(wasLabelled)).not.toBe(below)
    expect(await areaOfBoard('2B')).toBe(below)
  })

  /**
   * `review` recomputes from sort order and the furniture; `outstandingWork`
   * folds the ledger. Compares only what each gains after the removal, not the
   * totals, because the `twoBookcases` fixture already leaves an uncarried
   * backlog before this test runs.
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

describe('removing a boundary asks first', () => {
  it('refuses a caller that has not been asked, and leaves the run alone', async () => {
    await twoBookcases()
    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')
    const before = { areas: await areas(), labels: await labels() }

    const refused = await shelves.remove(line.separatorId)

    expect(refused).toEqual({
      ok: false, reason: 'not-assented', areaId: line.separatorId, range: 'fiction',
    })
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
   * A second tap on a screen drawn before the first one landed is a retry, not
   * a new request, so a boundary already gone must stay an `ok` rather than
   * refuse something already done.
   */
  it('does nothing, rather than refusing, for a boundary already gone', async () => {
    await twoBookcases()
    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '1B')

    expect(await shelves.remove(line.separatorId, { theAreaGoes: true }))
      .toEqual({ ok: true, removed: line.separatorId })
    const after = await areas()

    // The retry omits the assent, since the screen sending it does not ask a second time.
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
