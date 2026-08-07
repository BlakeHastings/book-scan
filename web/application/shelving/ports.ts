/**
 * What the shelving application layer needs from the outside world, said as
 * interfaces it owns.
 *
 * These are ports, in the sense the epic (#169) uses: the arrow points inwards,
 * so the layer that stores separators depends on this file rather than this
 * file depending on it. Nothing here imports a driver, a query builder or a
 * connection, and that is the property `npm run lint:layers` checks rather than
 * a reviewer.
 *
 * **Only `separators` is here.** Fourteen tables are coming and every one of
 * them will want a port beside this one; the pattern is being judged on one
 * first, so books, captures and the rest are untouched and still go through
 * `Store` and `CaptureQueue`.
 */

import type { Separator, SeparatorKind } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

/** A boundary that does not exist yet, so it has no id to be identified by. */
export interface NewSeparator {
  range: ShelfRange
  kind: SeparatorKind
  /** Sort key of the first book on the new shelf. */
  startsAt: string
  position: number
  note: string
  createdAt: string
}

/**
 * Where a range's boundaries are kept.
 *
 * Deliberately small, and deliberately not a generic repository. Every method
 * is one of the four things the shelving code actually does to a separator, and
 * a `find(criteria)` or a `save(entity)` would be a query builder wearing a
 * repository's name, which is how the data store gets back into the layer this
 * exists to keep it out of.
 *
 * Nothing here returns rows. `Separator` is the shape `shared/layout.ts`
 * defines and the pure layout arithmetic consumes, so the column names stop at
 * the implementation.
 */
export interface SeparatorRepository {
  /** Every boundary in a range, in `position` order. */
  inRange(range: ShelfRange): Promise<Separator[]>

  /**
   * Which range a boundary belongs to, or undefined when it has already gone.
   *
   * Its own method because it is asked before the transaction opens: the lock
   * is named after a range, and the row is the only thing that knows which one.
   */
  rangeOf(id: number): Promise<ShelfRange | undefined>

  add(separator: NewSeparator): Promise<void>

  /**
   * Point an existing boundary at a different book.
   *
   * The word is the domain's: a boundary is anchored to a sort key, and moving
   * one is re-anchoring it, not editing a column.
   */
  reanchor(id: number, startsAt: string): Promise<void>

  reposition(id: number, position: number): Promise<void>

  remove(id: number): Promise<void>
}

/**
 * Atomicity and mutual exclusion, which are two things rather than one.
 *
 * A transaction commits or rolls back as a unit and does **not** stop another
 * transaction committing a row in the middle of it: Postgres runs at READ
 * COMMITTED, where every statement takes a fresh snapshot. So a read-then-write
 * that has to be the only one in flight over a range has to say so, and that is
 * what this port is for rather than a bare `transaction(work)`.
 *
 * See `TxOptions` in `web/server/driver.ts`, where the mechanism lives, and
 * `rangeLock` in `web/server/shelves.ts` for the one namespace in use. Neither
 * is named here on purpose: the application layer knows that two changes to one
 * range take turns, and not that a Postgres advisory lock is how.
 */
export interface Transactions {
  /**
   * Run `work` atomically, and serialised against everything else working on
   * the same range. Nothing that only reads waits for it, and work on a
   * different range does not wait either.
   */
  inRange<T>(range: ShelfRange, work: () => Promise<T>): Promise<T>
}
