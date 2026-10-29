/**
 * The one sentence the shelving step leads with, short enough to read at a
 * bookcase with a book in one hand: "Shelf 1A, between Herbert and Le Guin".
 *
 * `Placement.instruction` is the long form and stays as it is: other readers
 * (the API, the detail view's fallback card) still use it.
 */

import { bestKnownAuthor, type Neighbour } from '../../shared/shelving'
import type { PlacementResponse, StripBook } from './api'

/** "Le Guin, Ursula K." reads as "Le Guin"; a book with no author is named by its title. */
function nameOf(book: { title: string; authorFiling: string; authors?: string }): string {
  const author = bestKnownAuthor(book.authorFiling, book.authors ?? '')
  const surname = author.split(',')[0]?.trim()
  return surname || book.title || 'an untitled book'
}

/**
 * The books either side of the gap. The strip is asked first because it is what
 * the person is looking at; a neighbour with the same sort key as the book in
 * hand (another copy of it) can stand beside the gap without being the
 * placement's predecessor.
 */
function besideTheGap(placement: PlacementResponse): StripBook[] {
  const strip = placement.strip
  if (!strip || strip.gapIndex < 0) return []
  return [strip.books[strip.gapIndex - 1], strip.books[strip.gapIndex]]
    .filter((book): book is StripBook => Boolean(book))
}

function sameBook(
  book: { id: number; title: string; authorFiling: string },
  title: string,
  authorFiling: string,
  otherCopy: number | null,
): boolean {
  if (otherCopy !== null && book.id === otherCopy) return true
  return Boolean(title) && Boolean(authorFiling)
    && book.title.trim().toLowerCase() === title.trim().toLowerCase()
    && book.authorFiling === authorFiling
}

export function whereItGoes(
  placement: PlacementResponse,
  title: string,
  otherCopy: number | null = null,
): string {
  const label = placement.derivedLocation || placement.suggestedLocation
  const shelf = label ? `Shelf ${label}` : 'This shelf'

  const near: { id: number; title: string; authorFiling: string }[] = [
    ...besideTheGap(placement),
    ...[placement.predecessor, placement.successor]
      .filter((book): book is Neighbour => Boolean(book)),
  ]
  if (near.some((book) => sameBook(book, title, placement.authorFiling, otherCopy))) {
    return `${shelf}, next to your other copy`
  }

  const { predecessor: before, successor: after } = placement
  if (before && after) {
    let left = nameOf(before)
    let right = nameOf(after)
    // Two books by one author either side say nothing by surname alone.
    if (left === right) {
      left = before.title
      right = after.title
    }
    return `${shelf}, between ${left} and ${right}`
  }
  if (before) return `${shelf}, after ${nameOf(before)}`
  if (after) return `${shelf}, before ${nameOf(after)}`
  return `${shelf}, the first book on it`
}
