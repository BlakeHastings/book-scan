/**
 * The books waiting to be carried: where `assigned` disagrees with `placed`.
 * `domain/placement/carry.ts` groups the list into the trips somebody walks.
 *
 * Books move only through `PATCH /api/books/:id/location`. The two writes in
 * this file, `leaveWhereTheyAre` and `putBackOnTheList`, write a `released` row
 * or restore the assignment, never an area, a location or a `placed` row.
 */

import {
  booksOnArea, carryWork, sharedNumberOf,
  type CarryableBook, type CarryWork, type StandingBook,
} from '../domain/placement/carry'
import {
  RestoreAssignmentsHandler, WithdrawAssignmentsHandler,
  type OneTrip, type WithdrawableBook, type WithdrawalReport,
} from '../application/placement/withdraw-assignments'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { areaFaces } from '../infrastructure/shelving/areas'
import { bookCover, shelfImage } from '../shared/shelving'
import { withPhotographs, type PhotographFields } from './photographs'
import type { Db } from './driver'

interface BookRow {
  id: number
  title: string
  author_filing: string
  /** Text, the way the catalogue holds it: "336", "" or "336 pages". */
  pages: string | null
}

type PhotographedRow = BookRow & PhotographFields

/**
 * Which photograph stands in for a spine and which for a cover is decided here
 * by `shelfImage` and `bookCover`, not by this file, so a carry screen and the
 * library cannot disagree about a book. See `src/lib/shelfRow.ts`, which asks
 * the same two questions of the rows the library reads.
 */
const named = (row: PhotographedRow): CarryableBook => {
  const images = {
    front: row.front_image,
    back: row.back_image,
    edge: row.edge_image,
    crops: { front: row.front_crop, back: row.back_crop, edge: row.edge_crop },
  }

  return {
    id: Number(row.id),
    title: row.title,
    authorFiling: row.author_filing ?? '',
    spine: shelfImage(images).name,
    cover: bookCover({ ...images, catalogue: row.cover_image }).name,
  }
}

/**
 * Every book the rules have an opinion about, in shelf order: everything ever
 * placed, plus checked-out books.
 *
 * Reads `catalogued_books` rather than `shelved_books` so a checked-out or
 * withdrawn book is counted as skipped instead of quietly absent. A checked-out
 * book has no `assigned` row (`assignmentFor` never writes one for a book that
 * is not in the house) but is included by state, since it will be placed once
 * it comes back. Withdrawn books are deliberately excluded: they will never be
 * placed again.
 */
async function everyBookTheRulesSee(db: Db): Promise<CarryableBook[]> {
  const rows = await db.all<BookRow>(
    `SELECT b.id, b.title, b.author_filing, b.pages
       FROM catalogued_books b
      WHERE b.state = 'checked_out'
         OR EXISTS (
        SELECT 1 FROM book_placement p WHERE p.book_id = b.id AND p.kind = 'assigned')
      ORDER BY b.sort_key`,
  )
  // One call for the whole list rather than one per book: this is most of the catalogue.
  return (await withPhotographs(db, rows)).map(named)
}

/** What is still to be carried, as the trips it is made of. Writes nothing. */
export async function outstandingWork(db: Db): Promise<CarryWork> {
  const books = await everyBookTheRulesSee(db)
  const where = await areaFaces(db)
  const rows = await new DrizzlePlacementLedger(db).forBooks(books.map((book) => book.id))

  return carryWork(books, rows, where)
}

/**
 * Every book a withdrawal could be about: has an `assigned` or `released` row,
 * so there is something to withdraw or put back. The narrowing alone is not the
 * safety; the handler decides per book whether it is actually outstanding work.
 */
async function everyBookWithAnAnswer(db: Db): Promise<WithdrawableBook[]> {
  const rows = await db.all<{ id: number; sort_key: string }>(
    `SELECT b.id, b.sort_key
       FROM catalogued_books b
      WHERE EXISTS (
        SELECT 1 FROM book_placement p
         WHERE p.book_id = b.id AND p.kind IN ('assigned', 'released'))
      ORDER BY b.sort_key`,
  )
  return rows.map((row) => ({ id: Number(row.id), sortKey: row.sort_key }))
}

/**
 * Leave these books where they stand, and stop asking for them: a trip, or the
 * whole outstanding list when none is named.
 *
 * Writes no area, location or `placed` row; `PATCH /api/books/:id/location`
 * remains the only route that changes where the catalogue thinks a book is.
 * This writes one row per book saying the answer was declined.
 */
export async function leaveWhereTheyAre(
  db: Db,
  trip: OneTrip | null,
  now: string,
): Promise<WithdrawalReport> {
  return new WithdrawAssignmentsHandler(new DrizzlePlacementLedger(db)).handle({
    books: await everyBookWithAnAnswer(db),
    trip,
    actor: 'person',
    now,
  })
}

/** The same in reverse: ask for this work again. */
export async function putBackOnTheList(
  db: Db,
  trip: OneTrip | null,
  now: string,
): Promise<WithdrawalReport> {
  return new RestoreAssignmentsHandler(new DrizzlePlacementLedger(db)).handle({
    books: await everyBookWithAnAnswer(db),
    trip,
    actor: 'person',
    now,
  })
}

export interface TripAtAnArea {
  from: string
  to: string
  fromAreaId: number
  toAreaId: number
  /** See `CarryTrip.sharedNumber`: the walk this screen draws is the same walk. */
  sharedNumber: number | null
  books: StandingBook[]
}

/**
 * One trip, read at the area the books come off: everything standing there in
 * shelf order, split into what is going on this trip and what is staying.
 *
 * Reads `current_area_id` rather than folding the ledger, since it is an index
 * seek and is checked against the ledger on every trip start. Naming the same
 * area for both ends asks what is standing there with nothing going anywhere;
 * that falls out of the ordinary logic rather than being a special case.
 */
export async function tripAtArea(
  db: Db,
  fromAreaId: number,
  toAreaId: number,
): Promise<TripAtAnArea | null> {
  const where = await areaFaces(db)
  const from = where.get(fromAreaId)
  const to = where.get(toAreaId)
  if (!from || !to) return null

  const rows = await db.all<BookRow>(
    `SELECT b.id, b.title, b.author_filing, b.pages
       FROM catalogued_books b
      WHERE b.current_area_id = ?
      ORDER BY b.sort_key`,
    [fromAreaId],
  )

  const books = (await withPhotographs(db, rows)).map(named)
  // Zero means the catalogue never learned a page count; the drawing reads that
  // as "no number" and uses the median width rather than a sliver.
  const pages = new Map(rows.map((row) => [Number(row.id), parseInt(row.pages ?? '', 10) || 0]))
  const ledger = await new DrizzlePlacementLedger(db).forBooks(books.map((book) => book.id))

  return {
    from: from.label,
    to: to.label,
    fromAreaId,
    toAreaId,
    sharedNumber: sharedNumberOf(from, to),
    books: booksOnArea(books, pages, ledger, fromAreaId, toAreaId),
  }
}
