import { api, type Misfile, type ShelvingReview, type ShelvingReviewResponse } from './api'
import type { ShelfRange } from '../../shared/shelving'

/**
 * This book's entry in a shelving review, or null when it is not flagged.
 *
 * The test for "is this book misfiled" is the server's, and only the
 * server's: it carries carve-outs a naive comparison would miss (a
 * checked-out book holds no position, a book never confirmed onto a shelf
 * cannot be in the wrong place, an unparseable location is excluded rather
 * than failed, and two spellings of one shelf are the same shelf). The
 * client only asks and looks its book up in the answer.
 */
export function findMisfile(
  review: ShelvingReview | null,
  bookId: number | null,
): Misfile | null {
  if (!review || bookId === null) return null
  return review.misfiles.find((entry) => entry.book.id === bookId) ?? null
}

/**
 * Write down that a person has carried this book to where the order puts
 * it.
 *
 * A statement about the physical world, not a way to quiet the screen: a
 * location records where somebody last saw the book, so nothing here
 * derives it, offers it in passing, or lets it be dismissed.
 *
 * The plank goes over as an id, not the label the row showed: the label
 * is a rendering and reads differently the moment somebody names the
 * piece it is on.
 */
export function recordMoved(misfile: Misfile) {
  return api.setLocationIn(misfile.book.id, misfile.toAreaId)
}

/**
 * Whether this book's misfile is one the app opened and can close again.
 *
 * The server decides, the same way it decides what a misfile is: it is
 * the only side that knows a boundary move was made and that the shelves
 * have not changed since.
 *
 * The two kinds of misfile look identical on screen and are not the same
 * thing: one is an assignment nobody acted on and costs nothing to
 * withdraw, the other is a book the order has genuinely moved, closed
 * only by carrying it. Offering "take it back" for the second would move
 * the furniture on the person's behalf and call it an undo.
 */
export function canTakeBack(
  review: ShelvingReviewResponse | null,
  bookId: number | null,
): boolean {
  if (!review || bookId === null) return false
  return review.outstandingMoves.includes(bookId)
}

/**
 * The books this review could not judge at all, and what to say about
 * them.
 *
 * A separate thing from a misfile: a misfile is a book the check looked
 * at and disagreed with, this is a book the check could not look at,
 * since the run it files into has no area to put it on.
 *
 * Zero is the ordinary answer and the caller draws nothing for it.
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
 * Withdraw a move the person never carried out. The mirror of
 * `recordMoved`: that writes a location because somebody walked to a
 * shelf and put a book down, this writes none, since nobody did. Writing
 * a location first would put a statement about the room into the
 * catalogue that nobody made.
 */
export function takeMoveBack(range: ShelfRange, bookId: number) {
  return api.retractMove(range, bookId)
}
