/**
 * What the placement ledger needs of a data store, and nothing more.
 *
 * Narrow on purpose, the way `CaptureRepository` is. There is no `find`, no
 * `update` and no `delete`, and the absence of the last two is the table's whole
 * character: `book_placement` is append only, so a port that could update a row
 * would be a port that could rewrite where a book has been.
 *
 * **There is no transactions port here**, and that is a decision rather than an
 * omission. `record` writes two things that must agree, the row and the
 * projection, so the transaction is not the caller's to choose: it belongs to
 * the implementation and is stated in `record`'s contract below. A caller that
 * could forget it is a caller that will.
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
   * Append a row **and write `books.current_area_id` from it, in one
   * transaction.**
   *
   * The projection is not a separate call and must never become one. Two
   * statements outside a transaction is exactly how the column and the rows come
   * apart, and the whole reason a projection is tolerable here is that they
   * cannot.
   */
  record(placement: NewPlacement): Promise<void>

  /**
   * The rows of every book named, oldest first across all of them.
   *
   * One method rather than one for a book and one for many, because the rule
   * engine folds a whole catalogue at once and a round trip per book is the
   * shape that turns a placement run into a minute. One book is a list of one.
   */
  forBooks(bookIds: readonly number[]): Promise<Placement[]>
}
