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
 * the plank the row named, which is why nothing derives it, nothing offers it
 * in passing, and there is no "dismiss" anywhere near it. Writing the answer
 * we would like to be true would destroy the only record of where the book
 * really is.
 *
 * The plank goes over as an id, not as the label the row showed. `to` is a
 * rendering of that plank and reads differently the moment somebody names the
 * piece it is on, so sending it back would be asking the server to work out
 * which place was meant from a string the server itself wrote (#356).
 */
export function recordMoved(misfile: Misfile) {
  return api.setLocationIn(misfile.book.id, misfile.toAreaId)
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
 * The books this review could not judge at all, and what to say about them.
 *
 * **A separate thing from a misfile, and the difference is #356.** A misfile is
 * a book the check looked at and disagreed with; this is a book the check could
 * not look at, because the run it files into has no area to put it on. The two
 * used to be told apart only by an entry in `excluded` that nothing drew, so a
 * check which had quietly set 181 of 238 books aside came back with an empty
 * list, and an empty list reads as "everything is fine".
 *
 * Zero is the ordinary answer and the caller draws nothing for it. Anything else
 * is a fact about the furniture that somebody has to be told.
 */
export function notChecked(review: ShelvingReview | null): { count: number; said: string } {
  const count = (review?.excluded ?? [])
    .filter((entry) => entry.reason === 'unplaceable').length
  if (!count) return { count: 0, said: '' }

  const they = count === 1 ? 'it' : 'them'
  return {
    count,
    said:
      `${count === 1 ? 'One book is' : `${count} books are`} on this run and ` +
      `there is nowhere on the furniture to put ${they}, so nothing below has ` +
      `been said about ${they}. Check that this run still points at a piece of ` +
      'furniture with an area on it.',
  }
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
