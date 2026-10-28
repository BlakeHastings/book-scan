/**
 * What the authorship application layer needs from the outside world.
 *
 * Ids appear here, unlike in `application/tagging/ports.ts` where a slug is
 * the identity: an author has no name to be identified by. A printed name
 * identifies an **alias**, so every method that takes a name takes a
 * `PrintedName` rather than a string.
 *
 * No book-scoped transaction port, unlike tagging: restating a book's credits
 * reads nothing, it replaces the whole list, so a race's loser loses the
 * whole statement rather than half of one. `AuthorRepository.credit` is
 * atomic on its own.
 */

import type { Author, PrintedName } from '../../domain/authorship/authors'

/** One name, as the store holds it. */
export interface StoredAlias {
  id: number
  authorId: number
  name: PrintedName
  filing: string
  isPrimary: boolean
}

/** A person and every name they publish under, with the ids to act on them. */
export interface StoredAuthor {
  id: number
  author: Author
  aliases: StoredAlias[]
}

/**
 * Authors, their names, and which books credit which name. Not a generic
 * repository: every method is something the authorship code actually does.
 *
 * No method changes a printed name: an alias is its printed name, and
 * rewriting it would silently change what a book says on its cover. A
 * misspelling becomes a new alias and a merge.
 */
export interface AuthorRepository {
  /**
   * Ensures this name exists as an alias, returning it. Idempotent: a second
   * call with the same name and a different filing name keeps the existing
   * filing name.
   *
   * A name nobody has seen before gets an author of its own: this cannot know
   * a new name is a pseudonym of an existing one.
   */
  introduce(name: PrintedName, filing: string): Promise<StoredAlias>

  /** The alias a printed name means, however it is spelled, or nothing. */
  aliasFor(name: PrintedName): Promise<StoredAlias | null>

  /** Everybody, with every name they publish under. */
  everyone(): Promise<StoredAuthor[]>

  /** One person and all their names. */
  find(authorId: number): Promise<StoredAuthor | null>

  /** Change what one name files under. The printed name is untouched, and cannot be given. */
  file(aliasId: number, filing: string): Promise<void>

  /**
   * Two authors turn out to be one person: `from` is emptied into `into`.
   * Every alias moves keeping its printed and filing name, so no book moves
   * on the shelf. The emptied author is deleted. See `Author.absorbing`.
   */
  absorb(intoId: number, fromId: number): Promise<void>

  /** Who a book credits, in the order the names are printed on it. */
  creditsOf(bookId: number): Promise<StoredAlias[]>

  /**
   * Restate who a book credits, in order. Atomic: the book's credits afterwards
   * are exactly these, or the statement did nothing.
   */
  credit(bookId: number, aliasIds: readonly number[]): Promise<void>

  /**
   * Every book credited to any of these names: asked over all of one
   * person's aliases, it answers "everything by this person", while each
   * name still files where it is printed.
   */
  booksCreditedTo(aliasIds: readonly number[]): Promise<number[]>
}
