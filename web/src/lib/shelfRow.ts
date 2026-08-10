import type { CheckedOutAt, FiledBookRow, ShelfGroupDto, StripBook } from './api'
import { bookCover, shelfImage, type CoverSlot, type ShelfSlot } from '../../shared/shelving'

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
export function spineOf(book: FiledBookRow): StripBook {
  const photo = shelfImage({
    front: book.front_image ?? '',
    back: book.back_image ?? '',
    edge: book.edge_image ?? '',
    // A spine is drawn two centimetres wide, so the margin of room the capture
    // guide left around it is a real part of the picture. Cropping it is the
    // same decision the gallery makes, taken in the one place the precedence
    // is written down so the two views cannot disagree.
    crops: {
      front: book.front_crop ?? '',
      back: book.back_crop ?? '',
      edge: book.edge_crop ?? '',
    },
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

/** One line of the vertical list: a book, its position, and whether it is there. */
export interface ListRow {
  book: FiledBookRow
  /** What you count along to. Zero for a book that is not on the bookcase. */
  n: number
  here: boolean
}

/**
 * The books on a shelf plus, in their alphabetical slots, the ones that belong
 * there but are currently off it.
 *
 * Lifted out of ShelfView unchanged when the list came back as one of three
 * views (#82), so it can be tested without a DOM. The numbering deliberately
 * counts only what is physically present, since that is what you use to find a
 * book by counting along. An absent book gets a dash: it is in the list to
 * explain a gap, not to be counted to.
 *
 * This is the one thing the list does that the spine row and the gallery do
 * not. Those two draw the run as it physically stands, because a spine or a
 * cover is a picture of furniture and a book that is out of the house is not
 * in the picture. A line of text is not a picture, and the list has always
 * used that to say where the gap is.
 */
export function listOf(group: ShelfGroupDto, checkedOut: CheckedOutAt[]): ListRow[] {
  const present: ListRow[] = group.books.map(({ book }, i) => ({ book, n: i + 1, here: true }))
  const absent: ListRow[] = checkedOut
    .filter((entry) => entry.label === group.label)
    .map((entry) => ({ book: entry.book, n: 0, here: false }))

  return [...present, ...absent].sort((a, b) =>
    a.book.sort_key < b.book.sort_key ? -1 : a.book.sort_key > b.book.sort_key ? 1 : 0)
}

/** How many books belonging in this area are off the bookcase right now. */
export function missingFrom(label: string, checkedOut: CheckedOutAt[]): number {
  return checkedOut.filter((entry) => entry.label === label).length
}

/** One catalogued book as a tile in the gallery. */
export interface GridBook {
  id: number
  title: string
  /** Written across a tile that has no picture, the way a blank spine is. */
  authorFiling: string
  cover: string
  coverSlot: CoverSlot
  /** The publisher's picture rather than a photograph of this copy. */
  fromCatalogue: boolean
  /** Cut to the book, so the room it was photographed in is not in the tile. */
  cropped: boolean
}

/**
 * One book as it is drawn lying face up in the gallery.
 *
 * The sibling of `spineOf`, asking the same question of the same book for a
 * view that shows the other face of it, and going through the one shared rule
 * for both reasons `spineOf` does: so the two views cannot disagree about a
 * book, and so the answer arrives saying what it is rather than leaving the
 * caller to assume.
 */
export function coverOf(book: FiledBookRow): GridBook {
  const picture = bookCover({
    front: book.front_image ?? '',
    back: book.back_image ?? '',
    edge: book.edge_image ?? '',
    catalogue: book.cover_image ?? '',
    // The gallery is the reason cropping exists: a wall of photographs with
    // somebody's feet in the corner of half of them. Where a crop was found,
    // this shows it.
    crops: {
      front: book.front_crop ?? '',
      back: book.back_crop ?? '',
      edge: book.edge_crop ?? '',
    },
  })

  return {
    id: book.id,
    title: book.title,
    authorFiling: book.author_filing || book.authors || book.title,
    cover: picture.name,
    coverSlot: picture.slot,
    fromCatalogue: picture.fromCatalogue,
    cropped: picture.cropped,
  }
}

/**
 * What a tile is showing, said plainly.
 *
 * Every case except a front cover is one somebody would otherwise get wrong:
 * a spine or a back standing in reads as a badly cropped cover, and the
 * publisher's picture reads as a photograph of the book on the shelf when it
 * is a stock image of some edition of it.
 */
export function coverLabel(book: GridBook): string {
  if (book.coverSlot === 'front') return `${book.title}, front cover`
  if (book.coverSlot === 'edge') return `${book.title}, spine, no cover photo`
  if (book.coverSlot === 'back') return `${book.title}, back cover, no front cover photo`
  if (book.coverSlot === 'catalogue') {
    return `${book.title}, the publisher's picture, not this copy`
  }
  return `${book.title}, no picture`
}

/** What a spine is showing, for the people who cannot see it. */
export function spineLabel(book: StripBook, slot: ShelfSlot = book.spineSlot): string {
  if (slot === 'edge') return `${book.title}, spine`
  if (slot === 'front') return `${book.title}, front cover, no spine photo`
  if (slot === 'back') return `${book.title}, back cover, no spine photo`
  return `${book.title}, no photo`
}
