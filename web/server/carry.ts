/**
 * The books that are waiting to be carried, read out of the ledger.
 *
 * ## Why the routes that already exist could not answer this
 *
 * `POST /api/placement/run/plan` and `POST /api/placement/run` answer a
 * question about the future: *if* the non-fiction moved to bookcase 3, what
 * would have to be carried. They take a target bookcase, run the rules over an
 * arrangement that does not exist yet, and never read an `assigned` row. So they
 * cannot say what is outstanding now, and they cannot say it at all for work
 * that came from anywhere but a run move: removing an area writes assignments
 * too, and so does anything else that ever will.
 *
 * `GET /api/misfiles` is a different question again. It is `reviewShelving`,
 * which compares a recorded label against one derived from the sort order and
 * the boundaries, one run at a time, and answers a flat list of books. That
 * catches a book whose *sort key* moved, which is real and is not this; it does
 * not read the ledger, so it cannot see a rule change at all, and a flat list of
 * a hundred and eighty-seven is the thing #291 says not to hand somebody.
 *
 * **So this route is the ledger's own list, drawn for the first time.** It is
 * not a second work list: `assigned` disagreeing with `placed` is the list, and
 * `domain/placement/carry.ts` groups it into the trips somebody walks. Nothing
 * here writes anything. The books move when a person carries them and says so,
 * through `PATCH /api/books/:id/location`, which is the same route that already
 * records where a newly shelved book went.
 *
 * ## Only books the rules have ever had an opinion about
 *
 * A book with no `assigned` row in its history cannot be on this list and cannot
 * have been carried onto it, so the whole read is narrowed to the ones that
 * have. That is the difference between folding a few hundred rows and folding
 * every placement in the catalogue, and it sharpens what the skipped counts
 * mean: "three you pinned" is three books the rules wanted somewhere else and a
 * pin overruled, rather than every pinned book in the house.
 */

import {
  booksOnArea, carryWork,
  type AreaFace, type CarryableBook, type CarryWork, type StandingBook,
} from '../domain/placement/carry'
import { DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import { faceOf } from '../infrastructure/shelving/areas'
import { labelFor } from '../domain/placement/geography'
import type { Db } from './driver'

interface BookRow {
  id: number
  title: string
  author_filing: string
  /** Text, the way the catalogue holds it: "336", "" or "336 pages". */
  pages: string | null
}

interface FaceRow {
  id: number
  fixture_id: number
  fixture_position: number
  fixture_name: string
  position: number
  name: string
}

/**
 * Every area the collection has ever had on a face, retired ones included.
 *
 * **The retired ones are half of every trip a run move creates.** Moving the
 * non-fiction off bookcase 4 retires `4A`, `4B` and `4C` rather than deleting
 * them, because the placements name them, and `furnitureIn` answers the
 * collection as it stands and therefore leaves them out. A person holding a
 * phone is standing in front of `4A`, so `4A` is the label a trip has to say and
 * `faceOf` is what turns the stored negative back into it.
 *
 * The same reading `plankLabels` makes and the same one `withPlacements` makes
 * for the wire, through the same `labelFor` and the same `faceOf`. What this
 * adds over `plankLabels` is where each area stands, which is what puts the
 * trips in the order somebody walks them.
 */
async function areaFaces(db: Db): Promise<Map<number, AreaFace>> {
  const rows = await db.all<FaceRow>(
    `SELECT a.id, a.position, a.name, f.id AS fixture_id,
            f.position AS fixture_position, f.name AS fixture_name
       FROM area a JOIN fixture f ON f.id = a.fixture_id`,
  )

  return new Map(rows.map((row) => {
    const position = faceOf(row.position)
    return [Number(row.id), {
      label: labelFor({
        fixture: {
          id: Number(row.fixture_id),
          position: row.fixture_position,
          kind: '',
          name: row.fixture_name,
          sortStrategy: 'inherit',
        },
        area: {
          id: Number(row.id),
          fixtureId: Number(row.fixture_id),
          position,
          name: row.name,
          startsAt: '',
          sortStrategy: 'inherit',
        },
      }),
      fixtureId: Number(row.fixture_id),
      fixturePosition: row.fixture_position,
      areaPosition: position,
    }]
  }))
}

const named = (row: BookRow): CarryableBook => ({
  id: Number(row.id),
  title: row.title,
  authorFiling: row.author_filing ?? '',
})

/**
 * Every book the rules have ever placed, in the order they stand on the
 * shelves.
 *
 * `catalogued_books`, not `shelved_books`, because a checked out or a withdrawn
 * book has to be here to be counted as skipped rather than to be quietly absent.
 */
async function everyBookAssigned(db: Db): Promise<CarryableBook[]> {
  const rows = await db.all<BookRow>(
    `SELECT b.id, b.title, b.author_filing, b.pages
       FROM catalogued_books b
      WHERE EXISTS (
        SELECT 1 FROM book_placement p WHERE p.book_id = b.id AND p.kind = 'assigned')
      ORDER BY b.sort_key`,
  )
  return rows.map(named)
}

/** What is still to be carried, as the trips it is made of. Writes nothing. */
export async function outstandingWork(db: Db): Promise<CarryWork> {
  const books = await everyBookAssigned(db)
  const where = await areaFaces(db)
  const rows = await new DrizzlePlacementLedger(db).forBooks(books.map((book) => book.id))

  return carryWork(books, rows, where)
}

export interface TripAtAnArea {
  from: string
  to: string
  fromAreaId: number
  toAreaId: number
  books: StandingBook[]
}

/**
 * One trip, read at the area the books come off.
 *
 * Everything standing on that area, in shelf order, and which of it is going on
 * this trip. **The books that are staying are in the answer**, because somebody
 * looking at eleven spines and being told about eight is counting to eleven and
 * wondering which three.
 *
 * `current_area_id` rather than the fold, for the books on the area: it is the
 * projection of exactly that fold, it is checked against the ledger on every
 * start, and it is an index seek instead of a read of every placement in the
 * catalogue.
 *
 * **Naming one area twice asks for the area on its own**, which is what the end
 * of a trip wants: everything now standing on the area the books were just put
 * on, with nothing going anywhere. It falls out rather than being a case, since
 * a book already there disagrees with nothing.
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

  const books = rows.map(named)
  // Zero for a page count the catalogue never learned, which the drawing reads
  // as "no number" and sets at the median width rather than at a sliver.
  const pages = new Map(rows.map((row) => [Number(row.id), parseInt(row.pages ?? '', 10) || 0]))
  const ledger = await new DrizzlePlacementLedger(db).forBooks(books.map((book) => book.id))

  return {
    from: from.label,
    to: to.label,
    fromAreaId,
    toAreaId,
    books: booksOnArea(books, pages, ledger, fromAreaId, toAreaId),
  }
}
