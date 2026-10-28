/**
 * What the authorship reads need from the outside world. Kept apart from
 * `ports.ts`, which holds the repository, so `npm run lint:layers` can tell a
 * query that reads through a read model from one that reaches for the
 * repository a write uses.
 */

/** A person and every name they publish under, as a reader sees them. */
export interface AuthorView {
  id: number
  isCorporate: boolean
  note: string
  /** The primary alias's printed name. */
  primary: string
  aliases: {
    id: number
    displayName: string
    filingName: string
    isPrimary: boolean
  }[]
}

/** One name a book credits. `position` counts from 1, in printed order. */
export interface CreditView {
  position: number
  aliasId: number
  authorId: number
  displayName: string
  filingName: string
}

/** Authors and credits, read for showing rather than for deciding. */
export interface AuthorReadModel {
  /** Everybody, oldest author first. */
  list(): Promise<AuthorView[]>

  /** One person, or null. */
  one(authorId: number): Promise<AuthorView | null>

  /** Who a book credits, in the order the names are printed on it. */
  creditsOf(bookId: number): Promise<CreditView[]>

  /**
   * The id of every book crediting any of this person's names, in any state,
   * ascending. Empty for an author who does not exist.
   */
  booksOf(authorId: number): Promise<number[]>
}
