/**
 * Every state a book may be in. See docs/data-model.md.
 *
 * Only `shelved` is on a shelf. `Store.neighbours` and `Shelves.booksIn` read
 * the `shelved_books` view rather than filtering `books` themselves; the
 * partial index `idx_books_shelved` must carry the same predicate as that view
 * or it stops being an index seek.
 */

/** Order matches the life of a book; the check constraint reads it in this order. */
export const BOOK_STATES = [
  'scanned',
  /** Read, and no catalogue has it. */
  'unidentified',
  /** Confirmed, waiting to be put somewhere. */
  'identified',
  /** The only state on a shelf. */
  'shelved',
  /** Off the shelf, still owned. No column records where it was; it is placed again by the rules on return. */
  'checked_out',
  /** Given away, sold, lost. Terminal: nothing is deleted. */
  'withdrawn',
  /** The scan was a mistake. */
  'discarded',
] as const

export type BookState = (typeof BOOK_STATES)[number]

/** Must match the literal in the `shelved_books` view and `idx_books_shelved` predicates. */
export const SHELVED: BookState = 'shelved'

export const CHECKED_OUT: BookState = 'checked_out'

/** Distinct from `discarded`: this book existed and was owned, so `catalogued_books` includes it. */
export const WITHDRAWN: BookState = 'withdrawn'

export const DISCARDED: BookState = 'discarded'

/**
 * The states before a book is placed. Mirrored in SQL as the `queued_books`
 * view. Order follows `BOOK_STATES`; the queue itself is displayed newest
 * first by id, not in this order.
 */
export const QUEUED_STATES = ['scanned', 'unidentified', 'identified'] as const

export type QueuedState = (typeof QUEUED_STATES)[number]

/** Whether a book is still waiting to be identified or placed. */
export function isQueued(state: BookState): state is QueuedState {
  return (QUEUED_STATES as readonly string[]).includes(state)
}

/**
 * Books considered part of the collection, for `GET /api/books`. Queue states
 * are excluded (nothing catalogued yet to show), as is `discarded` (never was
 * a book). `checked_out` and `withdrawn` are included: both were catalogued
 * and are still owned or were.
 */
export const CATALOGUED_STATES = ['shelved', 'checked_out', 'withdrawn'] as const

/**
 * Wire vocabulary for queue states, used by `GET /api/captures`, the client
 * and the browser suite. `failed` does not mean an error: it maps to
 * `unidentified`, meaning no catalogue matched.
 */
export const STATE_OF_QUEUE_STATUS = {
  pending: 'scanned',
  ready: 'identified',
  failed: 'unidentified',
} as const satisfies Record<string, QueuedState>

/** The reverse mapping, for rows going out to a client. */
export const QUEUE_STATUS_OF_STATE = {
  scanned: 'pending',
  identified: 'ready',
  unidentified: 'failed',
} as const satisfies Record<QueuedState, keyof typeof STATE_OF_QUEUE_STATUS>
