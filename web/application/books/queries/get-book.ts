import type { AuthorReadModel, CreditView } from '../../authorship/read-models'
import type { BookView, CatalogueReadModel } from '../read-models'
import { filedUnder } from '../../../shared/shelving'

export interface GetBook {
  id: number
}

/**
 * One book in any state, with its credits beside it: what the book files under
 * is a fact about its first credit's alias, so a reader editing the filing
 * name needs both. `printed` is the names as the book prints them, which an
 * edit that leaves the authors alone has to say again. `filedUnder` is the
 * name its stored sort key files it under, which is the first credit's filing
 * name until that is corrected and then the old one until the book is saved
 * again. Null when there is no such book.
 */
export class GetBookHandler {
  constructor(
    private readonly catalogue: CatalogueReadModel,
    private readonly authors: AuthorReadModel,
  ) {}

  async handle(
    query: GetBook,
  ): Promise<{ book: BookView; authors: CreditView[]; printed: string[]; filedUnder: string } | null> {
    const book = await this.catalogue.detail(query.id)
    if (!book) return null
    const authors = await this.authors.creditsOf(query.id)
    return {
      book,
      authors,
      printed: await this.catalogue.printedNames(query.id),
      filedUnder: filedUnder({ ...book, author_filing: authors[0]?.filingName }),
    }
  }
}
