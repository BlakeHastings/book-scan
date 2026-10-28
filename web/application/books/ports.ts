/**
 * What the book commands need from the outside world. The reads are in
 * `read-models.ts` beside this, so a query cannot reach for the repository.
 */

import type { Book } from '../../domain/books/book'
import type { Placement, ShelfRange } from '../../shared/shelving'

/**
 * Books, loaded and saved whole. Called inside a unit of work, so a load and the
 * save after it are one transaction with whatever else the handler writes.
 *
 * Never writes the queue's columns or `current_area_id`: the queue owns the
 * first and the placement ledger the second.
 */
export interface BookRepository {
  /** The book with this id in any state, with its tags and credits, or null. */
  load(id: number): Promise<Book | null>

  /** Write what the book says changed since it was loaded. */
  save(book: Book): Promise<void>
}

/** Where a save says the book physically went. */
export type ShelvedOn =
  /** A plank a person named, by its label. Refused, by throwing, when there is no such plank. */
  | { label: string }
  /** The plank the book lands on in its run, for a save at the shelf that named none. */
  | 'where-it-lands'

/**
 * The two questions a save asks about the shelf. Called inside the save's unit
 * of work, after the row is written and while the range's lock is held, so the
 * answer and the record describe the shelf this save produced.
 */
export interface PlacementOnSave {
  /** The gap between two shelved books this sort key falls in, the book itself left out. */
  whereItGoes(range: ShelfRange, sortKey: string, bookId: number): Promise<Placement>

  /**
   * Append where the book went to the ledger. `'where-it-lands'` records nothing
   * for a book in no run, or a run with no plank for it.
   */
  recordSave(
    book: { id: number; sortKey: string; range: ShelfRange | null },
    shelvedOn: ShelvedOn,
    at: string,
  ): Promise<void>
}
