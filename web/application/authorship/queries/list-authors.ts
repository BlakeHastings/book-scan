import type { AuthorReadModel, AuthorView } from '../ports'

/**
 * Everybody, with every name they publish under. Not paged: a collection has
 * hundreds of authors where it has thousands of books.
 */
export class ListAuthorsHandler {
  constructor(private readonly authors: AuthorReadModel) {}

  handle(): Promise<AuthorView[]> {
    return this.authors.list()
  }
}
