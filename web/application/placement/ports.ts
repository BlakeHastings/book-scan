/**
 * What the placement ledger needs of a data store. Narrow on purpose: no
 * `find`, `update` or `delete`, since `book_placement` is append only.
 *
 * No transactions port: `record` writes two things that must agree (the row
 * and the projection), so the transaction belongs to the implementation, not
 * the caller.
 */

import type {
  Placement, PlacementActor, PlacementKind,
} from '../../domain/placement/ledger'

/** A row about to be written. No `id`: the store issues it, in time order. */
export interface NewPlacement {
  bookId: number
  kind: PlacementKind
  /** Required on the kinds that put a book somewhere, null on the rest. */
  areaId: number | null
  /** The book's sort key now, which is what makes the row readable later. */
  sortKey: string
  /** Which rule wanted this. `assigned` rows only. */
  ruleId?: number | null
  actor: PlacementActor
  reason?: string
  /** Injected rather than read from a clock, as every handler here does. */
  createdAt: string
}

export interface PlacementLedger {
  /**
   * Appends a row and writes `books.current_area_id` from it, in one
   * transaction. The projection must never be a separate call, or the column
   * and the rows can come apart.
   */
  record(placement: NewPlacement): Promise<void>

  /**
   * The rows of every book named, oldest first across all of them. One
   * method rather than per-book, since the rule engine folds a whole
   * catalogue at once.
   */
  forBooks(bookIds: readonly number[]): Promise<Placement[]>
}
