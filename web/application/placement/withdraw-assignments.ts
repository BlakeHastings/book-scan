/**
 * Takes back the answer a plan wrote, putting the book back on the list.
 *
 * Writes one `released` row and nothing else: no location, no `placed` row,
 * no area. No book moves; the schema refuses a `released` row an area, so
 * this cannot rewrite a placement by mistake. Nothing is deleted: the
 * assignment stays in the ledger, and the withdrawal is another row after it.
 *
 * A book is outstanding work only if it is not pinned, checked out,
 * withdrawn, or already carried to its assigned area. A trip narrows this
 * further, to books coming off one area for one other; omitted, it is all
 * outstanding work.
 *
 * `RestoreAssignmentsHandler` reverses this by writing a new `assigned` row
 * with no `rule_id`: what a person restores is the work, not a claim about
 * which rule wants it.
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

      if (standing.pinned || standing.checkedOut || standing.withdrawn) continue
      if (standing.assigned === null || standing.assigned === standing.area) continue
      if (standing.area === null) continue

      if (trip && (standing.area !== trip.fromAreaId || standing.assigned !== trip.toAreaId)) {
        continue
      }

      await this.ledger.record({
        bookId: book.id,
        kind: 'released',
        // No area: the schema refuses one on a released row.
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
      // Already there, or carried there since: nothing to put back.
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
