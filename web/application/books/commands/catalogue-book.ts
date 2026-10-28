/**
 * Somebody at the shelf saves a book: one they scanned, or one they typed in.
 *
 * One unit of work. A save out of the queue holds the scanned book's lock from
 * the start, and every save holds its range's lock from the moment the genre
 * says which: describe (or confirm the queued book), credit, state the genre,
 * file, write the row and its photographs, record where it went, and say which
 * two books it goes between. The cover, hashes and crops start after the commit.
 *
 * The photographs arrive as files already written; storing the bytes happens
 * before this runs, outside the unit of work, because a file is not something a
 * rollback can take back.
 */

import { Book } from '../../../domain/books/book'
import { isQueued } from '../../../domain/books/state'
import { genreStatedBy } from '../../../domain/tagging/genre'
import type { Placement } from '../../../shared/shelving'
import type { AuthorRepository } from '../../authorship/ports'
import { bookLock, rangeLock } from '../../locks'
import type { UnitOfWork } from '../../ports'
import type { TagRepository } from '../../tagging/ports'
import { defaultLabel } from '../../tagging/restate-tags'
import type {
  BackgroundWork, BookRepository, PhotographFiles, Photographs, PlacementOnSave, ShelvedOn,
} from '../ports'
import { creditNames, fileBook, type BookSave, type ResolvedFiling } from './saving'

export interface CatalogueBook extends BookSave {
  /**
   * The book a scan created, when this save is of one. Confirmed when it is still
   * queued; when it has already left the queue this save is a new book.
   */
  scanId?: number
  photographs: PhotographFiles
  /**
   * Where the book went. Absent is the person at the shelf having just put it in
   * the gap they were shown, which is where it lands.
   */
  shelvedOn?: ShelvedOn
  now: string
}

export interface Catalogued {
  id: number
  /** Null when no genre tag files the book: saved, and in neither run. */
  placement: Placement | null
  filing: ResolvedFiling
}

export class CatalogueBookHandler {
  constructor(
    private readonly books: BookRepository,
    private readonly authors: AuthorRepository,
    private readonly tags: TagRepository,
    private readonly photographs: Photographs,
    private readonly placements: PlacementOnSave,
    private readonly background: BackgroundWork,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async handle(command: CatalogueBook): Promise<Catalogued> {
    const { description, now, scanId } = command

    const catalogued = await this.unitOfWork.run(async (scope) => {
      const scanned = scanId === undefined ? null : await this.books.load(scanId)
      const queued = scanned && isQueued(scanned.state) ? scanned : null
      const book = queued ?? Book.catalogue(description)
      if (queued) queued.confirm(description)

      await creditNames(this.authors, book, book.record.authors, command.authorFilingOverride)

      const stated = {
        genre: command.genre,
        classificationSource: description.classificationSource,
        classificationConfidence: description.classificationConfidence,
      }
      const { tag } = genreStatedBy(stated)
      if (tag) await this.tags.define(tag.slug, defaultLabel(tag.slug.value))
      const range = book.stateGenre(stated, now)
      if (range) await scope.serialiseOn(rangeLock(range))

      const filing = await fileBook(this.authors, book, command.authorFilingOverride)
      let id: number
      if (queued) {
        await this.books.save(queued)
        id = scanId!
      } else {
        id = await this.books.add(book, now)
      }
      await this.photographs.taken(id, command.photographs, now)

      const shelvedOn = command.shelvedOn ?? 'where-it-lands'
      await this.placements.recordSave({ id, sortKey: filing.sortKey, range }, shelvedOn, now)

      return {
        id,
        placement: range && await this.placements.whereItGoes(range, filing.sortKey, id),
        filing,
      }
    }, scanId === undefined ? undefined : { serialiseOn: [bookLock(scanId)] })

    // After the commit, and outside the unit of work: started inside it, the work
    // would inherit a transaction that has already ended.
    this.background.start(catalogued.id)
    return catalogued
  }
}
