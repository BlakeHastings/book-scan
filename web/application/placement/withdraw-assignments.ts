/**
 * Taking back the answer a plan wrote, and putting it back on the list again.
 *
 * **Withdrawing is the missing half of applying.** Applying a plan writes an
 * intention and moves nothing; until this existed there was no way to say the
 * intention was not one this person was going to act on, so the app went on
 * asking for forty-six books to be walked across a room by somebody who had
 * already decided not to. An intention a person can create and cannot withdraw
 * is a one-way door, and this app does not have those anywhere else.
 *
 * ## What it writes, and the much longer list of what it does not
 *
 * One `released` row per book, and nothing else. It writes no location, no
 * `placed` row and no area of any kind, because **no book moves**: the whole
 * point is that every book is left standing exactly where it stands, and where a
 * book is remains the only thing `PATCH /api/books/:id/location` writes. The
 * schema refuses a `released` row an area, so this cannot rewrite a placement
 * even by mistake.
 *
 * Nothing is deleted either. The assignment stays in the ledger with the rule
 * that wanted it and the day it was written, and the withdrawal is another row
 * after it. Somebody reading a book's history later sees that the rules asked
 * and that a person said no, which is what happened.
 *
 * ## Which books it touches, decided here rather than by the caller
 *
 * The caller hands over every book the list can see and this folds each one, so
 * there is one place that decides what is outstanding work:
 *
 * - a book with nothing outstanding is left alone, which is what keeps a
 *   **partly carried** trip safe. Books already carried have their assignment
 *   satisfied, so they are not outstanding, so nothing is written for them and
 *   they keep the new home somebody walked them to;
 * - a **pinned** book has no standing assignment at all, because a pin clears
 *   one, so it cannot be reached from here. Pinned books are untouched;
 * - a checked out or withdrawn book is not on any list and is not work.
 *
 * A trip narrows it further, to books coming off one area for one other. Absent,
 * it is the whole of the outstanding work, which is the state the owner is in.
 *
 * ## Putting it back is the same shape in reverse
 *
 * `RestoreAssignmentsHandler` writes an `assigned` row naming the area that was
 * declined, by a person rather than by the rules, which is what clears the
 * memory in `standingOf`. So the withdrawal is itself withdrawable and this is
 * not a one-way door either. It carries no `rule_id`: the rule may have been
 * renamed or taken off the place since, and what a person is asking for is the
 * work back rather than a claim about which rule wants it. The area-removal path
 * has written assignments with no rule behind them since #281.
 */

import { standingOf, type Placement, type PlacementActor } from '../../domain/placement/ledger'
import type { PlacementLedger } from './ports'

/** What withdrawing needs of a book, which is its identity and its key. */
export interface WithdrawableBook {
  id: number
  /** The book's key now, so the row reads back as a position later. */
  sortKey: string
}

/** One trip: everything coming off one area for one other. */
export interface OneTrip {
  fromAreaId: number
  toAreaId: number
}

export interface WithdrawAssignments {
  /** Every book the list can see. This handler decides which of them are work. */
  books: readonly WithdrawableBook[]
  /** One trip, or the whole of the outstanding work when it is absent. */
  trip?: OneTrip | null
  actor: PlacementActor
  now: string
}

/** How many books were left where they stand. Zero is a real answer. */
export interface WithdrawalReport {
  books: number
}

export class WithdrawAssignmentsHandler {
  constructor(private readonly ledger: PlacementLedger) {}

  async handle(command: WithdrawAssignments): Promise<WithdrawalReport> {
    const { books, trip, actor, now } = command
    const history = await this.ledger.forBooks(books.map((book) => book.id))
    const rows = rowsByBook(history)

    let written = 0
    for (const book of books) {
      const standing = standingOf(rows.get(book.id) ?? [])

      // Outstanding work and nothing else. A pin, a check out, a withdrawal and
      // a carry that already happened all land here as "there is nothing wanted
      // of this book", which is the one condition worth stating.
      if (standing.pinned || standing.checkedOut || standing.withdrawn) continue
      if (standing.assigned === null || standing.assigned === standing.area) continue
      if (standing.area === null) continue

      if (trip && (standing.area !== trip.fromAreaId || standing.assigned !== trip.toAreaId)) {
        continue
      }

      await this.ledger.record({
        bookId: book.id,
        kind: 'released',
        // No area, and the schema will not accept one. See the header.
        areaId: null,
        sortKey: book.sortKey,
        actor,
        reason: 'left where it stands',
        createdAt: now,
      })
      written += 1
    }

    return { books: written }
  }
}

export class RestoreAssignmentsHandler {
  constructor(private readonly ledger: PlacementLedger) {}

  async handle(command: WithdrawAssignments): Promise<WithdrawalReport> {
    const { books, trip, actor, now } = command
    const history = await this.ledger.forBooks(books.map((book) => book.id))
    const rows = rowsByBook(history)

    let written = 0
    for (const book of books) {
      const standing = standingOf(rows.get(book.id) ?? [])

      if (standing.pinned || standing.checkedOut || standing.withdrawn) continue
      if (standing.declined === null || standing.area === null) continue
      // The book has been carried there since, or was there all along. There is
      // no work to put back, only a memory that no longer describes anything.
      if (standing.declined === standing.area) continue

      if (trip && (standing.area !== trip.fromAreaId || standing.declined !== trip.toAreaId)) {
        continue
      }

      await this.ledger.record({
        bookId: book.id,
        kind: 'assigned',
        areaId: standing.declined,
        sortKey: book.sortKey,
        ruleId: null,
        actor,
        reason: 'put back on the list',
        createdAt: now,
      })
      written += 1
    }

    return { books: written }
  }
}

function rowsByBook(rows: readonly Placement[]): Map<number, Placement[]> {
  const grouped = new Map<number, Placement[]>()
  for (const row of rows) {
    const existing = grouped.get(row.bookId)
    if (existing) existing.push(row)
    else grouped.set(row.bookId, [row])
  }
  return grouped
}
