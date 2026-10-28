/**
 * Somebody edits a book they have already catalogued.
 *
 * One unit of work, on the book's lock from the start and on its range's from
 * the moment the genre says which: load, revise (which withdraws what was said
 * about the old book first when the ISBN names a different one), credit, state
 * the genre, file, save, and say where it now goes.
 *
 * An edit is not a person standing at the shelf, so it records where the book
 * went only when it names a plank; it never records where the book lands. What
 * it does record is where the rules now want it, when the edit re-keyed it onto
 * another plank: that is an assignment, which the carry list reads, and not a
 * placement.
 */

import { bookLock, FURNITURE_LOCK, rangeLock } from '../../locks'
import type { UnitOfWork } from '../../ports'
import type { TagRepository } from '../../tagging/ports'
import { defaultLabel } from '../../tagging/restate-tags'
import type { AuthorRepository } from '../../authorship/ports'
import { genreStatedBy } from '../../../domain/tagging/genre'
import type { Placement } from '../../../shared/shelving'
import type { BookRepository, PlacementOnSave } from '../ports'
import { creditNames, fileBook, type BookSave, type ResolvedFiling } from './saving'

export interface ReviseBook extends BookSave {
  bookId: number
  /** A plank somebody named, by label. Empty or absent says nothing about where the book is. */
  location?: string
  now: string
}

export interface Revised {
  id: number
  /** Null when no genre tag files the book: saved, and in neither run. */
  placement: Placement | null
  filing: ResolvedFiling
}

export class ReviseBookHandler {
  constructor(
    private readonly books: BookRepository,
    private readonly authors: AuthorRepository,
    private readonly tags: TagRepository,
    private readonly placements: PlacementOnSave,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /** Null when there is no such book, and then nothing is written. */
  async handle(command: ReviseBook): Promise<Revised | null> {
    const { bookId, description, now } = command

    return this.unitOfWork.run(async (scope) => {
      const book = await this.books.load(bookId)
      if (!book) return null

      const was = { range: book.shelfRange, sortKey: book.filing.sortKey }
      book.revise(description)
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
      const refiled = was.range !== range || was.sortKey !== filing.sortKey
      // Both answers are read off the furniture, so it cannot be rearranged between them.
      if (refiled) await scope.serialiseOn(FURNITURE_LOCK)
      await this.books.save(book)

      const label = command.location?.trim()
      if (label) await this.placements.recordSave({ id: bookId, sortKey: filing.sortKey, range }, { label }, now)
      if (refiled) {
        await this.placements.recordWhereItNowBelongs(bookId, was, { range, sortKey: filing.sortKey }, now)
      }

      return {
        id: bookId,
        placement: range && await this.placements.whereItGoes(range, filing.sortKey, bookId),
        filing,
      }
    }, { serialiseOn: [bookLock(bookId)] })
  }
}
