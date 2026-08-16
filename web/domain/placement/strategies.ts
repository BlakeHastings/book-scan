/**
 * How a run of books is ordered, and where an area gets its answer from.
 *
 * Today there is one order in the whole catalogue: `books.sort_key`, which is
 * the flattened (author filing, series, title filing) tuple `shared/shelving.ts`
 * builds. `docs/data-model.md` makes that one strategy among several, chosen per
 * collection, per fixture or per area.
 *
 * ## `inherit` is a value, not an absence
 *
 * It is a row in `sort_strategy` and a string in this file. No null in this
 * schema means anything, which is the owner's decision and the reason the
 * cascade below reads as a fold over three stated values rather than as a chain
 * of `??`.
 *
 * ## Tiebreaks are fixed per strategy, and the types are the enforcement
 *
 * `tag` means tag slug, then author filing, then title filing. It does **not**
 * mean "then whatever the collection's default is". If it did, changing a
 * setting on the collection would silently reorder every run that had
 * explicitly chosen `tag`, and a run is only ever reordered by somebody
 * changing that run.
 *
 * That is not written here as a comment and then hoped for: `orderBy` takes a
 * strategy and a list of books, and there is nowhere in its signature to pass a
 * collection default. A tiebreak that consulted one could not be written without
 * changing the shape of this function, which is a change a reviewer would see.
 *
 * ## Only `author` is exercised against real data
 *
 * Its key is `books.sort_key` itself, because that column already **is** author
 * then series then title, flattened by `buildSortKey` and byte-ordered by
 * `COLLATE "C"`. So the strategy that the whole catalogue is on today reproduces
 * the existing order exactly rather than approximately, which is what
 * `infrastructure/db/placement-backfill.test.ts` checks book by book.
 *
 * The other three are the vocabulary `docs/data-model.md` settles, declared now
 * for the same reason `author_alias.filing_name` carries its collation now: the
 * ordering foundation is the wrong thing to add a component to once shelves are
 * built on it.
 */

import { SEP } from '../../shared/shelving'

/**
 * Every strategy `sort_strategy` holds, which is the app's vocabulary and not a
 * list anybody edits in the database.
 */
export const SORT_STRATEGIES = ['inherit', 'author', 'title', 'published', 'tag'] as const

export type SortStrategy = typeof SORT_STRATEGIES[number]

/** "Ask the level above." A row, never a null. */
export const INHERIT = 'inherit'

/** A strategy that actually orders something, which `inherit` does not. */
export type OrderingStrategy = Exclude<SortStrategy, typeof INHERIT>

/**
 * The strategies a whole collection may fall back on, which is not all of them.
 *
 * Two are missing and each for its own stated reason.
 *
 * `inherit` is refused by the schema: there is nothing above a collection to
 * ask, and the check constraint on `collection.default_sort_strategy` says so
 * rather than leaving it to whoever writes the next screen.
 *
 * `tag` is the interesting one. It orders a run by its first tag slug, which is
 * a sensible thing to ask of one area of one bookcase and a meaningless thing
 * to ask of a whole house: it would file every book somebody owns by an
 * alphabetical accident of the vocabulary, and the seed row for it has said
 * "Never the collection default" since the table was written. That sentence was
 * a note nobody could enforce until something offered the choice; #350 offers
 * it, so the note becomes this list, and the route that writes the column reads
 * it rather than restating it.
 */
export const COLLECTION_STRATEGIES: readonly OrderingStrategy[] = ['author', 'title', 'published']

/**
 * Whether a strategy is offerable yet.
 *
 * `sort_strategy.available` exists so a strategy can be a row without being a
 * choice, which is where colour sorting waits until there is a colour column to
 * sort by. Every strategy this app can compute is available today, so nothing
 * is false here and the flag is carried rather than invented later.
 */
export const AVAILABLE: Record<SortStrategy, boolean> = {
  inherit: true, author: true, title: true, published: true, tag: true,
}

/** What a strategy needs to know about a book in order to order it. */
export interface Orderable {
  id: number
  /**
   * The flattened (author filing, series, title filing) tuple. This is the
   * column every shelf in this catalogue is ordered by today.
   */
  sortKey: string
  authorFiling: string
  titleFiling: string
  /** As printed, which is what `books.published` holds: often a bare year. */
  published: string
  /** Every slug this book carries, in slug order. */
  tagSlugs: readonly string[]
}

/** The unit separator, so a component boundary sorts below every character. */
const join = (...parts: string[]): string => parts.join(SEP)

/**
 * The ordering key each strategy builds, and with it the whole tiebreak chain.
 *
 * Read as a list of components, first to last:
 *
 * | Strategy | Orders by |
 * | --- | --- |
 * | `author` | author filing, series, title filing |
 * | `title` | title filing, then author filing |
 * | `published` | published, then author filing, then title filing |
 * | `tag` | first tag slug, then author filing, then title filing |
 *
 * Author filing and title filing are the last two of every chain that does not
 * start with them, which is what makes two books nothing else separates land in
 * the order somebody would look for them in.
 */
const KEY: Record<OrderingStrategy, (book: Orderable) => string> = {
  author: (book) => book.sortKey,
  title: (book) => join(book.titleFiling, book.authorFiling),
  published: (book) => join(book.published, book.authorFiling, book.titleFiling),
  tag: (book) => join(book.tagSlugs[0] ?? '', book.authorFiling, book.titleFiling),
}

/**
 * The strategy a run is ordered by: collection, then fixture, then area, and
 * the nearest one that is not `inherit` wins.
 *
 * The collection's own value is not allowed to be `inherit`, because there is
 * nothing above it to ask, and a collection that inherited from nowhere would
 * be exactly the absent value this schema does not have.
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
 * A run in order.
 *
 * `id` is the final tiebreak everywhere, so the answer is total: two books a
 * strategy cannot separate still come back in a fixed order rather than in
 * whatever order the rows arrived. Byte comparison, not `localeCompare`, for the
 * reason `COLLATE "C"` is on the columns: a linguistic comparison folds case and
 * files accented characters beside their unaccented forms, which does not throw,
 * it reorders a shelf.
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
