import { api, type Misfile, type ShelvingReview } from './api'

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
