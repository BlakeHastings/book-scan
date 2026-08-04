import type { BookRow, CheckedOutAt, ShelfGroupDto, StripBook } from './api'
import { shelfImage, type ShelfSlot } from '../../shared/shelving'

/**
 * Turning what the catalogue stores into what a shelf looks like.
 *
 * The server hands the placing strip out ready drawn, because it computes the
 * layout anyway. The library gets whole groups of raw rows instead, so the
 * same book has to be turned into the same spine on this side. Both go
 * through `shelfImage`, which is the only place the fallback order is
 * written, so a book cannot show its front cover in one view and its spine in
 * the other.
 */

/** One catalogued book as it is drawn standing on a shelf. */
export function spineOf(book: BookRow): StripBook {
  const photo = shelfImage({
    front: book.front_image ?? '',
    back: book.back_image ?? '',
    edge: book.edge_image ?? '',
  })

  return {
    id: book.id,
    title: book.title,
    // What is written down the spine when there is no photograph of one. The
    // author is what you read walking along a shelf, so it is what a blank
    // block carries.
    authorFiling: book.author_filing || book.authors || book.title,
    spine: photo.name,
    spineSlot: photo.slot,
  }
}

/**
 * The books physically standing in one area, left to right.
 *
 * Exactly the group the server laid out, and nothing else. A checked out book
 * is not on the shelf: the run has closed up behind it, and the person
 * standing there counting along would count what is left. Putting it back in
 * as a marker would make the drawing disagree with the room and every number
 * after it wrong. The books that are off the bookcase are listed separately,
 * above the rows, which is where something you cannot see belongs.
 */
export function rowOf(group: ShelfGroupDto): StripBook[] {
  return group.books.map(({ book }) => spineOf(book))
}

/** How many books belonging in this area are off the bookcase right now. */
export function missingFrom(label: string, checkedOut: CheckedOutAt[]): number {
  return checkedOut.filter((entry) => entry.label === label).length
}

/** What a spine is showing, for the people who cannot see it. */
export function spineLabel(book: StripBook, slot: ShelfSlot = book.spineSlot): string {
  if (slot === 'edge') return `${book.title}, spine`
  if (slot === 'front') return `${book.title}, front cover, no spine photo`
  if (slot === 'back') return `${book.title}, back cover, no spine photo`
  return `${book.title}, no photo`
}
