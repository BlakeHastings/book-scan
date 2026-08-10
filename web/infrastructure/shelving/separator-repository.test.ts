/**
 * What a boundary change does to the rows.
 *
 * **This file used to read the SQL and never run it.** Through #213 a boundary
 * was a row in `separators`, `add` was one insert and `remove` was one delete,
 * and the claims worth pinning were about the statement text: that the
 * placeholders came out as `?`, and that the insert did not contain the word
 * `default`. A fake `Db` that recorded rather than executed was the only thing
 * that could say either.
 *
 * Since #232 there is no `separators` table and no statement of that shape. Each
 * method reads the range's boundaries out of the areas, applies one change and
 * writes the areas back, so the interesting claim is not what SQL was generated
 * but which rows are on the floor afterwards: which fixture an area hangs on,
 * what it is anchored at, and, above all, whether an area a book has been placed
 * in survived its boundary being removed. A recording fake cannot answer any of
 * those, because every one of them is the database's answer rather than the
 * repository's.
 *
 * So this runs against a real database, like `server/dividers.test.ts` and
 * `areas.test.ts` beside it. A test database arrives with the two runs already
 * standing, seeded by `0013`: fiction on the fixture at position 1 and
 * non-fiction on the one at position 4, each with a single area at position 0
 * anchored at the empty string.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import type { Db } from '../../server/driver'
import { DrizzleSeparatorRepository } from './separator-repository'
import { areasOf, bandOf, boundariesFrom, runAreasOf, type DerivedArea } from './areas'
import type { NewSeparator } from '../../application/shelving/ports'
import type { Separator, SeparatorKind } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

let db: Db
let repository: DrizzleSeparatorRepository

beforeEach(async () => {
  db = await openTestDatabase()
  repository = new DrizzleSeparatorRepository(db)
})

afterAll(closeTestDatabase)

const STAMP = '2026-08-09T00:00:00.000Z'

/**
 * A boundary somebody asked for, as the port states one.
 *
 * `position`, `note` and `createdAt` are still on `NewSeparator` and none of
 * them reaches a row. A boundary's position is where its area sits in the run,
 * so it is derived rather than given, and the two text columns belonged to a
 * table that no longer exists. They are passed as the port asks for them and
 * nothing here reads them back.
 */
const asked = (range: ShelfRange, kind: SeparatorKind, startsAt: string): NewSeparator => ({
  range, kind, startsAt, position: 0, note: '', createdAt: STAMP,
})

/** A boundary said as this file reads one: its kind, its anchor, its ordinal. */
const said = (separators: readonly Separator[]) =>
  separators.map((one) => `${one.kind}@${one.startsAt}#${one.position}`)

/** An area said the way `areas.test.ts` says one: bookcase, plank, anchor. */
const drawn = (areas: readonly DerivedArea[]) =>
  areas.map((one) => `${one.fixturePosition}:${one.position}@${one.startsAt}`)

/** Every area standing on the floor, both runs, in the order a book meets them. */
const furniture = () =>
  db.all<{ fixture: number; position: number; starts_at: string }>(
    `SELECT f.position AS fixture, a.position, a.starts_at
       FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE a.position >= 0
      ORDER BY f.position, f.id, a.position`,
  )

/**
 * The walk and the walk back, checked against the rows they describe.
 *
 * Two claims, and the first is the one a fake database could never make: the
 * areas actually written are the areas `areasOf` says the boundaries imply. The
 * second is the identity `boundariesFrom` owes it, taken over real ids: reading
 * those areas back gives the boundaries they were walked from, so a boundary
 * comes out as the boundary that went in.
 */
async function roundTrips(range: ShelfRange): Promise<void> {
  const boundaries = await repository.inRange(range)
  const band = (await bandOf(db, range))!
  const rows = await runAreasOf(db, range)

  const walked = areasOf(band.start, boundaries)
  expect(drawn(rows)).toEqual(drawn(walked))

  const rebuilt = walked.map((area, at) => ({ ...area, id: rows[at]!.id }))
  expect(boundariesFrom(range, rebuilt)).toEqual(boundaries)
}

