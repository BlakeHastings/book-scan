import { api, type Misfile, type ShelvingReview, type ShelvingReviewResponse } from './api'
import type { ShelfRange } from '../../shared/shelving'

/**
 * This book's entry in a shelving review, or null when it is not flagged.
 *
 * The test for "is this book misfiled" is the server's, and only the server's.
 * `reviewShelving` (web/shared/shelving.ts) carries carve-outs that comparing
 * a recorded location against a derived one does not: a checked-out book holds
 * no position at all, a book never confirmed onto a shelf cannot be in the
 * wrong place, an unparseable location like "in the box" is excluded from the
 * judgement rather than failed by it, and "s4 b" and "S4B" are the same shelf
 * typed two ways. So the client asks and then looks its book up in the answer,
 * which is all this does.
 */
export function findMisfile(
  review: ShelvingReview | null,
  bookId: number | null,
): Misfile | null {
  if (!review || bookId === null) return null
  return review.misfiles.find((entry) => entry.book.id === bookId) ?? null
}

/**
 * Write down that a person has carried this book to where the order puts it.
 *
 * This is a statement about the physical world, not a way to quiet the screen.
 * A location is descriptive: it records where somebody last saw the book. The
 * only thing that makes this call correct is that the book is now actually on
 * the shelf named by `to`, which is why nothing derives it, nothing offers it
 * in passing, and there is no "dismiss" anywhere near it. Writing the answer
 * we would like to be true would destroy the only record of where the book
 * really is.
 */
export function recordMoved(misfile: Misfile) {
  return api.setLocation(misfile.book.id, misfile.to)
}

/**
 * Whether this book's misfile is one the app opened and can close again.
 *
 * The server decides, the same way it decides what a misfile is, and for the
 * same reason: it is the only side that knows a boundary move was made and
 * that the shelves have not changed since. The client asks and looks its book
 * up in the answer.
 *
 * The two kinds of misfile look identical on screen and are not the same thing.
 * One is an assignment this app made and nobody acted on, and withdrawing it
 * costs nothing because nothing happened. The other is where the order has
 * genuinely moved a book, and the only thing that closes it is carrying the
 * book. Offering "take it back" for the second would move the furniture on the
 * person's behalf and call it an undo.
 */
export function canTakeBack(
  review: ShelvingReviewResponse | null,
  bookId: number | null,
): boolean {
  if (!review || bookId === null) return false
  return review.outstandingMoves.includes(bookId)
}

/**
 * Withdraw a move the person never carried out.
 *
 * The mirror of `recordMoved`, and it is worth saying what it does *not* do.
 * `recordMoved` writes a location, because somebody walked to a shelf and put a
 * book down. This writes none, because nobody did: the book is on the plank the
 * catalogue already records, and what needs undoing is the boundary the app
 * moved. Reaching the same screen by writing a location first would put a
 * statement about the room into the catalogue that nobody made.
 */
export function takeMoveBack(range: ShelfRange, bookId: number) {
  return api.retractMove(range, bookId)
}
