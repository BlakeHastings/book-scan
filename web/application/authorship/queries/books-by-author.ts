import type { BookView, CatalogueReadModel } from '../../books/ports'
import type { AuthorReadModel, AuthorView } from '../ports'

export interface BooksByAuthor {
  authorId: number
}

/**
 * Everything by this person, asked of the author rather than of one name, so a
 * pseudonym's books come back with the rest while each still files where it is
 * printed.
 *
 * A book in any state, by id, in id order: a queued book already credited is
 * still this person's. That is wider than a catalogue listing, which is why
 * this does not go through `CatalogueReadModel.list`.
 */
export class BooksByAuthorHandler {
  constructor(
    private readonly authors: AuthorReadModel,
    private readonly catalogue: CatalogueReadModel,
  ) {}

  async handle(query: BooksByAuthor): Promise<{ author: AuthorView; books: BookView[] } | null> {
    const author = await this.authors.one(query.authorId)
    if (!author) return null

    const ids = await this.authors.booksOf(query.authorId)
    const books = await Promise.all(ids.map((id) => this.catalogue.detail(id)))
    return { author, books: books.filter((book): book is BookView => book !== null) }
  }
}
