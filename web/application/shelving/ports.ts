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
 * **Only the shelving furniture is here**, which is `separators` and, since
 * #196, the outstanding moves that name them. Fourteen tables are coming and
 * every one of them will want a port beside this one; the pattern is being
 * judged on shelving first, so books, captures and the rest are untouched and
 * still go through `Store` and `CaptureQueue`.
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
 * is one of the three things the shelving code actually does to a boundary, and
 * a `find(criteria)` or a `save(entity)` would be a query builder wearing a
 * repository's name, which is how the data store gets back into the layer this
 * exists to keep it out of.
 *
 * **`reposition` was a fourth and is gone (#232).** A boundary used to be a row
 * with a `position` column, so taking one out meant renumbering the rest or the
 * range stopped describing the shelves. A boundary is an `area` now and its
 * position is where that area sits in the run, so the numbering is contiguous by
 * construction and there is nothing left to renumber.
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

  /**
   * Point several boundaries at once, which is not the same as calling
   * `reanchor` in a loop.
   *
   * A boundary move that empties an area leaves two boundaries on one anchor, so
   * the move it plans re-anchors both, and where a boundary sits in the run is
   * decided by its anchor. Applying the first change on its own re-sorts the run
   * under the second, which then has nothing left to do: the move reports
   * carrying a book two planks and the shelves carry it one. The set is one
   * edit, so it is written as one.
   */
  reanchorAll(shifts: readonly { id: number; startsAt: string }[]): Promise<void>

  /**
   * Take the area this boundary opens off the furniture.
   *
   * **The whole act, not the row** (#465). Removing a boundary hands that
   * area's books to the area in front and records where they went, and this
   * method means all of it: the retirement, the renumbering and the `assigned`
   * row per book. It said "delete the row" until #465, which is how one door
   * into this act wrote the ledger and the other wrote nothing, and every book
   * that came through the second door was left naming a plank the run no longer
   * had. There is one implementation and it is the same function
   * `DELETE /api/areas/:id` calls, so there is no longer a second writer to keep
   * in step.
   *
   * It can refuse, which `reanchor` and `add` cannot: an area that is the only
   * one on its piece has nothing for its books to join, and the answer says so
   * rather than emptying the piece quietly.
   */
  remove(id: number): Promise<BoundaryRemoved>
}

/**
 * What became of the area a boundary opened.
 *
 * A refusal is the act's own, worded for a person, and it carries the status a
 * route should answer with. Nothing is written when one comes back.
 */
export type BoundaryRemoved =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * A boundary move that has been made and that nobody has acted on yet.
 *
 * A move is two statements: the furniture changes, and then a person who has
 * walked to the shelf says where the book physically is. Only the first one is
 * the app's to make, so between them the book is genuinely not where the
 * catalogue has it. This is that gap, written down, so it can be closed from
 * either end: by carrying the book, or by taking the move back for a book
 * nobody picked up.
 *
 * What it carries is what the move **changed**, not what the shelves look like
 * now. That distinction is the whole of why this exists. Undoing by asking for
 * the opposite boundary move reads the shelves as they are and answers with
 * where the rules would put the book today, and after a move that emptied an
 * area those are two different planks.
 */
export interface OutstandingMove {
  bookId: number
  range: ShelfRange
  /** The plank the book came off, and where the catalogue still records it. */
  from: string
  /** The plank the move assigned it to, and where the layout now draws it. */
  to: string
  /** Boundaries to point back at the book they were anchored to before. */
  reanchor: { id: number; startsAt: string }[]
  /**
   * Boundaries the move took out, to be made again exactly as they were.
   *
   * A move removes a boundary only when the book it re-anchors to would be
   * past the end of the run, which leaves it describing a place no book is on.
   * Their ids do not survive the deletion, which is why this holds whole
   * separators rather than ids.
   */
  recreate: NewSeparator[]
}

/**
 * Where outstanding moves are kept. One row per book at most.
 *
 * A book has one plank it came off, so a second move made before anybody has
 * carried it is not a second outstanding move: it is the same book, still off
 * the plank the catalogue records, one boundary further along. `record` says so
 * by merging.
 */
export interface OutstandingMoveRepository {
  /**
   * Write down what a move changed, merging with anything already outstanding
   * for this book.
   *
   * Merging keeps the **older** anchor for a boundary named twice, and the
   * older `from`, so what is stored stays "the arrangement as it was the last
   * time this book and its shelf agreed" rather than "as it was a moment ago".
   * Undoing a move to a state that is itself undone is not undoing.
   */
  record(move: OutstandingMove, madeAt: string): Promise<void>

  forBook(bookId: number): Promise<OutstandingMove | undefined>

  inRange(range: ShelfRange): Promise<OutstandingMove[]>

  /** Nothing is outstanding for this book any more, however that came about. */
  clear(bookId: number): Promise<void>
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
