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

describe('removing the bookcase boundary', () => {
  it('deletes the row that starts the bookcase named beneath it', async () => {
    await twoBookcases()

    const line = lineAbove(libraryRows(await shelves.groups('fiction')), '2A')
    const doomed = (await rows()).find((row) => row.kind === 'shelf')!
    const survivors = (await rows()).filter((row) => row.id !== doomed.id)
    const before = await shelves.layout('fiction')

    await shelves.remove(line.separatorId, { theAreaGoes: true })

    // At the database: that boundary and no other, still opening at the books
    // they opened at.
    const after = await rows()
    expect(after.map((row) => row.id)).not.toContain(doomed.id)
    expect(after.map((row) => row.starts_at)).toEqual(survivors.map((row) => row.starts_at))
    expect(await openers()).toEqual(['area@Fay Ford', 'area@Jo Jones'])

    // Only the first surviving row is the row it was, and that is genuinely
    // different since #232: a boundary is the plank it opens, so folding
    // bookcase 2 back into bookcase 1 moves the boundary below the removed one
    // onto a plank of bookcase 1, which is another row. What it opens at is the
    // fact that has to survive, and it does, above.
    expect(after[0]!.id).toBe(survivors[0]!.id)
    expect(after[1]!.id).not.toBe(survivors[1]!.id)

    // The old assertion here was that `separators.position` was renumbered so
    // the column stayed contiguous. A boundary's position is where its plank
    // sits in the run now, so it is contiguous by construction and there is
    // nothing left to renumber (see DrizzleSeparatorRepository). What can still
    // go wrong is the furniture underneath: a bookcase numbers its planks from
    // zero without a gap, or a label names a plank that is not there.
    expect(await planks()).toEqual(['1:0', '1:1', '1:2'])

    // And exactly these books changed plank. The bookcase break is gone, so
    // bookcase 2 folds back into bookcase 1 and every plank past it shifts one
    // letter earlier. Nothing on 1A or 1B moved at all.
    const moved = await shelves.movesSince('fiction', before)
    expect(await titlesOf(moved)).toEqual([
      { title: 'Hal Hale', from: '2A', to: '1B' },
      { title: 'Ida Innes', from: '2A', to: '1B' },
      { title: 'Jo Jones', from: '2B', to: '1C' },
      { title: 'Kim Kent', from: '2B', to: '1C' },
    ])
    expect(await labels()).toEqual([
      '1A', '1A', '1A', '1A', '1A', '1B', '1B', '1B', '1B', '1C', '1C',
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
      ok: false, areaId: line.separatorId, range: 'fiction',
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
