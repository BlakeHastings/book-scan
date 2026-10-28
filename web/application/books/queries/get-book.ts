import type { AuthorReadModel, CreditView } from '../../authorship/read-models'
import type { BookView, CatalogueReadModel } from '../read-models'

export interface GetBook {
  id: number
}

/**
 * One book in any state, with its credits beside it: what the book files under
 * is a fact about its first credit's alias, so a reader editing the filing
 * name needs both. `printed` is the names as the book prints them, which an
 * edit that leaves the authors alone has to say again. Null when there is no
 * such book.
 */
export class GetBookHandler {
  constructor(
    private readonly catalogue: CatalogueReadModel,
    private readonly authors: AuthorReadModel,
  ) {}

  async handle(
    query: GetBook,
  ): Promise<{ book: BookView; authors: CreditView[]; printed: string[] } | null> {
    const book = await this.catalogue.detail(query.id)
    if (!book) return null
    return {
      book,
      authors: await this.authors.creditsOf(query.id),
      printed: await this.catalogue.printedNames(query.id),
    }
  }
}
