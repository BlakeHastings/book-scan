/**
 * `AuthorReadModel` over the author repository's own statements, so the fold
 * that decides which printed names are one name is not written a second time.
 * Nothing here writes.
 */

import type { StoredAuthor } from '../../application/authorship/ports'
import type {
  AuthorReadModel, AuthorView, CreditView,
} from '../../application/authorship/read-models'
import type { Db } from '../../server/driver'
import { DrizzleAuthorRepository } from './author-repository'

/**
 * An author as a reader sees one. Exported because the two author write routes
 * answer the author they changed in this same shape.
 */
export function authorView(stored: StoredAuthor): AuthorView {
  return {
    id: stored.id,
    isCorporate: stored.author.isCorporate,
    note: stored.author.note,
    primary: stored.author.primary.name.value,
    aliases: stored.aliases.map((alias) => ({
      id: alias.id,
      displayName: alias.name.value,
      filingName: alias.filing,
      isPrimary: alias.isPrimary,
    })),
  }
}

export class DrizzleAuthorReadModel implements AuthorReadModel {
  private readonly authors: DrizzleAuthorRepository

  constructor(db: Db) {
    this.authors = new DrizzleAuthorRepository(db)
  }

  async list(): Promise<AuthorView[]> {
    return (await this.authors.everyone()).map(authorView)
  }

  async one(authorId: number): Promise<AuthorView | null> {
    const found = await this.authors.find(authorId)
    return found ? authorView(found) : null
  }

  async creditsOf(bookId: number): Promise<CreditView[]> {
    return (await this.authors.creditsOf(bookId)).map((alias, at) => ({
      position: at + 1,
      aliasId: alias.id,
      authorId: alias.authorId,
      displayName: alias.name.value,
      filingName: alias.filing,
    }))
  }

  async booksOf(authorId: number): Promise<number[]> {
    const found = await this.authors.find(authorId)
    if (!found) return []
    return this.authors.booksCreditedTo(found.aliases.map((alias) => alias.id))
  }
}
