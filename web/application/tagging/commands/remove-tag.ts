/**
 * A person takes a book back out of a tag, whoever put it there. Every source's
 * row for it goes, and that is not remembered: a later lookup that still claims
 * the tag brings it back.
 */

import type { TagSlug } from '../../../domain/tagging/tags'
import type { BookRepository } from '../../books/ports'
import { bookLock } from '../../locks'
import type { UnitOfWork } from '../../ports'

export interface RemoveTag {
  bookId: number
  slug: TagSlug
}

export class RemoveTagHandler {
  constructor(
    private readonly books: BookRepository,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /** False when there is no such book, and then nothing is written. */
  async handle(command: RemoveTag): Promise<boolean> {
    return this.unitOfWork.run(async () => {
      const book = await this.books.load(command.bookId)
      if (!book) return false

      book.removeTag(command.slug)
      await this.books.save(book)
      return true
    }, { serialiseOn: [bookLock(command.bookId)] })
  }
}
