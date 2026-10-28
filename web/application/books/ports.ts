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

  /** Write a book nobody has a row for, and answer its id. `scannedAt` is when it was first seen. */
  add(book: Book, scannedAt: string): Promise<number>

  /** Write what the book says changed since it was loaded. */
  save(book: Book): Promise<void>

  /**
   * The oldest catalogued book carrying this ISBN in either form, or null. Read
   * on the unit of work, so under that number's lock it sees every save of the
   * number that committed before the lock was granted.
   */
  cataloguedWith(isbn13: string): Promise<number | null>
}

/** The photograph files a save carries, by slot. A slot left out says nothing. */
export interface PhotographFiles {
  front?: string
  back?: string
  edge?: string
}

/** The photographs a book was taken with, recorded on the save's unit of work. */
export interface Photographs {
  /** Idempotent per file: a file the book already has is not a second photograph. */
  taken(bookId: number, files: PhotographFiles, at: string): Promise<void>
}

/**
 * Work a save starts and nobody waits for: the cover, the hashes, the crops.
 * Started only after the save has committed, from outside its unit of work, so
 * the work runs on connections of its own rather than on a transaction that has
 * already ended.
 */
export interface BackgroundWork {
  start(bookId: number): void
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

  /**
   * Append an `assigned` row when an edit moved a shelved book to another plank
   * of the run, so the carry list hears what the needs-attention list already
   * derives. Compares the plank the run gave the book's old range and key with
   * the one it gives the new; writes nothing when they are the same, or when the
   * book is not shelved, pinned, or already assigned there. Never a `placed` row:
   * an edit moves a book in the run and not in the room.
   */
  recordWhereItNowBelongs(
    bookId: number,
    was: { range: ShelfRange | null; sortKey: string },
    now: { range: ShelfRange | null; sortKey: string },
    at: string,
  ): Promise<void>
}
