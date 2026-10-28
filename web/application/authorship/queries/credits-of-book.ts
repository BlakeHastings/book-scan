import type { CatalogueReadModel } from '../../books/ports'
import type { AuthorReadModel, CreditView } from '../ports'

export interface CreditsOfBook {
  bookId: number
}

/** Who a book credits, in printed order. Null when there is no such book. */
export class CreditsOfBookHandler {
  constructor(
    private readonly catalogue: CatalogueReadModel,
    private readonly authors: AuthorReadModel,
  ) {}

  async handle(query: CreditsOfBook): Promise<CreditView[] | null> {
    if (!(await this.catalogue.detail(query.bookId))) return null
    return this.authors.creditsOf(query.bookId)
  }
}
