/**
 * What the tagging application layer needs from the outside world. Nothing
 * here returns rows: a `Tag` is a tag, an `AppliedTag` carries a `TagSlug`, so
 * the domain rule never sees a column name. `npm run lint:layers` enforces the
 * inward-only imports.
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
 * The vocabulary, and which books carry what. Not a generic repository: every
 * method is something the tagging code actually does.
 *
 * No `rename` from slug to slug, deliberately: a slug is the identity rules
 * reference, and rewriting one would break every rule mentioning it.
 * `relabel` changes only the display label.
 */
export interface TagRepository {
  /**
   * Ensures this slug exists, returning the tag it names. Idempotent: a
   * second call with the same slug and a different label keeps the existing
   * label.
   */
  define(slug: TagSlug, label: string, note?: string): Promise<Tag>

  /** Change what a person reads. The slug is untouched, and cannot be given. */
  relabel(slug: TagSlug, label: string): Promise<void>

  /**
   * The vocabulary, or the part at or under one slug. Implemented as a range
   * scan over the sorted `COLLATE "C"` column, not an in-process filter.
   */
  vocabulary(under?: TagSlug): Promise<Tag[]>

  /** Every tag one book carries, from every source. */
  of(bookId: number): Promise<AppliedTag[]>

  /**
   * Writes these applications, replacing the confidence of any already there
   * from the same source. Applying a tag twice is not an error.
   */
  apply(bookId: number, applications: readonly TagApplication[]): Promise<void>

  /**
   * Takes tags off a book. `source` narrows to that source's own rows (what a
   * lookup retracting its claims needs); omitted, removes the tag regardless
   * of who applied it.
   */
  retract(bookId: number, slugs: readonly TagSlug[], source?: TagSource): Promise<void>

  /**
   * Takes a word out of the vocabulary, only while nothing carries it. The
   * "nothing carries it" check must be part of the same statement as the
   * delete, not a check beforehand: `book_tag` cascades from `tag`, so a
   * disagreement between check and delete could take a person's tag off every
   * book they put it on.
   *
   * A rule naming the slug is refused elsewhere, not here: that is
   * placement's concern. `ForgetTagHandler` combines both refusals.
   */
  remove(slug: TagSlug): Promise<boolean>
}

/** A word in the vocabulary as a reader sees it. */
export interface TagView {
  slug: string
  label: string
  note: string
  /** Catalogued books carrying it or anything under it, each counted once. */
  books: number
  /** Whether a placement rule asks for it, whatever the count. */
  ruled: boolean
}

/** A tag on one book, with the label looked up and the provenance kept. */
export interface BookTagView {
  slug: string
  label: string
  source: TagSource
  confidence: TagConfidence
}

/** The vocabulary and a book's tags, read for showing rather than for deciding. */
export interface TagReadModel {
  /** Every tag, or every tag at or under one slug, in slug order. */
  vocabulary(under?: TagSlug): Promise<TagView[]>

  /** What one book carries, from every source. Empty for a book with none, or no such book. */
  ofBook(bookId: number): Promise<BookTagView[]>
}
