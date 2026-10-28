import type { CatalogueReadModel } from '../../books/ports'
import type { BookTagView, TagReadModel } from '../ports'

export interface TagsOfBook {
  bookId: number
}

/** What one book carries. Null when there is no such book, which is not the same as no tags. */
export class TagsOfBookHandler {
  constructor(
    private readonly catalogue: CatalogueReadModel,
    private readonly tags: TagReadModel,
  ) {}

  async handle(query: TagsOfBook): Promise<BookTagView[] | null> {
    if (!(await this.catalogue.detail(query.bookId))) return null
    return this.tags.ofBook(query.bookId)
  }
}
