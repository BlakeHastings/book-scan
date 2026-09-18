/**
 * The third opinion, put through the acts that made it necessary.
 *
 * Every test here builds the state out of rows and then asks both checks,
 * because the claim being made is a claim about the pair: the projection
 * agrees with the ledger, and the two of them are wrong about the
 * furniture together. A test of this check alone would prove it says
 * something without proving the thing it is for, which is that the check
 * beside it says nothing.
 *
 * A book moved within a run that still exists is deliberately not tested
 * here: the plank the ledger names is still on the face, so this check is
 * right to stay quiet. That comparison is `Shelves.review`, and the header
 * of `stranded.ts` says why repeating it here would be wrong.
 *
 * Nothing in this file connects to anything but a scratch database it made.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/driver'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { countProjectionDisagreements } from './projection'
import { countStrandedBooks, describeStranding, strandedBooks } from './stranded'

let db: Db

beforeEach(async () => {
  db = await openTestDatabase()
})

afterAll(async () => {
  await closeTestDatabase()
}, 60_000)

/** A bookcase of this collection's, high enough not to sit in either run. */
async function aPiece(position: number, name = ''): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
     SELECT id, 'bookshelf', ?, ?, 'inherit', '' FROM collection ORDER BY id LIMIT 1
     RETURNING id`,
    [name, position],
  )
  expect(row, 'no collection to hang a bookcase off').toBeDefined()
  return Number(row!.id)
}

/** A plank on it, at the ordinal a person reads as a letter. */
async function aPlank(fixtureId: number, position: number, name = ''): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
     VALUES (?, ?, ?, '', 'inherit', '') RETURNING id`,
    [fixtureId, position, name],
  )
  return Number(row!.id)
}

/**
 * A book somebody put on that plank and recorded properly. Both halves
 * written, because the state this file is about is the one where both are
 * right and both are stale.
 */
async function aBookOn(areaId: number, title: string, kind = 'placed'): Promise<number> {
  const book = await db.get<{ id: number }>(
    `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state, current_area_id)
     VALUES (?, 'fiction', ?, '2026-09-06T00:00:00.000Z', 'shelved', ?) RETURNING id`,
    [title, title.toUpperCase(), areaId],
  )
  await db.run(
    `INSERT INTO book_placement (book_id, kind, area_id, sort_key, actor, reason, created_at)
     VALUES (?, ?, ?, ?, 'person', '', '2026-09-06T00:00:00.000Z')`,
    [book!.id, kind, areaId, title.toUpperCase()],
  )
  return Number(book!.id)
}

/** Removing the boundary above a plank takes it off the face (`retireArea`). */
const retirePlank = (areaId: number, was: number) =>
  db.run('UPDATE area SET position = ? WHERE id = ?', [-(was + 1), areaId])

/** Taking a bookcase away leaves its planks where they were (`retireFixture`). */
const retirePiece = (fixtureId: number, was: number) =>
  db.run('UPDATE fixture SET position = ? WHERE id = ?', [-(was + 1), fixtureId])

