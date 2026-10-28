/**
 * Somebody at the shelf saves a book: one they scanned, or one they typed in.
 *
 * One unit of work. A save of a book with an ISBN holds that number's lock from
 * the start, a save out of the queue holds the scanned book's lock from the
 * start too, and every save holds its range's lock from the moment the genre
 * says which: ask whether the number is already catalogued (when the caller
 * wants to know), describe (or confirm the queued book), credit, state the
 * genre, file, write the row and its photographs, record where it went, and say
 * which two books it goes between. The cover, hashes and crops start after the
 * commit.
 *
 * The number's lock is what makes the question worth asking: two saves of one
 * ISBN at once take turns, so the second asks after the first has committed and
 * finds its book (#637). It is taken whatever the caller wants done about a
 * book already catalogued, so a save that adds a copy anyway still waits for,
 * and is waited for by, one that asks.
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
import { resolveIsbnPair } from '../../../shared/isbn'
import { bookLock, isbnLock, rangeLock, type LockName } from '../../locks'
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
  /**
   * What a catalogued book already carrying this ISBN means to this save.
   * `'add-a-copy'` saves anyway: somebody can own two copies of a book, and the
   * app warns that saving adds a second one and then lets them. `'answer-it'`
   * writes nothing and answers that book, for a caller asking for "this book"
   * rather than "another copy". Not defaulted, because a caller that says
   * nothing is a caller nobody asked. A book with no ISBN is never a duplicate.
   */
  ifCatalogued: IfCatalogued
}

export type IfCatalogued = 'add-a-copy' | 'answer-it'

/** A save that found its ISBN already catalogued, asked to answer it, and wrote nothing. */
export interface AlreadyCatalogued {
  added: false
  id: number
}

export interface Catalogued {
  added: true
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

  handle(command: CatalogueBook & { ifCatalogued: 'add-a-copy' }): Promise<Catalogued>
  handle(command: CatalogueBook): Promise<Catalogued | AlreadyCatalogued>
  async handle(command: CatalogueBook): Promise<Catalogued | AlreadyCatalogued> {
    const { description, now, scanId } = command
    // Resolved as `Book.catalogue` resolves it, so the number locked and asked
    // about is the one the row is written with.
    const { isbn13 } = resolveIsbnPair(description.isbn13 || description.isbn10 || '')
    const locks = [isbnLock(isbn13), scanId === undefined ? null : bookLock(scanId)]
      .filter((name): name is LockName => name !== null)

    const catalogued = await this.unitOfWork.run<Catalogued | AlreadyCatalogued>(async (scope) => {
      if (isbn13 && command.ifCatalogued === 'answer-it') {
        const existing = await this.books.cataloguedWith(isbn13)
        if (existing !== null) return { added: false, id: existing }
      }

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
        added: true,
        id,
        placement: range && await this.placements.whereItGoes(range, filing.sortKey, id),
        filing,
      }
    }, locks.length ? { serialiseOn: locks } : undefined)

    // After the commit, and outside the unit of work: started inside it, the work
    // would inherit a transaction that has already ended.
    if (catalogued.added) this.background.start(catalogued.id)
    return catalogued
  }
}
