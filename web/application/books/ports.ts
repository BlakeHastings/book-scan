/**
 * What the book commands need from the outside world. The reads are in
 * `read-models.ts` beside this, so a query cannot reach for the repository.
 */

import type { Book } from '../../domain/books/book'

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