describe('the plank a book is recorded on, asked of the furniture', () => {
  it('says nothing about a catalogue whose planks are all still up', async () => {
    const piece = await aPiece(7)
    await aBookOn(await aPlank(piece, 2), 'A Book On A Plank That Exists')

    expect(await countStrandedBooks(db)).toBe(0)
    expect(await strandedBooks(db)).toEqual([])
  })

  it('names the book when the boundary above its plank is removed (#465)', async () => {
    const piece = await aPiece(7)
    const plank = await aPlank(piece, 2)
    await aBookOn(plank, 'A Book On A Plank That Went')
    await retirePlank(plank, 2)

    // The check that exists for this family looks straight at it and
    // reports healthy, because the act wrote to neither side it compares.
    expect(await countProjectionDisagreements(db)).toBe(0)

    expect(await countStrandedBooks(db)).toBe(1)
    expect(await strandedBooks(db)).toEqual([{
      bookId: expect.any(Number),
      title: 'A Book On A Plank That Went',
      areaId: plank,
      // `7C`, not `7@`: the stored position is `-(plank + 1)`, and reading
      // the negative straight would give an address about a book somebody
      // can go and find.
      recorded: '7C',
      why: 'plank-off-the-face',
    }])
  })

  it('names the book when the whole bookcase is taken away (#484)', async () => {
    const piece = await aPiece(8)
    const plank = await aPlank(piece, 0)
    await aBookOn(plank, 'A Book On A Bookcase That Went')
    await retirePiece(piece, 8)

    expect(await countProjectionDisagreements(db)).toBe(0)

    // The plank's own position is untouched: `retireFixture` leaves it be,
    // since it is the floor under it that went.
    const found = await strandedBooks(db)
    expect(found).toHaveLength(1)
    expect(found[0]!.why).toBe('piece-off-the-floor')
    expect(found[0]!.recorded).toBe('8A')
  })

  it('reads the piece by its name, because a label is not an address (#356)', async () => {
    const piece = await aPiece(9, 'Hall shelf')
    const plank = await aPlank(piece, 1)
    await aBookOn(plank, 'A Book On A Named Piece')
    await retirePlank(plank, 1)

    expect((await strandedBooks(db))[0]!.recorded).toBe('Hall shelf · B')
  })

  it('says nothing about a book the ledger has taken off every plank', async () => {
    // A checked-out book is nowhere, so there is no plank for it to be
    // stranded on. That falls out of the fold rather than being
    // special-cased here.
    const piece = await aPiece(7)
    const plank = await aPlank(piece, 2)
    const book = await aBookOn(plank, 'A Book In Somebody Bag')
    await db.run(
      `INSERT INTO book_placement (book_id, kind, area_id, sort_key, actor, reason, created_at)
       VALUES (?, 'checked_out', NULL, '', 'person', '', '2026-09-06T01:00:00.000Z')`,
      [book],
    )
    await db.run('UPDATE books SET current_area_id = NULL WHERE id = ?', [book])
    await retirePlank(plank, 2)

    expect(await countProjectionDisagreements(db)).toBe(0)
    expect(await countStrandedBooks(db)).toBe(0)
  })

  it('says nothing about an `assigned` row, which is where a book is wanted', async () => {
    // `assigned` is the rules asking for a book to be moved and is never
    // where the book is, so a rule pointing at a retired plank is a
    // different defect. The fold walks past it; this proves the walk-past.
    const piece = await aPiece(7)
    const plank = await aPlank(piece, 2)
    const book = await aBookOn(plank, 'A Book Wanted Somewhere Else')
    const wanted = await aPlank(piece, 3)
    await db.run(
      `INSERT INTO book_placement (book_id, kind, area_id, sort_key, actor, reason, created_at)
       VALUES (?, 'assigned', ?, 'A', 'rules', '', '2026-09-06T01:00:00.000Z')`,
      [book, wanted],
    )
    await retirePlank(wanted, 3)

    expect(await countStrandedBooks(db)).toBe(0)
  })

  it('reports and does not repair, which is #485 standing', async () => {
    const piece = await aPiece(7)
    const plank = await aPlank(piece, 2)
    const book = await aBookOn(plank, 'A Book Nobody May Tidy Away')
    await retirePlank(plank, 2)

    await strandedBooks(db)
    await countStrandedBooks(db)

    // Both sides exactly as they were: a check that quietly put the plank
    // back or moved the book would have hidden the defect indefinitely.
    expect(await db.get<{ position: number }>(
      'SELECT position FROM area WHERE id = ?', [plank],
    )).toEqual({ position: -3 })
    expect(await db.get<{ current_area_id: number }>(
      'SELECT current_area_id FROM books WHERE id = ?', [book],
    )).toEqual({ current_area_id: plank })
  })

  it('bounds what it names and counts all of them, so a log stays readable', async () => {
    const piece = await aPiece(7)
    for (let at = 0; at < 12; at += 1) {
      const plank = await aPlank(piece, at)
      await aBookOn(plank, `Stranded Book ${String(at).padStart(2, '0')}`)
      await retirePlank(plank, at)
    }

    expect(await countStrandedBooks(db)).toBe(12)
    expect(await strandedBooks(db)).toHaveLength(10)
    expect(await strandedBooks(db, 3)).toHaveLength(3)
    // Newest first, which is what a bounded list of a defect's victims wants.
    expect((await strandedBooks(db, 1))[0]!.title).toBe('Stranded Book 11')
  })

  it('says each one in a line a person can act on', async () => {
    const piece = await aPiece(7)
    const plank = await aPlank(piece, 2)
    await aBookOn(plank, 'A Book To Say Out Loud')
    await retirePlank(plank, 2)

    expect(describeStranding((await strandedBooks(db))[0]!))
      .toMatch(/^#\d+ A Book To Say Out Loud: recorded on 7C, and the plank was taken off the face$/)
  })
})

/**
 * The `SET NULL` / `RESTRICT` asymmetry mapped in rows rather than only
 * reasoned about: does a book whose area is gone leave the two halves
 * saying different things? It cannot, and these are the rows that say so.
 */
describe('what the two foreign keys actually allow', () => {
  /**
   * Postgres's own words, quoted rather than paraphrased. It names the
   * setting as well as the constraint: the argument in `stranded.ts` turns
   * on `RESTRICT` being what refuses, and a message naming only the key
   * would be satisfied by a `NO ACTION` deferring to the end of the
   * transaction instead.
   */
  const RESTRICT_REFUSES =
    /violates RESTRICT setting of foreign key constraint "book_placement_area_id_fkey"/

  it('refuses to delete an area the ledger names, so SET NULL never fires', async () => {
    const piece = await aPiece(7)
    const plank = await aPlank(piece, 2)
    const book = await aBookOn(plank, 'A Book Pinning Its Own Plank')

    // `book_placement_area_id_fkey` is ON DELETE RESTRICT, and this is the
    // refusal itself rather than a description of it.
    await expect(db.run('DELETE FROM area WHERE id = ?', [plank]))
      .rejects.toThrow(RESTRICT_REFUSES)

    // The cascade from the piece runs into the same refusal, which is why
    // `retireFixture` exists rather than a delete.
    await expect(db.run('DELETE FROM fixture WHERE id = ?', [piece]))
      .rejects.toThrow(RESTRICT_REFUSES)

    // Untouched by either attempt, so `books.current_area_id`'s ON DELETE
    // SET NULL has nothing to fire on.
    expect(await db.get<{ current_area_id: number }>(
      'SELECT current_area_id FROM books WHERE id = ?', [book],
    )).toEqual({ current_area_id: plank })
  })

  it('nulls the column only for a book with no ledger row, which is nowhere anyway', async () => {
    // The one way SET NULL can be reached: a projection naming an area no
    // ledger row does. Either way this check has nothing to fold and stays
    // quiet, since a book with no placement row is not recorded anywhere.
    const piece = await aPiece(7)
    const plank = await aPlank(piece, 2)
    await db.run(
      `INSERT INTO books (title, shelf_range, sort_key, scanned_at, state, current_area_id)
       VALUES ('A Book With A Column And No Rows', 'fiction', 'A', ?, 'shelved', ?)`,
      ['2026-09-06T00:00:00.000Z', plank],
    )

    expect(await countProjectionDisagreements(db)).toBe(1)
    expect(await countStrandedBooks(db)).toBe(0)

    await db.run('DELETE FROM area WHERE id = ?', [plank])

    expect(await db.get<{ current_area_id: number | null }>(
      'SELECT current_area_id FROM books WHERE title = ?',
      ['A Book With A Column And No Rows'],
    )).toEqual({ current_area_id: null })
    expect(await countProjectionDisagreements(db)).toBe(0)
    expect(await countStrandedBooks(db)).toBe(0)
  })
})
