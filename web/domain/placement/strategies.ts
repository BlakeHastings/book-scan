/** Ordering strategies for a run of books. See docs/data-model.md. */

import { SEP } from '../../shared/shelving'

export const SORT_STRATEGIES = ['inherit', 'author', 'title', 'published', 'tag'] as const

export type SortStrategy = typeof SORT_STRATEGIES[number]

/** A stored value meaning "ask the level above", not a null. */
export const INHERIT = 'inherit'

/** A strategy that actually orders something, which `inherit` does not. */
export type OrderingStrategy = Exclude<SortStrategy, typeof INHERIT>

/**
 * Fallback strategies a whole collection may use. Excludes `inherit` (nothing
 * above a collection to ask; the check constraint on
 * `collection.default_sort_strategy` enforces it) and `tag` (ordering a whole
 * collection by first tag slug is not a meaningful default, only per-area).
 */
export const COLLECTION_STRATEGIES: readonly OrderingStrategy[] = ['author', 'title', 'published']

/** Whether a strategy is offerable yet, separate from whether it can be computed. */
export const AVAILABLE: Record<SortStrategy, boolean> = {
  inherit: true, author: true, title: true, published: true, tag: true,
}

export interface Orderable {
  id: number
  /** Flattened (author filing, series, title filing) tuple; the column every shelf is ordered by today. */
  sortKey: string
  authorFiling: string
  titleFiling: string
  /** As printed; often a bare year. */
  published: string
  /** Every slug this book carries, in slug order. */
  tagSlugs: readonly string[]
}

/** The unit separator, so a component boundary sorts below every character. */
const join = (...parts: string[]): string => parts.join(SEP)

const KEY: Record<OrderingStrategy, (book: Orderable) => string> = {
  author: (book) => book.sortKey,
  title: (book) => join(book.titleFiling, book.authorFiling),
  published: (book) => join(book.published, book.authorFiling, book.titleFiling),
  tag: (book) => join(book.tagSlugs[0] ?? '', book.authorFiling, book.titleFiling),
}

/**
 * Nearest non-`inherit` wins: area, then fixture, then collection. The
 * collection value itself is never `inherit`; the check constraint enforces it.
 */
export function strategyFor(
  collection: OrderingStrategy,
  fixture: SortStrategy,
  area: SortStrategy,
): OrderingStrategy {
  if (area !== INHERIT) return area
  if (fixture !== INHERIT) return fixture
  return collection
}

/**
 * `id` is the final tiebreak, so two books a strategy cannot separate still
 * sort in a fixed order. Byte comparison, not `localeCompare`, to match
 * `COLLATE "C"`: a locale-aware compare folds case and accents and would
 * reorder the shelf.
 */
export function orderBy<T extends Orderable>(strategy: OrderingStrategy, books: T[]): T[] {
  const keyed = books.map((book) => ({ book, key: KEY[strategy](book) }))
  keyed.sort((a, b) => {
    if (a.key < b.key) return -1
    if (a.key > b.key) return 1
    return a.book.id - b.book.id
  })
  return keyed.map((entry) => entry.book)
}
