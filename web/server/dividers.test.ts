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
 * which heading it sits above, taps it, and then opens the `separators` table
 * to see which row actually went and which books actually changed plank.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from './testdb'
import type { Db } from './driver'
import { Shelves, type ShelvedBook } from './shelves'
import { Store } from './store'
import { libraryRows, type LibraryRow, type ShelfGroup } from '../shared/layout'

let db: Db
let store: Store
let shelves: Shelves

// Both databases, since stage F. Nothing below knows which. See testdb.ts.
// This file reads the separators table directly, and which row actually went
// is exactly the kind of claim that has to hold on the database being shipped.
beforeEach(async () => {
  db = await openTestDatabase()
  store = new Store(db)
  shelves = new Shelves(db)
})

afterAll(closeTestDatabase)

/** Surnames in alphabetical order, so filing order is the order they are added. */
const NAMES = [
  'Ann Author', 'Bob Baker', 'Cal Church', 'Dee Dunn', 'Eve East', 'Fay Ford',
  'Gil Gray', 'Hal Hale', 'Ida Innes', 'Jo Jones', 'Kim Kent',
]

const labels = async () => (await shelves.layout('fiction')).map((p) => p.label)

/**
 * Every separator as the table holds it, which is what a removal is judged on.
 *
 * Read through the same `Db` the stores use, so this asserts against the rows
 * the shipping driver returns rather than reaching past it to better-sqlite3.
 */
type SeparatorRow = { id: number; kind: string; starts_at: string; position: number }

const rows = () =>
  db.all<SeparatorRow>(
    'SELECT id, kind, starts_at, position FROM separators ORDER BY position ASC',
  )

/**
 * A separator said as this file reads it: its kind, and the book it opens at.
 *
 * In the order a person walking the shelves meets them, which is the order of
 * the anchors, not of the `position` column. Positions record the order the
 * boundaries were created in, and a bookcase break made after the plank break
 * beyond it sits earlier on the furniture than it does in the table.
 */
const openers = async () => {
  const placed = await shelves.layout('fiction')
  return [...(await rows())]
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0))
    .map((row) => {
      const at = placed.find((p) => p.book.sort_key === row.starts_at)
      return `${row.kind}@${at?.book.title ?? row.starts_at}`
    })
}

/**
 * Say a plank is full and record where the displaced book went, which is the
 * only way a boundary comes into existence in this app.
 */
const fillUp = async (label: string, kind: 'area' | 'shelf') => {
  const result = await shelves.overflow('fiction', label, kind)
  expect(result.ok, `filling ${label} failed: ${result.error ?? ''}`).toBe(true)
  const step = result.step!
  await store.setLocation(step.moved.id, step.to)
}

/**
 * Two bookcases, four planks, arrived at the way the app arrives at them.
 *
 * Leaves the arrangement #145 was reported against: an area break inside
 * bookcase 1, a bookcase break, and an area break inside bookcase 2.
 */
async function twoBookcases() {
  for (const name of NAMES) {
    await store.addBook({ title: name, authors: [name], isFiction: true })
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

    await shelves.remove(line.separatorId)

    // At the database: that row and no other, with the rest renumbered so the
    // positions stay contiguous.
    const after = await rows()
    expect(after.map((row) => row.id)).toEqual(survivors.map((row) => row.id))
    expect(after.map((row) => row.starts_at)).toEqual(survivors.map((row) => row.starts_at))
    expect(after.map((row) => row.position)).toEqual([0, 1])
    expect(await openers()).toEqual(['area@Fay Ford', 'area@Jo Jones'])

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
    await shelves.remove(line.separatorId)

    // Bookcase 2 is still bookcase 2: only the plank break went, and the two
    // boundaries left behind are renumbered from zero.
    expect(await openers()).toEqual(['shelf@Hal Hale', 'area@Jo Jones'])
    expect((await rows()).map((row) => row.position)).toEqual([0, 1])
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
    await shelves.remove(line.separatorId)

    expect(await openers()).toEqual(['area@Fay Ford', 'shelf@Hal Hale'])
    expect(await titlesOf(await shelves.movesSince('fiction', before))).toEqual([
      { title: 'Jo Jones', from: '2B', to: '2A' },
      { title: 'Kim Kent', from: '2B', to: '2A' },
    ])
    expect(line.notice).toBe('New area starts here')
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
