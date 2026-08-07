/**
 * What the tagging application layer needs from the outside world, said as
 * interfaces it owns.
 *
 * The second port file in the codebase, and deliberately the same shape as
 * `application/shelving/ports.ts`: the arrow points inwards, nothing here names
 * a driver, a query builder or a connection, and `npm run lint:layers` is what
 * checks that rather than a reviewer.
 *
 * Nothing here returns rows. A `Tag` is a tag and an `AppliedTag` carries a
 * `TagSlug`, so column names stop at the implementation and the rule in
 * `domain/tagging/tags.ts` never has to know one.
 */

import type { AppliedTag, TagConfidence, TagSlug, TagSource } from '../../domain/tagging/tags'

/** A tag as the vocabulary holds it. */
export interface Tag {
  id: number
  slug: TagSlug
  label: string
  note: string
}

/** A tag being written onto a book, with the provenance that goes with it. */
export interface TagApplication {
  slug: TagSlug
  source: TagSource
  confidence: TagConfidence
  addedAt: string
}

/**
 * The vocabulary, and which books carry what.
 *
 * Small on purpose, and not a generic repository. Every method is one of the
 * things the tagging code actually does; a `find(criteria)` would be a query
 * builder wearing a repository's name.
 *
 * **There is no `rename` that takes a slug to a slug, and that absence is the
 * design.** A slug is the identity, rules reference it, and rewriting one makes
 * every rule mentioning it stop matching. `relabel` is the whole of renaming.
 */
export interface TagRepository {
  /**
   * Make sure this slug exists, and answer the tag it names.
   *
   * Idempotent, and **it never rewrites an existing tag's slug or label**. A
   * second caller arriving with the same slug and a different label gets the
   * label that is already there: labels are changed by somebody deciding to
   * change one, through `relabel`, not as a side effect of a catalogue lookup
   * spelling a heading differently this week.
   */
  define(slug: TagSlug, label: string, note?: string): Promise<Tag>

  /** Change what a person reads. The slug is untouched, and cannot be given. */
  relabel(slug: TagSlug, label: string): Promise<void>

  /**
   * The vocabulary, or the part of it at or under one slug.
   *
   * The prefix is answered as a range over the slug rather than by filtering in
   * this process, which is what `COLLATE "C"` on that column bought.
   */
  vocabulary(under?: TagSlug): Promise<Tag[]>

  /** Every tag one book carries, from every source. */
  of(bookId: number): Promise<AppliedTag[]>

  /**
   * Write these applications, replacing the confidence of any that are already
   * there from the same source. Applying a tag twice is not an error: somebody
   * saying a thing again means the same as saying it once.
   */
  apply(bookId: number, applications: readonly TagApplication[]): Promise<void>

  /**
   * Take tags off a book.
   *
   * `source` narrows it to that source's own rows, which is what a lookup
   * retracting its claims needs and is the only thing a lookup is allowed to
   * do. Omitting it removes the tag whoever applied it, which is what a person
   * asking for it to be gone means.
   */
  retract(bookId: number, slugs: readonly TagSlug[], source?: TagSource): Promise<void>
}

/**
 * Atomicity, and mutual exclusion per book.
 *
 * Restating a source's tags is a read then a write, and two of them racing on
 * one book can each decide what the other is about to delete. That is the same
 * shape as the separator renumbering defect stage G fixed, so it is prevented
 * the same way: the work is serialised on the book.
 *
 * Deliberately a second, narrower port rather than a shared `Transactions`.
 * `application/shelving/ports.ts` serialises on a shelf range, this serialises
 * on a book, and a single interface covering both would be a lock namespace
 * with two meanings, which is a lock that serialises against nothing.
 */
export interface BookTransactions {
  /** Run `work` atomically, and serialised against other work on this book. */
  forBook<T>(bookId: number, work: () => Promise<T>): Promise<T>
}
