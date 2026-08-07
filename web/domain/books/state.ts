/**
 * What state a book is in, and the one state that reaches a shelf.
 *
 * A book exists from its first photograph, so the thing the queue holds and the
 * thing on the shelf are the same kind of thing at different points in its life.
 * `docs/data-model.md` settles the seven names and what each one means; this is
 * that list, said once, so the check constraint, the schema, the migration and
 * the two files that read a shelf all agree by construction rather than by four
 * people spelling the same string.
 *
 * ## Only `shelved` is on a shelf, and that is the whole safety property
 *
 * `books` drives shelf ordering and misfile detection. Until #183 the rows that
 * had no business in either were kept out by living in a different table
 * entirely, and collapsing that means every ordering query needs to say which
 * states it wants. Saying it in every query is the arrangement that works until
 * somebody writes the next query.
 *
 * So it is said once, in SQL, as the `shelved_books` view: `Store.neighbours`
 * and `Shelves.booksIn` read that view and have nothing to forget. The partial
 * index beside it (`idx_books_shelved`) carries the same predicate, so the view
 * is an index seek rather than a filter over the whole catalogue.
 *
 * **Nothing here is a transition table.** Which state may follow which is drawn
 * in `docs/data-model.md` and is not enforced anywhere yet, because nothing in
 * this revision moves a book through more than the two transitions
 * `Store.setCheckedOut` already made. A rule with no caller is a guess about
 * what the cut-over will want.
 */

/**
 * Every state a book may be in, in the order `docs/data-model.md` lists them.
 *
 * The order is the life of a book and is worth keeping: it is what the check
 * constraint reads, and a list somebody re-sorted alphabetically would put
 * `checked_out` before `discarded` before `identified` and stop saying anything.
 */
export const BOOK_STATES = [
  /** Photographs taken, nothing read yet. */
  'scanned',
  /** Read, and no catalogue has it. */
  'unidentified',
  /** Confirmed, waiting to be put somewhere. */
  'identified',
  /** Somebody put it there and said so. The only state on a shelf. */
  'shelved',
  /**
   * Off the shelf, still owned. Remembers no area: on return it is placed
   * again by the rules, which is why no column here records where it was.
   */
  'checked_out',
  /** Given away, sold, lost. Terminal and archival: nothing is deleted. */
  'withdrawn',
  /** The scan was a mistake. */
  'discarded',
] as const

export type BookState = (typeof BOOK_STATES)[number]

/**
 * The state that puts a book on a shelf.
 *
 * Named rather than spelled, because it is the literal in the view's predicate,
 * in the partial index's predicate and in every write that files a book, and
 * those three agreeing is the difference between a shelf and a shelf with a
 * half-identified row in it.
 */
export const SHELVED: BookState = 'shelved'

/** Off the shelf and still owned, which is a different thing from not filed. */
export const CHECKED_OUT: BookState = 'checked_out'
