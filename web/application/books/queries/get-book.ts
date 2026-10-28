import type { AuthorReadModel, CreditView } from '../../authorship/ports'
import type { BookView, CatalogueReadModel } from '../ports'

export interface GetBook {
  id: number
}

/**
 * One book in any state, with its credits beside it: what the book files under
 * is a fact about its first credit's alias, so a reader editing the filing
 * name needs both. Null when there is no such book.
 */
export class GetBookHandler {
  constructor(
    private readonly catalogue: CatalogueReadModel,
    private readonly authors: AuthorReadModel,
  ) {}

  async handle(query: GetBook): Promise<{ book: BookView; authors: CreditView[] } | null> {
    const book = await this.catalogue.detail(query.id)
    if (!book) return null
    return { book, authors: await this.authors.creditsOf(query.id) }
  }
}
