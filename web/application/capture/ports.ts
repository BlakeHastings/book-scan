/**
 * What the capture application layer needs from the outside world, said as
 * interfaces it owns.
 *
 * The third port file in the codebase, and deliberately the same shape as
 * `application/tagging/ports.ts`: the arrow points inwards, nothing here names a
 * driver, a query builder or a connection, and `npm run lint:layers` is what
 * checks that rather than a reviewer.
 *
 * Nothing here returns rows. A `Photograph` is a photograph, so column names
 * stop at the implementation and the rule in `domain/capture/photographs.ts`
 * never has to know one.
 */

import type { PhotographKind, Photographs } from '../../domain/capture/photographs'

/**
 * A photograph offered to the store, with the book it belongs to left to the
 * call rather than carried on the value.
 *
 * `id` is absent on purpose. A photograph is identified by the book and the
 * file, which is a fact about the world, and handing callers a row id would
 * invite them to hold one across a request.
 */
export interface NewPhotograph {
  kind: PhotographKind
  file: string
  cropFile?: string
  examined?: boolean
  hash?: string
  takenAt: string
}

/**
 * The photographs of a book.
 *
 * Two methods, and not a generic repository: a `find(criteria)` would be a query
 * builder wearing a repository's name. Recording what is known about a
 * photograph and reading a book's photographs back is the whole of what the
 * capture code does today.
 *
 * **There is no method that deletes a photograph, and that absence is the
 * design.** The photographs are half of what is irreplaceable about this
 * catalogue, and the schema that stored them in columns could only take a second
 * one by overwriting the first. A row per photograph is what fixes that, and an
 * app that could delete one would have reintroduced the problem with more steps.
 * Rows go when the book does, by the foreign key.
 */
export interface CaptureRepository {
  /** Every photograph of one book, newest first within each kind. */
  of(bookId: number): Promise<Photographs>

  /**
   * The same question asked of many books at once, keyed by book.
   *
   * Here because a shelf is a hundred books and a library listing is all of
   * them, and every one of them has to be drawn with the photograph it is
   * recognised by. `of` in a loop is that same read once per book, which is the
   * shape that turns opening the library into a thousand statements.
   *
   * A book with no photographs is absent from the map rather than present with
   * an empty `Photographs`, so a caller has to decide what it means. See
   * `withPhotographs` in `server/photographs.ts`, which decides once.
   */
  ofMany(bookIds: readonly number[]): Promise<Map<number, Photographs>>

  /**
   * Write these photographs down, adding what is new and never losing what is
   * already recorded.
   *
   * Idempotent per `(book, file)`: offering the same photograph twice is not an
   * error, because a save that re-states what it already said means the same as
   * saying it once. A file this book has not got a row for is a new photograph
   * and gets one, which is how a re-shot spine keeps the blurred original.
   *
   * **What an existing row takes from a repeat is monotone**: a crop arrives, a
   * hash arrives, `examined` goes from false to true, and none of the three ever
   * goes back. Two crop passes over one book overlap routinely (one fired after
   * a save, one from the backfill loop), and the lost update that shape caused
   * in stage G erased the "looked at and declined" state, which is the whole
   * reason `examined` exists. See the note on `Store.setCrop`.
   */
  record(bookId: number, photographs: readonly NewPhotograph[]): Promise<void>
}