/** The id of the area a run begins in, which is furniture and not a boundary. */
async function firstAreaOf(fixture: number): Promise<number> {
  const row = await db.get<{ id: number }>(
    `SELECT a.id FROM area a JOIN fixture f ON f.id = a.fixture_id
      WHERE f.position = ? AND a.position = 0`,
    [fixture],
  )
  return row!.id
}

describe('reading a range', () => {
  it('is empty on a run nobody has cut yet', async () => {
    // One area apiece, and the area a run begins in is not a boundary: it opens
    // at the beginning rather than at a book.
    expect(await repository.inRange('fiction')).toEqual([])
    expect(await repository.inRange('nonfiction')).toEqual([])
  })

  it('derives each kind from the bookcase its area hangs on', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'area', 'd'))
    await repository.add(asked('fiction', 'shelf', 'f'))

    // Nothing wrote a kind down. `area` is an area on the same fixture as the
    // one before it and `shelf` is one on the next fixture, which is exactly
    // what the words mean on the furniture.
    expect(said(await repository.inRange('fiction')))
      .toEqual(['area@b#0', 'area@d#1', 'shelf@f#2'])
  })

  it('puts a boundary where its anchor is, not where it was added', async () => {
    await repository.add(asked('fiction', 'area', 'm'))
    await repository.add(asked('fiction', 'area', 'd'))

    expect(said(await repository.inRange('fiction'))).toEqual(['area@d#0', 'area@m#1'])
  })
})

describe('adding a boundary', () => {
  it('gives a plank break the next area of the same bookcase', async () => {
    await repository.add(asked('fiction', 'area', 'b'))

    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  it('gives a bookcase break a fixture of its own, at its top plank', async () => {
    const before = await db.all<{ position: number }>(
      'SELECT position FROM fixture ORDER BY position',
    )
    expect(before.map((one) => one.position)).toEqual([1, 4])

    await repository.add(asked('fiction', 'shelf', 'd'))

    // A bookcase really is a row: there is a third fixture now, and the new
    // area is the top plank of it rather than the next plank of bookcase 1.
    const after = await db.all<{ position: number }>(
      'SELECT position FROM fixture ORDER BY position',
    )
    expect(after.map((one) => one.position)).toEqual([1, 2, 4])
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 2, position: 0, starts_at: 'd' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
  })

  it('leaves the boundaries of the other range exactly as they were', async () => {
    await repository.add(asked('nonfiction', 'area', 'p'))
    const before = await repository.inRange('nonfiction')

    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'd'))

    // Non-fiction starts on bookcase 4 and fiction has just grown onto bookcase
    // 2, so the two runs still stand one after the other and nothing on the
    // non-fiction shelves moved.
    expect(await repository.inRange('nonfiction')).toEqual(before)
    expect(said(await repository.inRange('fiction'))).toEqual(['area@b#0', 'shelf@d#1'])
  })
})

describe('the areas and the boundaries being two readings of one run', () => {
  it('round-trips what an add wrote', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'd'))
    await repository.add(asked('fiction', 'area', 'f'))
    await repository.add(asked('nonfiction', 'area', 'p'))

    expect(said(await repository.inRange('fiction')))
      .toEqual(['area@b#0', 'shelf@d#1', 'area@f#2'])
    await roundTrips('fiction')
    await roundTrips('nonfiction')
  })

  it('round-trips what a re-anchor wrote', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'd'))

    const [plank] = await repository.inRange('fiction')
    await repository.reanchor(plank!.id, 'c')

    expect(said(await repository.inRange('fiction'))).toEqual(['area@c#0', 'shelf@d#1'])
    await roundTrips('fiction')
  })

  it('round-trips what a removal wrote', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('fiction', 'shelf', 'd'))
    await repository.add(asked('fiction', 'area', 'f'))

    const boundaries = await repository.inRange('fiction')
    await repository.remove(boundaries[1]!.id)

    // The bookcase break went, so what was on bookcase 2 folds back into
    // bookcase 1 and the plank break after it becomes an ordinary one.
    expect(said(await repository.inRange('fiction'))).toEqual(['area@b#0', 'area@f#1'])
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 1, position: 1, starts_at: 'b' },
      { fixture: 1, position: 2, starts_at: 'f' },
      { fixture: 4, position: 0, starts_at: '' },
    ])
    await roundTrips('fiction')
  })
})

