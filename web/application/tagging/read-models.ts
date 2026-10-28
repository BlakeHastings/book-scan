/**
 * What the tagging reads need from the outside world. Kept apart from
 * `ports.ts`, which holds the repository, so `npm run lint:layers` can tell a
 * query that reads through a read model from one that reaches for the
 * repository a write uses.
 */

import type { TagConfidence, TagSlug, TagSource } from '../../domain/tagging/tags'

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
