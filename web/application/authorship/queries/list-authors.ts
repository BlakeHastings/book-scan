import type { AuthorReadModel, AuthorView } from '../read-models'

export interface ListAuthors {
  /** Only people with a name containing this, ignoring case and accents. */
  name?: string
}

/**
 * Everybody, with every name they publish under. Not paged: a collection has
 * hundreds of authors where it has thousands of books.
 */
export class ListAuthorsHandler {
  constructor(private readonly authors: AuthorReadModel) {}

  async handle(query: ListAuthors = {}): Promise<AuthorView[]> {
    const everyone = await this.authors.list()
    const wanted = folded(query.name ?? '').trim()
    if (!wanted) return everyone
    return everyone.filter((one) => one.aliases.some((alias) =>
      folded(alias.displayName).includes(wanted) || folded(alias.filingName).includes(wanted)))
  }
}

/** So `mieville` finds Miéville, as the book search does. */
function folded(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ø/g, 'o')
}
