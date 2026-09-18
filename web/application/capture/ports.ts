/**
 * What the capture application layer needs from the outside world. Nothing
 * here returns rows: a `Photograph` is a photograph, so the domain rule never
 * sees a column name.
 */

import type { PhotographKind, Photographs } from '../../domain/capture/photographs'

/**
 * A photograph offered to the store; the book it belongs to is passed
 * separately. `id` is absent: a photograph is identified by the book and the
 * file, not a row id a caller might hold across requests.
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
 * The photographs of a book. Not a generic repository: recording what is
 * known and reading it back is the whole of what capture code does.
 *
 * No method deletes a photograph, deliberately: photographs are
 * irreplaceable, and a row per photograph exists so a second one never
 * overwrites the first. Rows go only when the book does, by the foreign key.
 */
export interface CaptureRepository {
  /** Every photograph of one book, newest first within each kind. */
  of(bookId: number): Promise<Photographs>

  /**
   * The same question asked of many books at once, keyed by book. Avoids one
   * `of` call per book.
   *
   * A book with no photographs is absent from the map, not present with an
   * empty `Photographs`. See `withPhotographs` in `server/photographs.ts`.
   */
  ofMany(bookIds: readonly number[]): Promise<Map<number, Photographs>>

  /**
   * Writes these photographs down, adding what is new and never losing what
   * is already recorded. Idempotent per `(book, file)`.
   *
   * What an existing row takes from a repeat is monotone: a crop arrives, a
   * hash arrives, `examined` goes from false to true, and none of the three
   * ever goes back.
   */
  record(bookId: number, photographs: readonly NewPhotograph[]): Promise<void>
}
