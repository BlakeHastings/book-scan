/**
 * How a recorded location becomes a row in the ledger.
 *
 * The same job `photographs.ts` does for the eight image columns, on the three
 * columns this step is beside: `books.location`, `books.shelved_at` and
 * `books.checked_out_at`. It lives in `server/` for the same reason that one
 * does. Those columns belong to this layer, they are still authoritative, and
 * **deleting this file is the last step of the cut-over rather than the first**.
 *
 * ## Why this is called from `Store` and not from a route
 *
 * `capture` drifts behind the image columns because `recordPhotographs` runs
 * from the two save routes and the background chain behind one of them, and the
 * cover backfill, the hash backfill and two CLIs write those columns without it
 * (#200). That is the failure to avoid here, and the way to avoid it is to write
 * the ledger row where the column is written rather than where the request is
 * handled.
 *
 * **There are exactly four statements in this repository that change where a
 * book is**, and all four are in `store.ts`: the insert in `addBook`, the update
 * in `updateBook`, `setLocation` and `setCheckedOut`. Every one of them calls
 * into this file, inside its own transaction, so a placement cannot be written
 * without a row. A fifth would have to be added to `Store`, next to the four
 * that do.
 *
 * ## The two things this cannot say, said out loud
 *
 * **A location the furniture does not have.** `PATCH /api/books/:id/location`
 * accepts any label `parseLocation` accepts, so `9Z` is recordable and there is
 * no area row for it. No `placed` row is written, so the ledger keeps saying
 * whatever it said before. The ledger and the projection still agree with each
 * other, which is the invariant that is checked; both are then behind
 * `books.location`, which is the invariant that is not, because `location`
 * stays authoritative until the cut-over. `0015` counts these on the way in.
 *
 * **Clearing a recorded location**, which the route describes as taking a book
 * back to never-placed. None of the six kinds says that: `withdrawn` means given
 * away, and `checked_out` means it is out of the house in somebody's bag. So no
 * row is written and the ledger keeps the last place the book was seen. The
 * alternatives were inventing a seventh kind, which is not this change's to
 * invent, and writing a row that means something else, which is worse than a
 * gap that is written down.
 */

import { areaIndex } from '../shared/layout'
import { parseLocation } from '../shared/shelving'
import { areaForLabel, DrizzlePlacementLedger } from '../infrastructure/placement/ledger-repository'
import type { Db } from './driver'

/** What every write here needs to know about the book being moved. */
export interface PlacedBook {
  id: number
  /** The book's sort key as the same statement is writing it. */
  sortKey: string
  /** The recorded location, exactly as it is going into `books.location`. */
  location: string
}

/**
 * The area a recorded label names, or null when nothing does.
 *
 * `parseLocation` first, so `s4 b`, `S4B` and `4B` are the one plank they are
 * everywhere else, and then the letters back through `areaIndex`.
 */
export async function areaOfLocation(db: Db, label: string): Promise<number | null> {
  const parsed = parseLocation(label)
  if (!parsed) return null

  const position = areaIndex(parsed.section)
  if (position < 0) return null

  return areaForLabel(db, parsed.shelf, position)
}

/**
 * Record that somebody put this book where `location` says.
 *
 * Called from inside the transaction that writes the column, and given that
 * transaction's handle, so the row and the column commit together or neither
 * does. Writes nothing when the location is empty or names no plank; see the
 * header for both.
 */
export async function recordPlaced(db: Db, book: PlacedBook, at: string): Promise<void> {
  const label = book.location.trim()
  if (!label) return

  const areaId = await areaOfLocation(db, label)
  if (areaId === null) return

  await new DrizzlePlacementLedger(db).record({
    bookId: book.id,
    kind: 'placed',
    areaId,
    sortKey: book.sortKey,
    actor: 'person',
    reason: `recorded at ${label}`,
    createdAt: at,
  })
}

/**
 * Record a book leaving the house, or coming back into it.
 *
 * Going out is one row and it names no area, because a book in a bag holds no
 * position. Coming back is two: `checked_in`, which takes it out of every area,
 * and then `placed`, because `Store.setCheckedOut` leaves `books.location`
 * exactly as it was and that column is still what says where the book is. The
 * model has a returning book placed again by the rules, and it will be, on the
 * day the rules are what decides. Until then a ledger that said the book was
 * nowhere would disagree with the column somebody is reading off the screen.
 */
export async function recordCheckedOut(
  db: Db,
  book: PlacedBook,
  out: boolean,
  at: string,
): Promise<void> {
  const ledger = new DrizzlePlacementLedger(db)
  await ledger.record({
    bookId: book.id,
    kind: out ? 'checked_out' : 'checked_in',
    areaId: null,
    sortKey: book.sortKey,
    actor: 'person',
    reason: out ? 'checked out' : 'checked in',
    createdAt: at,
  })

  if (!out) await recordPlaced(db, book, at)
}
