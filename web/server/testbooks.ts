/**
 * Books a test can hold, saved the way the app saves them.
 *
 * Test support only; nothing the server runs imports this file.
 *
 * Writes through `CatalogueBookHandler` and `ReviseBookHandler`, the handlers
 * `POST /api/books` and `PUT /api/books/:id` call, built by `bookCommands` as
 * `createApp` builds them. There is no second save path for fixtures, so a test
 * cannot stand on a row the app could not have written (#634): the row, its
 * genre tag, its credits, its photographs and its ledger row all arrive together
 * or not at all, under the same locks.
 *
 * A fixture that needs a state the save path cannot produce writes that state
 * itself, in the open, and says why. `unplaced.routes.test.ts` is the example.
 */

import type { Catalogued } from '../application/books/commands/catalogue-book'
import type { Revised } from '../application/books/commands/revise-book'
import { bookCommands, bookSaveOf, catalogueCommandOf } from './book-commands'
import type { Db } from './driver'
import { Shelves } from './shelves'
import type { DraftBook } from './store'

export interface TestBooks {
  /**
   * Somebody at the shelf saves this book. A `location` in the draft is a plank
   * they named; without one the book is recorded where it lands in its run, when
   * the run has a plank for it. `scanId` confirms that queued scan in place.
   */
  catalogue(draft: DraftBook, scanId?: number): Promise<Catalogued>
  /**
   * Somebody edits a book already catalogued. Records a plank only when the
   * draft names one. Throws for a book that does not exist, since a fixture
   * revising nothing is a mistake in the test.
   */
  revise(id: number, draft: DraftBook): Promise<Revised>
}

export function testBooks(db: Db): TestBooks {
  const shelves = new Shelves(db)
  const { catalogueBook, reviseBook } = bookCommands(db, (range, id) => shelves.areaOf(range, id))

  return {
    catalogue: (draft, scanId) =>
      catalogueBook.handle(catalogueCommandOf(draft, new Date().toISOString(), scanId)),
    async revise(id, draft) {
      const revised = await reviseBook.handle({
        ...bookSaveOf(draft),
        bookId: id,
        location: draft.location,
        now: new Date().toISOString(),
      })
      if (!revised) throw new Error(`no book ${id} to revise`)
      return revised
    },
  }
}
