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

/** The scan was a mistake. A state, and not a row anybody deletes. */
export const DISCARDED: BookState = 'discarded'

/**
 * The states a book is in before anybody has said where it goes.
 *
 * **This is the queue**, and saying so here is the second half of #183: the
 * queue was a table and is now three of the seven names above. `queued_books`
 * is this list written in SQL, and every statement that lists, counts or
 * searches the queue reads that view for the same reason the ordering
 * statements read `shelved_books`. There is one predicate and it is in one
 * place.
 *
 * The order is the order a book moves through them, which is the order the
 * queue lists nothing in: a queue is read newest first, by id. It is kept
 * because it is the order `BOOK_STATES` uses and a second ordering of the same
 * three names would be a second thing to keep in step.
 */
export const QUEUED_STATES = ['scanned', 'unidentified', 'identified'] as const

export type QueuedState = (typeof QUEUED_STATES)[number]

/** Whether a book is still waiting to be identified or placed. */
export function isQueued(state: BookState): state is QueuedState {
  return (QUEUED_STATES as readonly string[]).includes(state)
}

/**
 * The states in which a book is part of the collection.
 *
 * The third relation, and the one that answers the question #204 left open at
 * `Store.listRange`: what `GET /api/books` should say about a book that has
 * been scanned and not identified. It should say nothing, and now that such a
 * row can exist the reason can be stated rather than guessed at. A book with no
 * title, no author and no shelf range is not a catalogue entry; it is a
 * photograph of something, and it is already listed in the place built to show
 * it and act on it. Listing it a second time would put a nameless row in the
 * middle of somebody's library.
 *
 * `checked_out` is in, because a book in a box on the floor is still owned and
 * the library listing is the only place some of them appear. `withdrawn` is in
 * for the same reason read the other way: it was catalogued, and its row is the
 * archive of that. `discarded` is out, because the scan was a mistake and there
 * was never a book.
 *
 * **On the day this lands it holds exactly the rows `books` held**, since
 * `shelved` and `checked_out` were the only two states anything could write. So
 * every count and every listing is unchanged, and that is checkable rather than
 * asserted.
 */
export const CATALOGUED_STATES = ['shelved', 'checked_out', 'withdrawn'] as const

/**
 * What the queue used to call each of those states, and still calls them on the
 * wire.
 *
 * The queue table is gone and its `status` column with it, but `pending`,
 * `ready` and `failed` are still what `GET /api/captures` answers with and what
 * the client, the browser suite and the queue badge all read. Translating here
 * rather than renaming the wire is deliberate: this change moves a table, and a
 * table move that also renames every field the client reads is a change nobody
 * can review as one thing. The vocabularies collapse into one when the routes
 * become book routes.
 *
 * The pairing is not arbitrary. `pending` meant nothing had read the
 * photographs, which is `scanned`. `failed` meant they were read and no
 * catalogue had the book, which is `unidentified`, and the word is better:
 * nothing failed, the book is simply not in anybody's catalogue. `ready` meant
 * confirmed and waiting to be put somewhere, which is `identified`.
 */
export const STATE_OF_QUEUE_STATUS = {
  pending: 'scanned',
  ready: 'identified',
  failed: 'unidentified',
} as const satisfies Record<string, QueuedState>

/** The same pairing read the other way, for the rows going out to a client. */
export const QUEUE_STATUS_OF_STATE = {
  scanned: 'pending',
  identified: 'ready',
  unidentified: 'failed',
} as const satisfies Record<QueuedState, keyof typeof STATE_OF_QUEUE_STATUS>
