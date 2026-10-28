/**
 * A person puts a book under a tag.
 *
 * The word is made in the vocabulary if nobody has made it yet, and the book is
 * loaded, changed and saved on its own lock, so a save of the same book cannot
 * restate its tags from a picture taken before this one landed.
 */

import type { TagConfidence, TagSlug } from '../../../domain/tagging/tags'
import type { BookRepository } from '../../books/ports'
import { bookLock } from '../../locks'
import type { UnitOfWork } from '../../ports'
import type { TagRepository } from '../ports'

export interface ApplyTag {
  bookId: number
  /**
   * What the person typed, normalised, so "Lent Out", "lent out" and "LENT-OUT"
   * are one tag rather than three near misses.
   */
  slug: TagSlug
  /** What anybody reads. Kept only when this is the first time the word is made. */
  label: string
  confidence?: TagConfidence
  now: string
}

export class ApplyTagHandler {
  constructor(
    private readonly books: BookRepository,
    private readonly tags: TagRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /** False when there is no such book, and then nothing is written. */
  async handle(command: ApplyTag): Promise<boolean> {
    return this.unitOfWork.run(async () => {
      const book = await this.books.load(command.bookId)
      if (!book) return false

      await this.tags.define(command.slug, command.label)
      // A person is not guessing: there is no scale on which having the book in hand is 'medium'.
      book.applyTag(command.slug, command.confidence ?? 'high', command.now)
      await this.books.save(book)
      return true
    }, { serialiseOn: [bookLock(command.bookId)] })
  }
}
