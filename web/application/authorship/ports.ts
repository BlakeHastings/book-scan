/**
 * What the authorship application layer needs from the outside world, said as
 * interfaces it owns.
 *
 * The third port file in the codebase, and the same shape as the two before it:
 * the arrow points inwards, nothing here names a driver, a query builder or a
 * connection, and `npm run lint:layers` checks that rather than a reviewer.
 *
 * Ids do appear here, unlike in `application/tagging/ports.ts` where a slug is
 * the identity. An author has no name to be identified by, on purpose, so there
 * is nothing else to name one with. A printed name identifies an **alias**, and
 * every method that takes a name takes a `PrintedName` rather than a string.
 *
 * There is no book-scoped transaction port, and the absence is worth a sentence
 * because tagging has one. Restating a source's tags is a read then a write that
 * decides what to delete from what it read, so two of them racing can each throw
 * away the other's decision. Restating a book's credits reads nothing: it is the
 * whole list, replaced, so the loser of a race loses the whole statement rather
 * than half of one. `AuthorRepository.credit` is atomic on its own.
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
 * Authors, their names, and which books credit which name.
 *
 * Small on purpose, and not a generic repository. Every method is one of the
 * things the authorship code actually does.
 *
 * **There is no method that changes a printed name.** An alias is its printed
 * name: a book credits it, and rewriting it would silently change what a book
 * says on its cover. A name spelled wrong is a new alias and a merge, both of
 * which are here.
 */
export interface AuthorRepository {
  /**
   * Make sure this name exists as an alias, and answer it.
   *
   * Idempotent, and **it never rewrites an existing alias's filing name**. A
   * second caller arriving with the same name and a different filing name gets
   * the filing name that is already there: filing names are changed by somebody
   * deciding to change one, through `file`, not as a side effect of saving a
   * book whose author somebody has already filed by hand.
   *
   * A name nobody has seen before gets an author of its own. That is the
   * conservative half of the same rule the migration follows: this cannot know
   * that a new name is a pseudonym of an existing one, and guessing wrong in
   * that direction is the guess nothing can undo.
   */
  introduce(name: PrintedName, filing: string): Promise<StoredAlias>

  /** The alias a printed name means, however it is spelled, or nothing. */
  aliasFor(name: PrintedName): Promise<StoredAlias | null>

  /** Everybody, with every name they publish under. */
  everyone(): Promise<StoredAuthor[]>

  /** One person and all their names. */
  find(authorId: number): Promise<StoredAuthor | null>

  /**
   * Change what one name files under. The printed name is untouched, and cannot
   * be given. This is `author_filing`'s override, arrived at its destination.
   */
  file(aliasId: number, filing: string): Promise<void>

  /**
   * Two authors turn out to be one person: `from` is emptied into `into`.
   *
   * Every alias moves, keeping its printed and its filing name, so no book moves
   * on the shelf. The emptied author is deleted, because an author with no name
   * is nobody. See `Author.absorbing`, which is where the rule is.
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
   * Every book credited to any of these names.
   *
   * The join the comma-joined string could not do, and the reason the model
   * splits an author from their aliases: asked over all of one person's names it
   * answers "everything by this person", while each name still files where it is
   * printed.
   */
  booksCreditedTo(aliasIds: readonly number[]): Promise<number[]>
}
