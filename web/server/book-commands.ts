/**
 * The book commands, put together over one `Db`. `createApp`,
 * `scripts/seed-world.ts` and the tests that build a room through the whole save
 * path all take them from here, so there is one save and one way of building it.
 */

import type { BackgroundWork } from '../application/books/ports'
import {
  CatalogueBookHandler, type CatalogueBook,
} from '../application/books/commands/catalogue-book'
import type { BookSave } from '../application/books/commands/saving'
import { ReviseBookHandler } from '../application/books/commands/revise-book'
import { ApplyTagHandler } from '../application/tagging/commands/apply-tag'
import { RemoveTagHandler } from '../application/tagging/commands/remove-tag'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { DrizzleBookRepository } from '../infrastructure/books/book-repository'
import { DbPhotographs } from '../infrastructure/books/photographs-taken'
import { DrizzlePlacementOnSave, type AreaOf } from '../infrastructure/books/placement-on-save'
import { DbUnitOfWork } from '../infrastructure/db/unit-of-work'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import type { Db } from './driver'
import type { DraftBook } from './store'

export interface BookCommands {
  catalogueBook: CatalogueBookHandler
  reviseBook: ReviseBookHandler
  applyTag: ApplyTagHandler
  removeTag: RemoveTagHandler
}

/** Nothing to start: a seed or a test has no cover to fetch. */
export const NO_BACKGROUND: BackgroundWork = { start: () => undefined }

export function bookCommands(
  db: Db,
  /** `Shelves.areaOf`, which is where a book lands in its run's layout. */
  areaOf: AreaOf,
  background: BackgroundWork = NO_BACKGROUND,
): BookCommands {
  const unitOfWork = new DbUnitOfWork(db)
  const books = new DrizzleBookRepository(db)
  const authors = new DrizzleAuthorRepository(db)
  const tags = new DrizzleTagRepository(db)
  const placements = new DrizzlePlacementOnSave(db, areaOf)

  return {
    catalogueBook: new CatalogueBookHandler(
      books, authors, tags, new DbPhotographs(db), placements, background, unitOfWork,
    ),
    reviseBook: new ReviseBookHandler(books, authors, tags, placements, unitOfWork),
    applyTag: new ApplyTagHandler(books, tags, unitOfWork),
    removeTag: new RemoveTagHandler(books, unitOfWork),
  }
}

/** A draft as the book commands take it. */
export function bookSaveOf(draft: DraftBook): BookSave {
  const {
    genre, authorFilingOverride,
    location: _location, frontImage: _front, backImage: _back, edgeImage: _edge,
    ...description
  } = draft
  return { description, genre, authorFilingOverride }
}

/**
 * The save of a draft at the shelf. A location in the draft is a plank somebody
 * named; without one the book is where it lands.
 */
export function catalogueCommandOf(draft: DraftBook, now: string, scanId?: number): CatalogueBook {
  const label = draft.location?.trim()
  return {
    ...bookSaveOf(draft),
    scanId,
    photographs: { front: draft.frontImage, back: draft.backImage, edge: draft.edgeImage },
    shelvedOn: label ? { label } : 'where-it-lands',
    now,
  }
}