describe('removing a boundary whose area a book has been placed in', () => {
  /**
   * A book is placed in an area, and `book_placement.area_id` is
   * `ON DELETE RESTRICT`, so the row cannot go: the ledger is the record of
   * where books have physically been and deleting the furniture it names would
   * lose it. Leaving the area standing is not an option either, because the run
   * is what the boundary list is derived from, so an area still on the fixture's
   * face comes straight back out of `inRange` as a boundary nobody asked for and
   * the removal never happened.
   *
   * So it is retired instead: taken off the face by giving it a negative
   * position, which every read of the furniture filters out, while the row and
   * every placement naming it stay exactly where they are. That is the case this
   * whole file exists for, and it is invisible to any test that does not put a
   * book somewhere first.
   */
  it('retires the area rather than deleting it, and the boundary stops coming back', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    const [boundary] = await repository.inRange('fiction')
    const areaId = boundary!.id

    const book = await db.get<{ id: number }>(
      `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state)
       VALUES ('A Shelved Book', 'fiction', 'B', ?, 'shelved') RETURNING id`,
      [STAMP],
    )
    await db.run(
      `INSERT INTO book_placement (book_id, kind, area_id, sort_key, actor, reason, created_at)
       VALUES (?, 'placed', ?, 'B', 'person', '', ?)`,
      [book!.id, areaId, STAMP],
    )

    await repository.remove(areaId)

    // Gone as far as anything reading the shelves is concerned.
    expect(await repository.inRange('fiction')).toEqual([])
    expect(await furniture()).toEqual([
      { fixture: 1, position: 0, starts_at: '' },
      { fixture: 4, position: 0, starts_at: '' },
    ])

    // And still there, off the face, with the placement that pinned it intact.
    const retired = await db.get<{ position: number }>(
      'SELECT position FROM area WHERE id = ?',
      [areaId],
    )
    expect(retired?.position).toBeLessThan(0)
    const placement = await db.get<{ area_id: number }>(
      'SELECT area_id FROM book_placement WHERE book_id = ?',
      [book!.id],
    )
    expect(placement?.area_id).toBe(areaId)
  })

  it('deletes the area outright when no book was ever placed in it', async () => {
    // The contrast that makes the retirement a decision rather than the only
    // thing this code can do. Nothing names this area, so nothing keeps it.
    await repository.add(asked('fiction', 'area', 'b'))
    const [boundary] = await repository.inRange('fiction')

    await repository.remove(boundary!.id)

    expect(await repository.inRange('fiction')).toEqual([])
    const found = await db.all<{ id: number }>('SELECT id FROM area WHERE id = ?', [boundary!.id])
    expect(found).toEqual([])
  })
})

describe('which range a boundary is in', () => {
  it('names it, and answers nothing for an id that is not a boundary', async () => {
    await repository.add(asked('fiction', 'area', 'b'))
    await repository.add(asked('nonfiction', 'area', 'p'))

    const [fiction] = await repository.inRange('fiction')
    const [nonfiction] = await repository.inRange('nonfiction')
    expect(await repository.rangeOf(fiction!.id)).toBe('fiction')
    expect(await repository.rangeOf(nonfiction!.id)).toBe('nonfiction')

    // The area a run begins in is a real row with a real id and is furniture
    // rather than a boundary, so it is the sharp case: an id that exists and
    // names nothing anybody can remove.
    expect(await repository.rangeOf(await firstAreaOf(1))).toBeUndefined()
    expect(await repository.rangeOf(await firstAreaOf(4))).toBeUndefined()
    expect(await repository.rangeOf(999_999)).toBeUndefined()
  })
})
